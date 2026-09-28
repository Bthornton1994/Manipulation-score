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
// CMS article bodies are often paragraphs in <div> or <section> rather than
// <p>. A leaf container, one with no NON_LEAF_TAGS element anywhere inside
// it, is walked like <p> so that body is not silently dropped when another
// block keeps walker blocks. A container with such an element inside it,
// even below an inline wrapper (a Google Docs <b> or a <span> around the
// paragraphs), is walked through instead: its text would otherwise join
// every nested paragraph, caption, or sidebar into one block and lose their
// roles.
const LEAF_CONTAINER_TAGS = new Set(['div', 'section']);
const NON_LEAF_TAGS = new Set([
  ...BLOCK_TAGS,
  ...LEAF_CONTAINER_TAGS,
  'ul',
  'ol',
  'table',
  'main',
  'figure',
  'header',
  'footer',
  'nav',
  'aside',
  'article',
  'hgroup',
  'details'
]);
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

// Leaf-ness ignores script, style, template, and hidden nodes the same way
// walkBlocks and innerText strip them: a tag string inside a script (a
// document.write of an ad slot) or a hidden promo element contributes no text
// and must not turn the container into a non-leaf, or its own text would be
// lost when walker blocks are kept. Comments are not tree nodes.
function hasNonLeafDescendant(node) {
  return (node.children || []).some(
    (child) =>
      child.type === 'element' &&
      !RAW_TEXT_TAGS.has(child.tag) &&
      !isHiddenNode(child) &&
      (NON_LEAF_TAGS.has(child.tag) || hasNonLeafDescendant(child))
  );
}

/**
 * Role of a <p>, <li>, <div>, or <section> block from its class attribute:
 * a byline, a boilerplate hint, or the authorial default.
 */
function classRole(classAttr) {
  if (classAttr.includes('byline')) return { role: 'byline_meta', roleBasis: 'html_structure', splitQuotes: false };
  if (BOILERPLATE_CLASS_HINTS.some((hint) => classAttr.includes(hint))) {
    return { role: 'boilerplate', roleBasis: 'html_structure', splitQuotes: false };
  }
  return { role: 'authorial', roleBasis: 'default', splitQuotes: true };
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
    let { role, roleBasis, splitQuotes } = classRole(classAttr);

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
    }

    blocks.push({ role, roleBasis, text, attribution: { speaker: null, cue: null }, splitQuotes, listItem: node.tag === 'li' });
    return blocks;
  }

  // A leaf <div> or <section> is walked like <p>. It is not a list item, so
  // it never matches after the list marker is removed, and it is a
  // leafContainer, so it never keeps walker blocks on its own
  // (equalsOneLineExactly).
  if (!skipHere && LEAF_CONTAINER_TAGS.has(node.tag) && !hasNonLeafDescendant(node)) {
    const text = collapseWhitespace(innerText(node));
    if (text) {
      const classAttr = (node.attrs.class || '').toLowerCase();
      blocks.push({
        ...classRole(classAttr),
        text,
        attribution: { speaker: null, cue: null },
        listItem: false,
        leafContainer: true
      });
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

// With include_formatting=False (extract_html.py), Trafilatura 2.2.0 starts a
// list item's first line with "- " (plus nesting indent, which
// normalizeMatchText trims). No other marker.
const EXTRACTED_LIST_MARKER = /^- /;
// Run search budget: RUN_SEARCH_MIN_STEPS plus RUN_SEARCH_STEPS_PER_CHAR
// steps per character of extracted line text and walked block text. See
// keptExtractedBlocks. Section 10.2 of
// docs/media-lens-live-url-v2-architecture.md states both values.
export const RUN_SEARCH_STEPS_PER_CHAR = 16;
export const RUN_SEARCH_MIN_STEPS = 100000;
// The run search compares polynomial hashes modulo a prime below 2^26, so a
// hash times the base stays an exact integer in a double. Every hash match is
// confirmed by comparing the text.
export const RUN_HASH_PRIME = 67108859;
export const RUN_HASH_BASE = 1000003;

// Control, format, and private-use characters: zero-width spaces, soft
// hyphens, direction marks, embeddings, overrides, and isolates, and Unicode
// tag characters. Trafilatura removes them, except NEXT_LINE.
const INVISIBLE_CHARS = /[\p{Cc}\p{Cf}\p{Co}]/gu;
// U+0085, a control character that Python, and so Trafilatura, reads as
// whitespace.
const NEXT_LINE = /\u0085/g;

/**
 * Comparison key for block and line text. Whitespace is not significant:
 * the walker joins nested block elements (a nested list, a second <p> in a
 * quote) without a space where Trafilatura starts a new line or adds one.
 * INVISIBLE_CHARS are dropped too: Trafilatura removes them.
 */
function matchKey(normalizedText) {
  return normalizedText.replace(INVISIBLE_CHARS, '').replaceAll(' ', '');
}

/**
 * Text of a kept walker block: the walker's text without INVISIBLE_CHARS.
 * matchKey ignores them, so a block keeps its match when they are removed,
 * and the extracted line it matched does not have them. Removing them keeps
 * text Trafilatura dropped, such as tag characters or a direction override
 * that hide or reorder words, out of the prepared text. A next-line character
 * becomes a space first, as in Trafilatura's text; removing it would join
 * the words on either side.
 */
function keptText(text) {
  return collapseWhitespace(text.replace(NEXT_LINE, ' ').replace(INVISIBLE_CHARS, ''));
}

function hashPower(exponent) {
  let power = 1;
  let factor = RUN_HASH_BASE;
  for (let rest = exponent; rest > 0; rest = Math.floor(rest / 2)) {
    if (rest % 2 === 1) power = (power * factor) % RUN_HASH_PRIME;
    factor = (factor * factor) % RUN_HASH_PRIME;
  }
  return power;
}

/**
 * Exact lookup over extracted line keys. has(key) is true when key equals
 * one line. runs(keys, budget) returns the keys that equal a run of two or
 * more consecutive lines (Trafilatura splits <br>, multi-<p> quotes, and
 * nested list items onto separate lines). There is no substring or
 * containment match. The run index is built on the first runs() call.
 */
function lineIndex(lineKeys) {
  const lines = new Set(lineKeys);
  let runs = null;
  return {
    has(key) {
      return lines.has(key);
    },
    runs(keys, budget) {
      if (keys.length === 0) return new Set();
      if (runs === null) runs = runSearch(lineKeys);
      return runs(keys, budget);
    }
  };
}

/**
 * A run starts with a line that is a shorter prefix of the key and ends
 * exactly on a line end. Each key is read once to find every line that is a
 * prefix of it. Keys are then grouped by that first line and by their
 * length, and each group reads the places its first line occurs once,
 * comparing the hash of the run of that length with the keys' hashes. Groups
 * are read in the order their first line first occurs, then by length, so
 * the steps used, and the result, do not depend on the order of the keys.
 *
 * budget.steps counts the characters read (keys, candidate first lines, and
 * runs compared as text) and the places and keys checked. Once it passes
 * budget.limit, the search stops and returns null.
 */
function runSearch(lineKeys) {
  const count = lineKeys.length;
  const joined = lineKeys.join('');
  const lineStart = new Int32Array(count);
  const lineHash = new Int32Array(count);
  // Prefix hash of the joined keys at each line boundary, -1 elsewhere.
  const boundaryHash = new Int32Array(joined.length + 1).fill(-1);
  let offset = 0;
  let prefix = 0;
  boundaryHash[0] = 0;
  for (let index = 0; index < count; index += 1) {
    const line = lineKeys[index];
    let hash = 0;
    for (let at = 0; at < line.length; at += 1) {
      const code = line.charCodeAt(at);
      hash = (hash * RUN_HASH_BASE + code) % RUN_HASH_PRIME;
      prefix = (prefix * RUN_HASH_BASE + code) % RUN_HASH_PRIME;
    }
    lineStart[index] = offset;
    lineHash[index] = hash;
    offset += line.length;
    boundaryHash[offset] = prefix;
  }
  // firstIndex: each distinct line's first occurrence. nextIndex: the next
  // occurrence of the same line, -1 after the last.
  const firstIndex = new Map();
  const nextIndex = new Int32Array(count);
  for (let index = count - 1; index >= 0; index -= 1) {
    const next = firstIndex.get(lineKeys[index]);
    nextIndex[index] = next === undefined ? -1 : next;
    firstIndex.set(lineKeys[index], index);
  }
  // firstShape: one distinct line per length and hash. nextShape chains any
  // other distinct line with the same length and hash.
  const firstShape = new Map();
  const nextShape = new Int32Array(count).fill(-1);
  for (const index of firstIndex.values()) {
    const shape = lineKeys[index].length * RUN_HASH_PRIME + lineHash[index];
    if (firstShape.has(shape)) nextShape[index] = firstShape.get(shape);
    firstShape.set(shape, index);
  }

  return function runs(keys, budget) {
    const spend = (steps) => {
      budget.steps += steps;
      return budget.steps <= budget.limit;
    };

    // First line (as its first index) -> key length -> key hash -> keys.
    const groups = new Map();
    for (const key of new Set(keys)) {
      if (key.length > joined.length) continue;
      if (!spend(key.length)) return null;
      const firstLines = [];
      let hash = 0;
      for (let at = 0; at < key.length; at += 1) {
        hash = (hash * RUN_HASH_BASE + key.charCodeAt(at)) % RUN_HASH_PRIME;
        if (at + 1 === key.length) break;
        const shape = firstShape.get((at + 1) * RUN_HASH_PRIME + hash);
        for (let index = shape === undefined ? -1 : shape; index !== -1; index = nextShape[index]) {
          if (!spend(at + 1)) return null;
          if (key.startsWith(lineKeys[index])) firstLines.push(index);
        }
      }
      for (const first of firstLines) {
        if (!groups.has(first)) groups.set(first, new Map());
        const byLength = groups.get(first);
        if (!byLength.has(key.length)) byLength.set(key.length, new Map());
        const byHash = byLength.get(key.length);
        if (!byHash.has(hash)) byHash.set(hash, []);
        byHash.get(hash).push(key);
      }
    }

    const order = [];
    for (const [first, byLength] of groups) {
      for (const [length, byHash] of byLength) order.push({ first, length, byHash });
    }
    order.sort((a, b) => a.first - b.first || a.length - b.length);

    const found = new Set();
    for (const { first, length, byHash } of order) {
      let pending = 0;
      for (const group of byHash.values()) for (const key of group) if (!found.has(key)) pending += 1;
      const power = hashPower(length);
      for (let index = first; index !== -1 && pending > 0; index = nextIndex[index]) {
        if (!spend(1)) return null;
        const start = lineStart[index];
        const end = start + length;
        if (end > joined.length || boundaryHash[end] === -1) continue;
        const runHash = (((boundaryHash[end] - ((boundaryHash[start] * power) % RUN_HASH_PRIME)) % RUN_HASH_PRIME) + RUN_HASH_PRIME) % RUN_HASH_PRIME;
        for (const key of byHash.get(runHash) || []) {
          if (!spend(1)) return null;
          if (found.has(key)) continue;
          if (!spend(length)) return null;
          if (joined.startsWith(key, start)) {
            found.add(key);
            pending -= 1;
          }
        }
      }
    }
    return found;
  };
}

function extractedMatchLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => normalizeMatchText(line));
}

/**
 * The walked blocks that equal one extracted line or a run of consecutive
 * lines, in walk order, each with its text as keptText leaves it. A walked
 * <li> may also match after the extractor's list marker is removed from each
 * line.
 *
 * The run search has a budget of RUN_SEARCH_MIN_STEPS plus
 * RUN_SEARCH_STEPS_PER_CHAR steps per character of line and block text, shared
 * by both lookups. A page that needs more (one line repeated many thousands of
 * times and starting blocks of many different lengths) keeps no block as a
 * run: only blocks equal to one line are kept.
 */
function keptExtractedBlocks(blocks, lines) {
  const keysOf = (texts) => texts.map(matchKey).filter((key) => key.length > 0);
  const lineKeys = keysOf(lines);
  const unmarkedLines = lines.map((line) => line.replace(EXTRACTED_LIST_MARKER, ''));
  const plain = lineIndex(lineKeys);
  const unmarked = unmarkedLines.some((line, index) => line !== lines[index]) ? lineIndex(keysOf(unmarkedLines)) : plain;
  const keyed = blocks
    .map((block) => ({ block, key: matchKey(normalizeMatchText(block.text || '')), listItem: block.listItem === true }))
    .filter(({ key }) => key.length > 0);
  const equalsLine = ({ key, listItem }) => plain.has(key) || (listItem && unmarked.has(key));
  const rest = keyed.filter((entry) => !equalsLine(entry));

  const lineChars = lineKeys.reduce((total, key) => total + key.length, 0);
  const blockChars = keyed.reduce((total, { key }) => total + key.length, 0);
  const budget = { steps: 0, limit: RUN_SEARCH_MIN_STEPS + RUN_SEARCH_STEPS_PER_CHAR * (lineChars + blockChars) };
  const runs = plain.runs(
    rest.map(({ key }) => key),
    budget
  );
  // With no list marker in the text, unmarked is plain and was just searched.
  const listRuns =
    runs &&
    (unmarked === plain
      ? new Set()
      : unmarked.runs(
          rest.filter(({ key, listItem }) => listItem && !runs.has(key)).map(({ key }) => key),
          budget
        ));
  const equalsRun = ({ key, listItem }) => listRuns !== null && (runs.has(key) || (listItem && listRuns.has(key)));
  return keyed.filter((entry) => equalsLine(entry) || equalsRun(entry)).map(({ block }) => ({ ...block, text: keptText(block.text) }));
}

/**
 * True when a content block other than a list item or a leaf container
 * equals one extracted line exactly, compared as normalizeMatchText leaves
 * them. This is the comparison the matcher used before runs, matchKey, list
 * markers, and leaf containers were added, and it must stay that way: a
 * block that only matches as a run, only once matchKey drops invisible
 * characters, or only after the list marker is removed (a two-<p> quote, a
 * <br>-split credit, a paragraph with a zero-width space) would otherwise
 * replace a body the walker has no block for, such as text directly inside
 * a <div> that also has a block element inside it, with itself. A leaf
 * <div> or <section> that equals one line (a standfirst, an Advertisement
 * label) was not a block before leaf containers were walked and did not
 * prevent that fallback then, so it does not prevent it now.
 */
function equalsOneLineExactly(blocks, lines) {
  const exactLines = new Set(lines.filter((line) => line.length > 0));
  return contentBlocks(blocks).some((block) => {
    if (block.listItem === true || block.leafContainer === true) return false;
    const text = normalizeMatchText(block.text || '');
    return matchKey(text).length > 0 && exactLines.has(text);
  });
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
  const walkedBlocks = walkBlocks(articleRoot, {});
  const lines = extractedMatchLines(extracted.text);
  // Keep matched walker blocks only when a content block other than a list
  // item or a leaf container equals one extracted line exactly
  // (equalsOneLineExactly). Otherwise fall back to one block per Trafilatura
  // line. When walker blocks are kept, unmatched lines are not added back:
  // Trafilatura may still emit hidden or newsletter lines the walker
  // correctly excluded. Matching is whole-block, so a fragment that only
  // appears inside a line cannot stop this fallback, and list items or leaf
  // containers alone (a menu, page numbers, or a standfirst Trafilatura
  // kept) cannot either.
  const rawBlocks = equalsOneLineExactly(walkedBlocks, lines)
    ? keptExtractedBlocks(walkedBlocks, lines)
    : blocksFromExtractedText(extracted.text);

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
