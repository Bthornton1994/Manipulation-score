// RSS 2.0 and Atom parser for story discovery. No network. Drops items whose
// links fail the article URL policy. Does not fetch article pages.

import { parseArticleUrl } from '../address-policy.js';

function decodeXml(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tagText(block, name) {
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const match = block.match(pattern);
  return match ? decodeXml(match[1]) : '';
}

function atomLink(block) {
  const alternate = block.match(/<link\b[^>]*\brel=["']alternate["'][^>]*>/i);
  const any = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
  const chosen = alternate ? alternate[0].match(/\bhref=["']([^"']+)["']/i) : null;
  return decodeXml((chosen && chosen[1]) || (any && any[1]) || '');
}

function safeCanonicalUrl(raw) {
  if (!raw || /\s/.test(raw)) return null;
  try {
    const { parsed } = parseArticleUrl(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function parseTime(raw) {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function itemFromBlock(block, source, retrievedAt) {
  const title = tagText(block, 'title');
  const link = tagText(block, 'link') || atomLink(block);
  const published = parseTime(tagText(block, 'pubDate') || tagText(block, 'published') || tagText(block, 'updated'));
  // Feed-supplied tag only. There is no external evidence store behind it.
  const origin = tagText(block, 'mediaLens:originEvidence');
  const canonical = safeCanonicalUrl(link);
  if (!title || !canonical) {
    return { rejected: true };
  }
  return {
    rejected: false,
    record: {
      source_id: source.source_id,
      outlet: source.outlet,
      article_title: title.slice(0, 300),
      published_at: published,
      canonical_url: canonical,
      retrieved_at: retrievedAt,
      feed_url: source.feed_url,
      origin_evidence: origin === 'first_independent_report' ? origin : null
    }
  };
}

export function parseFeedXml(xml, source, retrievedAt) {
  const text = String(xml || '');
  const kind = /<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text) ? 'atom' : 'rss';
  const pattern = kind === 'atom' ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const records = [];
  let rejected = 0;
  let match = pattern.exec(text);
  while (match) {
    const parsed = itemFromBlock(match[1], source, retrievedAt);
    if (parsed.rejected) rejected += 1;
    else records.push(parsed.record);
    match = pattern.exec(text);
  }
  return { format: kind, records, rejected_unsafe_or_incomplete: rejected };
}
