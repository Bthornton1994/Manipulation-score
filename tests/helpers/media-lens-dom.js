// Minimal DOM for driving media-lens/media-lens.js under node:test.
//
// The tree is parsed from the real media-lens/index.html, so tests exercise
// the shipped markup: ids, hidden and data-local-only attributes, labels,
// fieldsets, and the loading stage list. Only the selectors the page
// script uses are supported; anything else throws so a test fails loudly
// instead of silently matching nothing. innerHTML is stored as a string
// and is not parsed into child elements.
//
// Each loadMediaLensPage() call imports a fresh module instance (a unique
// query string), so the page's host-mode constants are computed from that
// call's fake location.

import { readFile } from 'node:fs/promises';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TAG_PATTERN = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gi;
const ATTR_PATTERN = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const SELECTOR_PATTERN = /^([a-z][a-z0-9]*)?((?:\[[a-z-]+(?:="[^"]*")?\])*)(:checked)?$/i;
const SELECTOR_ATTR_PATTERN = /\[([a-z-]+)(?:="([^"]*)")?\]/gi;

function camelData(name) {
  return name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseSelector(selector) {
  const match = SELECTOR_PATTERN.exec(selector.trim());
  if (!match) throw new Error(`fake DOM does not support selector: ${selector}`);
  const attrs = [...(match[2] || '').matchAll(SELECTOR_ATTR_PATTERN)].map((m) => ({ name: m[1], value: m[2] }));
  return { tag: match[1] ? match[1].toUpperCase() : null, attrs, checked: Boolean(match[3]) };
}

function matchesSelector(el, selector) {
  if (!(el instanceof FakeElement)) return false;
  const parsed = parseSelector(selector);
  if (parsed.tag && el.tagName !== parsed.tag) return false;
  for (const { name, value } of parsed.attrs) {
    const actual = el.getAttribute(name);
    if (actual === null) return false;
    if (value !== undefined && actual !== value) return false;
  }
  if (parsed.checked && !el.checked) return false;
  return true;
}

export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.defaultPrevented = false;
    for (const [key, value] of Object.entries(init)) {
      if (key !== 'bubbles') this[key] = value;
    }
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

function setEventTarget(event, target) {
  if (event.target) return;
  // Node's Event exposes target as a prototype getter; an own property
  // shadows it without touching the prototype.
  Object.defineProperty(event, 'target', { value: target, configurable: true, writable: true });
}

function runListeners(listeners, event) {
  for (const fn of listeners.get(event.type) || []) fn(event);
}

export class FakeElement {
  constructor(doc, tagName, attrs = {}) {
    this.ownerDocument = doc;
    this.tagName = String(tagName).toUpperCase();
    this.attributes = { ...attrs };
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.textHistory = [];
    this._text = '';
    this.innerHTML = '';
    this.hidden = Object.prototype.hasOwnProperty.call(attrs, 'hidden');
    this.disabled = Object.prototype.hasOwnProperty.call(attrs, 'disabled');
    this.checked = Object.prototype.hasOwnProperty.call(attrs, 'checked');
    this.open = Object.prototype.hasOwnProperty.call(attrs, 'open');
    this.value = attrs.value ?? '';
    this.id = attrs.id || '';
    this.className = attrs.class || '';
    this.type = attrs.type || '';
    this.tabIndex = attrs.tabindex !== undefined ? Number(attrs.tabindex) : 0;
    this.dataset = {};
    for (const [name, value] of Object.entries(attrs)) {
      if (name.startsWith('data-')) this.dataset[camelData(name)] = value;
    }
    this.style = {};
  }

  get textContent() {
    return this._text;
  }

  set textContent(value) {
    this._text = String(value);
    this.textHistory.push(this._text);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'hidden') this.hidden = true;
    if (name === 'open') this.open = true;
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) {
    if (name === 'hidden') return this.hidden ? '' : null;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'hidden') this.hidden = false;
    if (name === 'open') this.open = false;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  dispatchEvent(event) {
    setEventTarget(event, this);
    runListeners(this.listeners, event);
    if (event.bubbles) {
      let node = this.parentNode;
      while (node) {
        runListeners(node.listeners, event);
        node = node.parentNode;
      }
      runListeners(this.ownerDocument.listeners, event);
    }
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent(new FakeEvent('click', { bubbles: true }));
  }

  focus() {
    this.ownerDocument.activeElement = this;
    this.ownerDocument.focusLog.push(this.id || this.tagName.toLowerCase());
  }

  // Records which element was brought into view, and how, so tests can
  // check that an error is scrolled on screen.
  scrollIntoView(options) {
    this.ownerDocument.scrollLog.push({ id: this.id || this.tagName.toLowerCase(), options: options ?? null });
  }

  showModal() {
    this.open = true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    // Browsers fire "close" after the current task, not synchronously.
    queueMicrotask(() => this.dispatchEvent(new FakeEvent('close')));
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  closest(selector) {
    let node = this;
    while (node instanceof FakeElement) {
      if (matchesSelector(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }

  *descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  querySelectorAll(selector) {
    return [...this.descendants()].filter((el) => matchesSelector(el, selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  contains(other) {
    let node = other;
    while (node) {
      if (node === this) return true;
      node = node.parentNode;
    }
    return false;
  }

  appendChild(child) {
    if (child.parentNode) child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const node of nodes) this.appendChild(node);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  // True when this element and every ancestor are not hidden.
  isRendered() {
    let node = this;
    while (node instanceof FakeElement) {
      if (node.hidden) return false;
      node = node.parentNode;
    }
    return true;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.readyState = 'complete';
    this.focusLog = [];
    this.scrollLog = [];
    this.documentElement = new FakeElement(this, 'html');
    this.body = null;
    this.activeElement = null;
  }

  getElementById(id) {
    if (this.documentElement.id === id) return this.documentElement;
    for (const el of this.documentElement.descendants()) if (el.id === id) return el;
    return null;
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }

  createElement(tag) {
    return new FakeElement(this, tag);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
}

function parseAttributes(source) {
  const attrs = {};
  for (const match of source.matchAll(ATTR_PATTERN)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

export function parseIntoDocument(html, doc = new FakeDocument()) {
  const stack = [doc.documentElement];
  let last = 0;
  for (const match of html.matchAll(TAG_PATTERN)) {
    const text = html.slice(last, match.index);
    last = match.index + match[0].length;
    const top = stack[stack.length - 1];
    if (text.trim()) top._text += text.replace(/\s+/g, ' ');
    if (!match[2]) continue;
    const [, closing, rawTag, rawAttrs, selfClosing] = match;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const index = stack.map((el) => el.tagName).lastIndexOf(tag.toUpperCase());
      if (index > 0) stack.length = index;
      continue;
    }
    if (tag === 'html') {
      Object.assign(doc.documentElement.attributes, parseAttributes(rawAttrs));
      continue;
    }
    const el = new FakeElement(doc, tag, parseAttributes(rawAttrs));
    top.appendChild(el);
    if (tag === 'body') doc.body = el;
    if (!VOID_TAGS.has(tag) && !selfClosing) stack.push(el);
  }
  doc.activeElement = doc.body;
  return doc;
}

export const LIVE_HEALTH = Object.freeze({
  status: 'ok',
  mode: 'live',
  liveEnabled: true,
  liveUrlEnabled: true,
  killSwitch: false,
  jev: { mode: 'live', hasApiKey: true }
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function pendingUntilAbort(init) {
  return new Promise((_, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });
}

async function fixtureResponse(url) {
  const id = /\.\/fixtures\/expected\/(synthetic-\d{2}-[a-z0-9-]+)\.graph\.json$/.exec(url)?.[1];
  if (!id) return new Response('not found', { status: 404 });
  const body = await readFile(new URL(`../../media-lens/fixtures/expected/${id}.graph.json`, import.meta.url), 'utf8');
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

let instanceCounter = 0;

/**
 * Load index.html into a fake DOM and import a fresh media-lens.js.
 *
 * @param {object} options
 * @param {string} [options.href] page URL; decides the host mode
 * @param {boolean} [options.fixturePreview] add the fixture-preview meta
 * @param {object|Function} [options.health] /health body, null for a network
 *   failure, or (callIndex) => body to vary the answer between checks
 * @param {Function} [options.analyze] (payload, init, callIndex) => Response | 'pending'
 * @param {Function} [options.fixture] (url) => Response, default serves in-repo fixtures
 */
export async function loadMediaLensPage(options = {}) {
  const href = options.href || 'https://ml-jev.manipulationscore.com/media-lens/';
  const html = await readFile(new URL('../../media-lens/index.html', import.meta.url), 'utf8');
  const doc = parseIntoDocument(html);
  if (options.fixturePreview) {
    const head = doc.documentElement.querySelector('head');
    head.appendChild(new FakeElement(doc, 'meta', { name: 'media-lens-fixture-preview', content: 'true' }));
    // The page reads meta content through the property.
    head.querySelector('meta[name="media-lens-fixture-preview"]').content = 'true';
  }

  const url = new URL(href);
  const location = {
    href: url.href,
    protocol: url.protocol,
    host: url.host,
    hostname: url.hostname,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash
  };
  const historyCalls = [];
  const intervals = [];
  const fakeWindow = {
    location,
    history: {
      replaceState(state, title, next) {
        historyCalls.push(String(next));
        const resolved = new URL(String(next), location.href);
        location.pathname = resolved.pathname;
        location.search = resolved.search;
        location.hash = resolved.hash;
        location.href = resolved.href;
      }
    },
    setInterval(fn) {
      intervals.push(fn);
      return intervals.length;
    },
    clearInterval(handle) {
      intervals[handle - 1] = null;
    }
  };

  const fetchCalls = [];
  let analyzeCount = 0;
  let healthCount = 0;
  async function fakeFetch(input, init = {}) {
    const target = String(input);
    const call = { url: target, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null };
    fetchCalls.push(call);
    if (target.endsWith('/health')) {
      healthCount += 1;
      const health = typeof options.health === 'function' ? options.health(healthCount) : options.health;
      if (health === null) throw new TypeError('Failed to fetch');
      return jsonResponse(health || LIVE_HEALTH);
    }
    if (target.endsWith('/analyze')) {
      analyzeCount += 1;
      const result = options.analyze ? await options.analyze(call.body, init, analyzeCount) : jsonResponse({ error: 'not_found' }, 404);
      if (result === 'pending') return pendingUntilAbort(init);
      return result;
    }
    if (target.startsWith('./fixtures/')) {
      return options.fixture ? options.fixture(target) : fixtureResponse(target);
    }
    throw new Error(`unexpected fetch in test: ${target}`);
  }

  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    fetch: globalThis.fetch
  };
  globalThis.window = fakeWindow;
  globalThis.document = doc;
  globalThis.Element = FakeElement;
  globalThis.fetch = fakeFetch;

  instanceCounter += 1;
  const mod = await import(`../../media-lens/media-lens.js?page=${instanceCounter}`);

  async function flush(rounds = 6) {
    for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
  }

  // Waits for real I/O (fixture reads, Response bodies) to settle.
  async function waitFor(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('waitFor timed out');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await flush();
  }
  await flush();

  function restore() {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }

  const byId = (id) => doc.getElementById(id);
  return {
    mod,
    document: doc,
    window: fakeWindow,
    fetchCalls,
    historyCalls,
    intervals,
    byId,
    flush,
    waitFor,
    restore,
    jsonResponse,
    announcements: () => byId('analyze-status-live').textHistory.slice(),
    async submitConsent() {
      const checkbox = byId('consent-checkbox');
      checkbox.checked = true;
      checkbox.dispatchEvent(new FakeEvent('change', { bubbles: true }));
      byId('analyze-form').dispatchEvent(new FakeEvent('submit', { bubbles: true }));
      await flush();
    },
    keydown(el, key) {
      const event = new FakeEvent('keydown', { bubbles: true, key, isComposing: false });
      el.dispatchEvent(event);
      return event;
    }
  };
}
