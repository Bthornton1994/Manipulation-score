// Preparation layer: HTML/pasted text -> prepared text, spans, metadata,
// claim candidates, paywall detection. See docs/media-lens-influence-graph-plan.md
// section 7. This module never fetches a network resource itself; the
// worker (server.js/analyze.js) decides whether html/text came from a URL
// fetch (live mode only), pasted text, or a fixture file, and passes the
// already-obtained markup/text in here.
//
// Article text is treated as untrusted data throughout: nothing here
// executes scripts, follows redirects, or evaluates JSON-LD as code (JSON.parse
// only, wrapped in try/catch). Prompt-injection pattern detection happens in
// fusion.js, not here; this module only extracts structure.

import { createHash } from 'node:crypto';

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

const RAW_TEXT_TAGS = new Set(['script', 'style', 'template']);
const SKIP_CONTAINER_TAGS = new Set(['nav', 'header', 'footer', 'aside']);
const BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'p', 'blockquote', 'figcaption', 'li']);
const BOILERPLATE_CLASS_HINTS = ['share', 'subscribe', 'newsletter', 'advert', 'promo-', 'related-', 'comments'];

const ATTRIBUTION_CUES = [
  'said',
  'says',
  'told',
  'stated',
  'wrote',
  'announced',
  'noted',
  'explained',
  'added',
  'according to',
  'claimed',
  'reported'
];

const PAYWALL_CTA_PATTERN = /subscribe to (continue|read)|become a (member|subscriber) to (continue|read)|this article is for subscribers/i;

const CLAIM_TRIGGER_PATTERNS = [
  { kind: 'statistic', pattern: /\b\d+(\.\d+)?\s?%|\b\d{2,}(,\d{3})*\b/ },
  { kind: 'event', pattern: /\b(on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)|announced|voted|signed|launched|passed)\b/i },
  { kind: 'attribution', pattern: /\baccording to\b/i },
  { kind: 'prediction', pattern: /\b(will|is expected to|is projected to|forecasts?)\b/i },
  { kind: 'evaluation', pattern: /\b(best|worst|failed|succeeded|dangerous|historic)\b/i }
];

function parseAttrs(attrString) {
  const attrs = {};
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = attrRe.exec(attrString))) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    attrs[name] = value;
  }
  return attrs;
}

function tokenize(html) {
  const tokens = [];
  const tagRe =
    /<!--([\s\S]*?)-->|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m.index > last) tokens.push({ type: 'text', value: html.slice(last, m.index) });
    if (m[1] === undefined) {
      if (m[2]) {
        tokens.push({ type: 'open', tag: m[2].toLowerCase(), attrs: parseAttrs(m[3] || ''), selfClose: m[4] === '/' });
      } else if (m[5]) {
        tokens.push({ type: 'close', tag: m[5].toLowerCase() });
      }
    }
    last = tagRe.lastIndex;
  }
  if (last < html.length) tokens.push({ type: 'text', value: html.slice(last) });
  return tokens;
}

function buildTree(tokens) {
  const root = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.type === 'text') {
      top.children.push({ type: 'text', value: t.value });
    } else if (t.type === 'open') {
      const node = { type: 'element', tag: t.tag, attrs: t.attrs, children: [] };
      top.children.push(node);
      if (!t.selfClose && !VOID_ELEMENTS.has(t.tag)) stack.push(node);
    } else if (t.type === 'close') {
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tag === t.tag) {
          stack.length = s;
          break;
        }
      }
    }
  }
  return root;
}

function parseHtml(html) {
  return buildTree(tokenize(html));
}

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&ldquo;/g, '\u201c')
    .replace(/&rdquo;/g, '\u201d')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rsquo;/g, '\u2019');
}

function isHiddenNode(node) {
  if (node.type !== 'element') return false;
  const { attrs } = node;
  if ('hidden' in attrs) return true;
  if ((attrs['aria-hidden'] || '').toLowerCase() === 'true') return true;
  if (attrs.style && /display\s*:\s*none/i.test(attrs.style)) return true;
  return false;
}

function isBoilerplateNode(node) {
  if (node.type !== 'element') return false;
  const classAttr = (node.attrs.class || '') + ' ' + (node.attrs.id || '');
  return BOILERPLATE_CLASS_HINTS.some((hint) => classAttr.toLowerCase().includes(hint));
}

function innerText(node) {
  if (node.type === 'text') return decodeEntities(node.value);
  if (RAW_TEXT_TAGS.has(node.tag) || isHiddenNode(node)) return '';
  let text = '';
  for (const child of node.children || []) {
    if (child.type === 'element' && child.tag === 'br') {
      text += ' ';
      continue;
    }
    text += innerText(child);
  }
  return text;
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function rawText(node) {
  if (node.type === 'text') return node.value;
  let text = '';
  for (const child of node.children || []) text += rawText(child);
  return text;
}

function findFirst(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

function findAll(node, predicate, acc = []) {
  if (predicate(node)) acc.push(node);
  for (const child of node.children || []) findAll(child, predicate, acc);
  return acc;
}

function extractMetadata(root) {
  const metas = findAll(root, (n) => n.type === 'element' && n.tag === 'meta');
  const links = findAll(root, (n) => n.type === 'element' && n.tag === 'link');
  const scripts = findAll(root, (n) => n.type === 'element' && n.tag === 'script');

  const metaByKey = new Map();
  for (const meta of metas) {
    const key = meta.attrs.property || meta.attrs.name;
    if (key) metaByKey.set(key.toLowerCase(), meta.attrs.content || null);
  }

  let canonical = null;
  for (const link of links) {
    if ((link.attrs.rel || '').toLowerCase() === 'canonical' && link.attrs.href) {
      canonical = link.attrs.href;
      break;
    }
  }

  let jsonLd = null;
  for (const script of scripts) {
    if ((script.attrs.type || '').toLowerCase() === 'application/ld+json') {
      const raw = rawText(script).trim();
      try {
        jsonLd = JSON.parse(raw);
      } catch {
        jsonLd = null;
      }
      if (jsonLd) break;
    }
  }

  const publishedAt = metaByKey.get('article:published_time') || jsonLd?.datePublished || null;
  const modifiedAt = metaByKey.get('article:modified_time') || jsonLd?.dateModified || null;
  const title = metaByKey.get('og:title') || null;
  const author = metaByKey.get('author') || jsonLd?.author?.name || null;
  const isAccessibleForFree = jsonLd && 'isAccessibleForFree' in jsonLd ? Boolean(jsonLd.isAccessibleForFree) : null;

  return { publishedAt, modifiedAt, title, author, canonical, isAccessibleForFree };
}

function timestampPrecision(iso) {
  if (!iso) return 'none';
  return /T\d{2}:\d{2}/.test(iso) ? 'time' : 'date';
}

const QUOTE_PATTERN = /["\u201c]([^"\u201d]{1,1200})["\u201d]/g;

const SPEAKER_PHRASE = "(?:(?:the|a|an)\\s+)?[A-Za-z][\\w'.-]*(?:\\s+[A-Za-z][\\w'.-]*){0,3}";
const CUE_WORDS = 'said|says|told\\s+\\w+|stated|wrote|announced|noted|explained|added|claimed|reported';

function findAttributionAround(paragraphText, quoteStart, quoteEnd) {
  const before = paragraphText.slice(Math.max(0, quoteStart - 90), quoteStart);
  const after = paragraphText.slice(quoteEnd, Math.min(paragraphText.length, quoteEnd + 90));

  const afterMatch = after.match(new RegExp(`^[,\\s]*(${SPEAKER_PHRASE})\\s+(${CUE_WORDS})\\b`, 'i'));
  if (afterMatch) {
    return { speaker: collapseWhitespace(afterMatch[1]), cue: afterMatch[2].toLowerCase().split(/\s+/)[0] };
  }

  const beforeAccordingTo = before.match(new RegExp(`(according to)\\s+(${SPEAKER_PHRASE}),?\\s*$`, 'i'));
  if (beforeAccordingTo) {
    return { speaker: collapseWhitespace(beforeAccordingTo[2]), cue: 'according to' };
  }

  const beforeSaidMatch = before.match(new RegExp(`(${SPEAKER_PHRASE})\\s+(${CUE_WORDS})[,:]?\\s*$`, 'i'));
  if (beforeSaidMatch) {
    return { speaker: collapseWhitespace(beforeSaidMatch[1]), cue: beforeSaidMatch[2].toLowerCase().split(/\s+/)[0] };
  }

  return { speaker: null, cue: null };
}

function classifyClaim(text) {
  for (const { kind, pattern } of CLAIM_TRIGGER_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

class SpanBuilder {
  constructor() {
    this.text = '';
    this.spans = [];
    this.claims = [];
  }

  pushSpan({ role, roleBasis, attribution, paragraphIndex, text }) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    if (this.text.length > 0) this.text += ' ';
    const start = this.text.length;
    this.text += trimmed;
    const end = this.text.length;
    const span = {
      id: `span-${this.spans.length + 1}`,
      start,
      end,
      text: trimmed,
      paragraph_index: paragraphIndex,
      role,
      attribution: { speaker: attribution?.speaker ?? null, cue: attribution?.cue ?? null },
      role_basis: roleBasis
    };
    this.spans.push(span);
    return span;
  }

  maybeAddClaim(span) {
    if (!span) return;
    if (span.role === 'boilerplate') return;
    const kind = classifyClaim(span.text);
    if (!kind) return;
    this.claims.push({
      spanId: span.id,
      text: span.text,
      kind,
      attribution: span.role === 'quoted' || span.role === 'attributed_paraphrase' ? 'quoted' : 'authorial'
    });
  }
}

function addParagraphSpans(builder, paragraphIndex, { role, roleBasis, text, attribution, splitQuotes }) {
  if (!splitQuotes || role === 'quoted' || role === 'boilerplate' || role === 'caption' || role === 'headline' || role === 'subhead') {
    const span = builder.pushSpan({ role, roleBasis, attribution, paragraphIndex, text });
    builder.maybeAddClaim(span);
    return;
  }

  let cursor = 0;
  let match;
  let any = false;
  QUOTE_PATTERN.lastIndex = 0;
  while ((match = QUOTE_PATTERN.exec(text))) {
    any = true;
    const [full, quoteBody] = match;
    const quoteStart = match.index;
    const quoteEnd = quoteStart + full.length;

    const pre = text.slice(cursor, quoteStart);
    if (pre.trim().length > 0) {
      const preSpan = builder.pushSpan({ role: 'authorial', roleBasis: 'default', paragraphIndex, text: pre });
      builder.maybeAddClaim(preSpan);
    }

    const attributionInfo = findAttributionAround(text, quoteStart, quoteEnd);
    const quotedSpan = builder.pushSpan({
      role: 'quoted',
      roleBasis: 'quote_marks',
      attribution: attributionInfo,
      paragraphIndex,
      text: quoteBody
    });
    builder.maybeAddClaim(quotedSpan);

    cursor = quoteEnd;
  }

  if (!any) {
    const span = builder.pushSpan({ role, roleBasis, attribution, paragraphIndex, text });
    builder.maybeAddClaim(span);
    return;
  }

  const tail = text.slice(cursor);
  if (tail.trim().length > 0) {
    const tailSpan = builder.pushSpan({ role: 'authorial', roleBasis: 'default', paragraphIndex, text: tail });
    builder.maybeAddClaim(tailSpan);
  }
}

function walkBlocks(node, { inSkipContainer } = {}) {
  const blocks = [];
  if (node.type !== 'element') return blocks;
  if (isHiddenNode(node) || RAW_TEXT_TAGS.has(node.tag)) return blocks;

  const skipHere = inSkipContainer || SKIP_CONTAINER_TAGS.has(node.tag) || isBoilerplateNode(node);

  if (!skipHere && BLOCK_TAGS.has(node.tag)) {
    if (node.tag === 'blockquote') {
      const citeNode = findFirst(node, (n) => n.type === 'element' && n.tag === 'cite');
      const footerNode = findFirst(node, (n) => n.type === 'element' && n.tag === 'footer');
      const speaker = citeNode ? collapseWhitespace(innerText(citeNode)) : null;
      const quoteText = collapseWhitespace(
        innerText({
          ...node,
          children: node.children.filter((c) => !(c.type === 'element' && (c.tag === 'footer' || c.tag === 'cite')))
        })
      );
      blocks.push({ role: 'quoted', roleBasis: 'blockquote', text: quoteText, attribution: { speaker, cue: footerNode ? 'blockquote' : null } });
      return blocks;
    }

    const text = collapseWhitespace(innerText(node));
    const classAttr = (node.attrs.class || '').toLowerCase();
    let role = 'authorial';
    let roleBasis = 'default';
    let splitQuotes = true;

    if (node.tag === 'h1') {
      role = 'headline';
      roleBasis = 'html_structure';
      splitQuotes = false;
    } else if (node.tag === 'h2' || node.tag === 'h3') {
      role = 'subhead';
      roleBasis = 'html_structure';
      splitQuotes = false;
    } else if (node.tag === 'figcaption') {
      role = 'caption';
      roleBasis = 'html_structure';
      splitQuotes = false;
    } else if (classAttr.includes('byline')) {
      role = 'byline_meta';
      roleBasis = 'html_structure';
      splitQuotes = false;
    } else if (BOILERPLATE_CLASS_HINTS.some((hint) => classAttr.includes(hint))) {
      role = 'boilerplate';
      roleBasis = 'html_structure';
      splitQuotes = false;
    }

    blocks.push({ role, roleBasis, text, attribution: { speaker: null, cue: null }, splitQuotes });
    return blocks;
  }

  for (const child of node.children || []) {
    blocks.push(...walkBlocks(child, { inSkipContainer: skipHere }));
  }
  return blocks;
}

function detectPaywall({ jsonLdAccessibleForFree, bodyText }) {
  if (jsonLdAccessibleForFree === false) return true;
  if (PAYWALL_CTA_PATTERN.test(bodyText) && bodyText.length < 400) return true;
  return false;
}

/**
 * Prepare a document from raw HTML (fixture or live-fetched markup; this
 * function never fetches anything itself).
 */
export function prepareFromHtml({ html, kind = 'article', sourceUrl = null, inputMode = 'fixture' }) {
  const root = parseHtml(html);
  const meta = extractMetadata(root);

  const articleRoot = findFirst(root, (n) => n.type === 'element' && n.tag === 'article') || root;
  const rawBlocks = walkBlocks(articleRoot, {});

  const builder = new SpanBuilder();
  rawBlocks.forEach((block, i) => {
    addParagraphSpans(builder, i, block);
  });

  const bodyTextForPaywallCheck = rawBlocks.map((b) => b.text).join(' ');
  const paywallDetected = detectPaywall({ jsonLdAccessibleForFree: meta.isAccessibleForFree, bodyText: bodyTextForPaywallCheck });

  const preparedText = builder.text;
  const textSha256 = createHash('sha256').update(preparedText, 'utf8').digest('hex');

  return {
    preparedText,
    textSha256,
    textLengthChars: preparedText.length,
    spans: builder.spans,
    claimCandidates: builder.claims,
    paywallDetected,
    artifact: {
      kind,
      inputMode,
      url: sourceUrl,
      canonicalUrl: meta.canonical || sourceUrl,
      title: meta.title || null,
      byline: meta.author || null,
      publishedAt: meta.publishedAt || null,
      modifiedAt: meta.modifiedAt || null,
      timestampPrecision: timestampPrecision(meta.publishedAt),
      language: 'en'
    }
  };
}

/**
 * Prepare a document from pasted plain text (no HTML structure, no
 * metadata). Paragraphs are split on blank lines; each paragraph is
 * treated as authorial unless it contains quote marks.
 */
export function prepareFromPastedText({ text, kind = 'other_public' }) {
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => collapseWhitespace(p))
    .filter((p) => p.length > 0);

  const builder = new SpanBuilder();
  paragraphs.forEach((paragraphText, i) => {
    addParagraphSpans(builder, i, {
      role: 'authorial',
      roleBasis: 'default',
      text: paragraphText,
      attribution: { speaker: null, cue: null },
      splitQuotes: true
    });
  });

  const preparedText = builder.text;
  const textSha256 = createHash('sha256').update(preparedText, 'utf8').digest('hex');
  const paywallDetected = PAYWALL_CTA_PATTERN.test(preparedText) && preparedText.length < 400;

  return {
    preparedText,
    textSha256,
    textLengthChars: preparedText.length,
    spans: builder.spans,
    claimCandidates: builder.claims,
    paywallDetected,
    artifact: {
      kind,
      inputMode: 'pasted_text',
      url: null,
      canonicalUrl: null,
      title: null,
      byline: null,
      publishedAt: null,
      modifiedAt: null,
      timestampPrecision: 'none',
      language: 'en'
    }
  };
}

export const ATTRIBUTION_CUE_WORDS = ATTRIBUTION_CUES;
export { parseHtml, innerText, collapseWhitespace };
