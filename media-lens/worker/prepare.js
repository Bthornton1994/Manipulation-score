// Preparation layer: HTML/pasted text -> prepared text, spans, metadata,
// claim candidates, paywall detection. See docs/media-lens-influence-graph-plan.md
// section 7. This module never fetches a network resource itself; the
// worker (server.js/analyze.js) decides whether html/text came from a URL
// fetch (live mode only), pasted text, or a fixture file, and passes the
// already-obtained markup/text in here. HTML body isolation uses pinned
// local Trafilatura on that markup. Trafilatura is not given a URL.
//
// Article text is treated as untrusted data throughout: nothing here
// executes scripts, follows redirects, or evaluates JSON-LD as code (JSON.parse
// only, wrapped in try/catch). Prompt-injection pattern detection happens in
// fusion.js, not here; this module only extracts structure.

import { createHash } from 'node:crypto';
import { detectTextLanguage, extractLocalArticle, schemaLanguage } from './trafilatura-extract.js';

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
// CMS article bodies are often leaf <div>/<section> paragraphs. Without treating
// those as blocks, a matching <h1>/<p> keeps contentBlocks non-empty, skips the
// Trafilatura-line fallback, and silently drops the div body from analysis.
const LEAF_CONTAINER_TAGS = new Set(['div', 'section']);
const BLOCKISH_CHILD_TAGS = new Set([...BLOCK_TAGS, ...LEAF_CONTAINER_TAGS, 'ul', 'ol', 'table', 'main']);
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
  const siteName = metaByKey.get('og:site_name') || null;
  const isAccessibleForFree = jsonLd && 'isAccessibleForFree' in jsonLd ? Boolean(jsonLd.isAccessibleForFree) : null;

  return { publishedAt, modifiedAt, title, author, siteName, canonical, isAccessibleForFree };
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

function hasBlockishChild(node) {
  return (node.children || []).some((child) => child.type === 'element' && BLOCKISH_CHILD_TAGS.has(child.tag));
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

  // Leaf CMS containers (no nested block/list/table): treat like <p>.
  // Otherwise a matching <h1>/<p> keeps contentBlocks non-empty, skips the
  // Trafilatura-line fallback, and silently drops the div/section body.
  if (!skipHere && LEAF_CONTAINER_TAGS.has(node.tag) && !hasBlockishChild(node)) {
    const text = collapseWhitespace(innerText(node));
    if (text) {
      const classAttr = (node.attrs.class || '').toLowerCase();
      let role = 'authorial';
      let roleBasis = 'default';
      let splitQuotes = true;
      if (classAttr.includes('byline')) {
        role = 'byline_meta';
        roleBasis = 'html_structure';
        splitQuotes = false;
      } else if (BOILERPLATE_CLASS_HINTS.some((hint) => classAttr.includes(hint))) {
        role = 'boilerplate';
        roleBasis = 'html_structure';
        splitQuotes = false;
      }
      blocks.push({ role, roleBasis, text, attribution: { speaker: null, cue: null }, splitQuotes });
    }
    return blocks;
  }

  for (const child of node.children || []) {
    blocks.push(...walkBlocks(child, { inSkipContainer: skipHere }));
  }
  return blocks;
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeMatchText(text) {
  return collapseWhitespace(text)
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, ' ');
}

/** Trafilatura prefixes list lines with "- "; HTML walkers do not. */
function stripExtractedListMarker(text) {
  return text.replace(/^[-*•]\s+/, '');
}

function matchParagraphs(text) {
  const paragraphs = new Set();
  for (const part of String(text || '').split(/\n+/)) {
    const normalized = normalizeMatchText(part);
    if (normalized) paragraphs.add(normalized);
  }
  return paragraphs;
}

/**
 * True when a walked HTML block corresponds to one or more Trafilatura
 * lines. Exact match is preferred; substring match covers <br>-joined
 * paragraphs Trafilatura splits, and list-marker stripping covers <li>.
 */
function blockMatchesExtracted(normalizedBlock, paragraphs) {
  if (!normalizedBlock) return false;
  if (paragraphs.has(normalizedBlock)) return true;
  for (const paragraph of paragraphs) {
    const stripped = stripExtractedListMarker(paragraph);
    if (
      normalizedBlock === stripped ||
      normalizedBlock.includes(paragraph) ||
      normalizedBlock.includes(stripped) ||
      paragraph.includes(normalizedBlock) ||
      stripped.includes(normalizedBlock)
    ) {
      return true;
    }
  }
  return false;
}

function keepExtractedBlock(block, paragraphs) {
  return blockMatchesExtracted(normalizeMatchText(block.text || ''), paragraphs);
}

function contentBlocks(blocks) {
  return blocks.filter((block) => block.role !== 'byline_meta' && block.role !== 'boilerplate');
}

function blocksFromExtractedText(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((line) => collapseWhitespace(line))
    .filter((line) => line.length > 0);
  return lines.map((line, index) => ({
    role: index === 0 ? 'headline' : 'authorial',
    roleBasis: index === 0 ? 'html_structure' : 'default',
    text: line,
    attribution: { speaker: null, cue: null },
    splitQuotes: index !== 0
  }));
}

function dateOnly(value) {
  if (typeof value !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function mergeMetadata(local, extracted) {
  return {
    title: local.title || extracted.title || null,
    author: local.author || extracted.author || null,
    siteName: local.siteName || null,
    canonical: local.canonical,
    publishedAt: local.publishedAt || dateOnly(extracted.date),
    modifiedAt: local.modifiedAt,
    isAccessibleForFree: local.isAccessibleForFree
  };
}

function extractionRecord({ status, extracted, bodySha256, contentType, fetchStatus, fetchedAt, languageScope }) {
  return {
    status,
    languageScope,
    extractorVersion: extracted?.extractor_version || null,
    languageDetectorVersion: extracted?.language_detector_version || null,
    bodySha256,
    contentType,
    fetchStatus,
    fetchedAt
  };
}

function acquisitionFor(inputMode, acquisition) {
  if (acquisition) return acquisition;
  if (inputMode === 'fixture') {
    return { contentType: 'text/html', fetchStatus: 'not_fetched', fetchedAt: null };
  }
  return { contentType: null, fetchStatus: inputMode === 'pasted_text' ? 'not_fetched' : null, fetchedAt: null };
}

function failedHtmlPreparation({ kind, inputMode, sourceUrl, status, extracted, html, acquisition }) {
  const acquired = acquisitionFor(inputMode, acquisition);
  const preparedText = '';
  return {
    preparedText,
    textSha256: sha256Text(preparedText),
    textLengthChars: 0,
    spans: [],
    claimCandidates: [],
    paywallDetected: false,
    extraction: extractionRecord({
      status,
      extracted,
      bodySha256: sha256Text(html || ''),
      contentType: acquired.contentType ?? null,
      fetchStatus: acquired.fetchStatus ?? null,
      fetchedAt: acquired.fetchedAt ?? null,
      languageScope: 'article_html'
    }),
    artifact: {
      kind,
      inputMode,
      url: sourceUrl,
      canonicalUrl: sourceUrl,
      title: null,
      byline: null,
      publisherName: null,
      publishedAt: null,
      modifiedAt: null,
      timestampPrecision: 'none',
      language: 'und'
    }
  };
}

export function enginePreparation(prepared) {
  const extraction = prepared.extraction || {};
  const pasted = prepared.artifact.inputMode === 'pasted_text';
  return {
    version: '0.1.0',
    extractor: pasted ? 'pasted' : 'trafilatura',
    extractor_version: pasted ? null : extraction.extractorVersion || null,
    extraction_status: extraction.status || (pasted ? 'not_html' : 'not_extracted'),
    body_sha256: pasted ? null : extraction.bodySha256 || null,
    content_type: extraction.contentType ?? null,
    fetch_status: extraction.fetchStatus ?? null,
    fetched_at: extraction.fetchedAt ?? null
  };
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
export async function prepareFromHtml({
  html,
  kind = 'article',
  sourceUrl = null,
  inputMode = 'fixture',
  acquisition = null,
  extractImpl = extractLocalArticle
}) {
  const sourceHtml = typeof html === 'string' ? html : '';
  const extracted = await extractImpl(sourceHtml);
  const status = extracted?.status;
  if (status !== 'ok') {
    return failedHtmlPreparation({
      kind,
      inputMode,
      sourceUrl,
      status: status || 'error',
      extracted,
      html: sourceHtml,
      acquisition
    });
  }

  const root = parseHtml(sourceHtml);
  const meta = mergeMetadata(extractMetadata(root), extracted);
  const articleRoot = findFirst(root, (n) => n.type === 'element' && n.tag === 'article') || root;
  const paragraphs = matchParagraphs(extracted.text);
  let rawBlocks = walkBlocks(articleRoot, {}).filter((block) => keepExtractedBlock(block, paragraphs));
  // Full Trafilatura-line fallback only when the walker kept nothing eligible.
  // Do not replace a partial walker match: Trafilatura may still emit hidden
  // or newsletter lines the walker correctly excluded.
  if (contentBlocks(rawBlocks).length === 0) {
    rawBlocks = blocksFromExtractedText(extracted.text);
  }

  const builder = new SpanBuilder();
  rawBlocks.forEach((block, i) => {
    addParagraphSpans(builder, i, block);
  });

  const bodyTextForPaywallCheck = rawBlocks.map((b) => b.text).join(' ');
  const paywallDetected = detectPaywall({ jsonLdAccessibleForFree: meta.isAccessibleForFree, bodyText: bodyTextForPaywallCheck });
  const preparedText = builder.text;
  const acquired = acquisitionFor(inputMode, acquisition);
  const language = schemaLanguage({ detected: extracted.detected_language, htmlLang: extracted.html_lang });

  return {
    preparedText,
    textSha256: sha256Text(preparedText),
    textLengthChars: preparedText.length,
    spans: builder.spans,
    claimCandidates: builder.claims,
    paywallDetected,
    extraction: extractionRecord({
      status: 'ok',
      extracted,
      bodySha256: sha256Text(sourceHtml),
      contentType: acquired.contentType ?? null,
      fetchStatus: acquired.fetchStatus ?? null,
      fetchedAt: acquired.fetchedAt ?? null,
      languageScope: 'article_html'
    }),
    artifact: {
      kind,
      inputMode,
      url: sourceUrl,
      canonicalUrl: meta.canonical || sourceUrl,
      title: meta.title || null,
      byline: meta.author || null,
      publisherName: meta.siteName || null,
      publishedAt: meta.publishedAt || null,
      modifiedAt: meta.modifiedAt || null,
      timestampPrecision: timestampPrecision(meta.publishedAt),
      language
    }
  };
}

/**
 * Prepare a document from pasted plain text (no HTML structure, no
 * metadata). Paragraphs are split on blank lines; each paragraph is
 * treated as authorial unless it contains quote marks.
 */
export async function prepareFromPastedText({ text, kind = 'other_public' }) {
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
  const textSha256 = sha256Text(preparedText);
  const paywallDetected = PAYWALL_CTA_PATTERN.test(preparedText) && preparedText.length < 400;
  const detected = await detectTextLanguage(text);
  const language = schemaLanguage({ detected: detected?.detected_language, htmlLang: null });

  return {
    preparedText,
    textSha256,
    textLengthChars: preparedText.length,
    spans: builder.spans,
    claimCandidates: builder.claims,
    paywallDetected,
    extraction: {
      status: detected?.status === 'ok' ? 'not_html' : detected?.status || 'error',
      languageScope: 'pasted_text',
      extractorVersion: null,
      languageDetectorVersion: detected?.language_detector_version || null,
      bodySha256: null,
      contentType: null,
      fetchStatus: 'not_fetched',
      fetchedAt: null
    },
    artifact: {
      kind,
      inputMode: 'pasted_text',
      url: null,
      canonicalUrl: null,
      title: null,
      byline: null,
      publisherName: null,
      publishedAt: null,
      modifiedAt: null,
      timestampPrecision: 'none',
      language
    }
  };
}

/**
 * A minimal, schema-shaped "prepared" stub for cases where preparation
 * itself failed or was aborted (e.g. a live-mode URL fetch that timed out
 * or was rejected) but the caller still needs to build a valid,
 * abstention-only influence-graph.v1 document rather than a raw error.
 */
export function emptyPreparedArtifactStub({ inputMode, url = null, kind = 'article', fetchStatus = null }) {
  return {
    preparedText: '',
    textSha256: sha256Text(''),
    textLengthChars: 0,
    spans: [],
    claimCandidates: [],
    paywallDetected: false,
    extraction: {
      status: 'not_extracted',
      languageScope: 'none',
      extractorVersion: null,
      languageDetectorVersion: null,
      bodySha256: null,
      contentType: null,
      fetchStatus: fetchStatus ?? (inputMode === 'url' ? null : 'not_fetched'),
      fetchedAt: null
    },
    artifact: {
      kind,
      inputMode,
      url,
      canonicalUrl: url,
      title: null,
      byline: null,
      publisherName: null,
      publishedAt: null,
      modifiedAt: null,
      timestampPrecision: 'none',
      language: 'und'
    }
  };
}

export const ATTRIBUTION_CUE_WORDS = ATTRIBUTION_CUES;
export { parseHtml, innerText, collapseWhitespace };
