# Architecture

Clarity by Manipulation Score is a static, installable PWA. There is no build step, backend, or account system. Analysis runs entirely in the browser.

Screening version **v0.3.3** is defined by `METHODOLOGY_VERSION` in `scoring.js`. User-facing copy on `index.html`, `analyze.html`, `contact.html`, and `methodology.html` should stay aligned with that constant.

## Public surfaces

| Route | File | Role |
|-------|------|------|
| Home | `index.html` | Entry point: Learn or Analyze, product boundaries, trust strip |
| Learn | `learn.html` | Twelve language functions and benign lookalikes |
| Analyze | `analyze.html` | Message input, evidence-linked results, optional local history |
| Method | `methodology.html` | How screening works and where it stops |
| Privacy | `privacy.html` | On-device processing and local history behavior |
| Trust | `limitations.html`, `acceptable-use.html`, `accessibility.html`, `contact.html`, `changelog.html` | Safety, legal, and release infrastructure |

Brand and visual direction live in `BRAND.md` and `DESIGN.md`. Interface work should also read `docs/DESIGN_ENGINEERING.md` and `AGENTS.md`.

## Analysis pipeline

```
User input (analyze.html)
    │
    ▼
text-normalize.js ── normalizeAnalysisText, language check, clause/sentence splits
    │
    ├─► safety.js ── detectSafetyNotice (independent of score)
    │
    └─► scoring.js ── pattern match → signals → band → responses → highlights
            │
            ▼
        app.js ── safe DOM render, stale-result invalidation, history (opt-in)
```

1. **Normalize** — Unicode NFKC, smart quotes, invisible characters, and paragraph boundaries are normalized before any matching (`text-normalize.js`).
2. **Safety** — `detectSafetyNotice` runs on message blocks. A notice is independent of the manipulation band and never implies danger is confirmed (`safety.js`).
3. **Score** — Twelve weighted signal patterns produce evidence spans, a 0–100 score, a Low/Moderate/High band, and pause/boundary/clarify response suggestions (`scoring.js`).
4. **Render** — `app.js` builds DOM nodes (no `innerHTML` for user content), invalidates stale results when text changes, and writes history only when the opt-in checkbox is checked in the submitting tab.

Thread mode splits on blank lines (`splitMessages`), scores each block, and surfaces the highest band plus a count of High/Moderate messages.

### Pilot score suppression

`PILOT_SUPPRESS_NUMERIC_SCORE` in `scoring.js` is currently `true`. The UI shows pattern bands and highlighted evidence, not a numeric manipulation score. History entries store the band label when suppression is active.

## Core modules

| Module | Responsibility |
|--------|----------------|
| `scoring.js` | Signal definitions, `analyzeMessage`, bands, responses, `METHODOLOGY_VERSION` |
| `safety.js` | Safety-notice rules (violence, coercion, stalking patterns) separate from scoring |
| `text-normalize.js` | Normalization, English pilot detection, clause/sentence splitting |
| `app.js` | Analyzer UI, examples, mobile nav, history UI, OCR gate (`BETA_OCR_ENABLED`) |
| `history-storage.js` | Opt-in keys, v1→v2 migration, `localStorage` helpers |
| `ocr.js` / `ocr-clean.js` | On-device Tesseract OCR and screenshot cleanup (gated off in production) |
| `service-worker.js` | Offline app shell, network-first HTML/JS/CSS, cache-first fonts/vendor |
| `styles.css` / `fonts.css` | Pause-field brand tokens, layout, analyzer and legal-page shells |

Vendor OCR assets under `vendor/tesseract/` and `vendor/heic2any/` ship in the app shell but image upload is disabled in the UI and `BETA_OCR_ENABLED` is `false` in `app.js`.

## Privacy and storage

- **No server uploads** — Message text is not sent to a backend for core analysis.
- **History off by default** — `clarity-history-opt-in-v1` must be `"true"` before writes.
- **History key** — `clarity-history-v2` stores up to eight recent analyses when opted in.
- **Migration** — `migrateHistoryStorage` deletes legacy `clarity-history-v1` auto-saves once per browser profile.

Cross-tab storage events sync the opt-in checkbox; writes still require the checkbox in the tab that submits analysis.

## Service worker and caching

`service-worker.js` uses a single cache name (`CACHE_NAME`, currently `clarity-v37`) and two strategies:

- **Network-first** — HTML pages, `styles.css`, `fonts.css`, and application scripts. Fresh deploys win when online; cache serves offline fallbacks.
- **Cache-first** — Self-hosted fonts, Tesseract WASM/data, and other static vendor files.

On `activate`, caches whose names differ from `CACHE_NAME` are deleted.

### Stylesheet cache busting (common pitfall)

GitHub Pages and browser HTTP caches can serve an old `styles.css` even after `CACHE_NAME` is bumped, because the service worker keys on the request URL. After visual or CSS changes:

1. Bump `CACHE_NAME` in `service-worker.js`.
2. Set the same version on **every** HTML route: `./styles.css?v=<CACHE_NAME>` (for example `./styles.css?v=clarity-v37`).
3. Record the cache name in `changelog.html`.
4. Run `node --test tests/*.test.js` — `audit-v032-gate.test.js` asserts worker and release copy consistency.

If only `CACHE_NAME` changes but the `?v=` query stays stale, users can see the previous design until caches expire. This mismatch caused a post-overhaul deploy fix in September 2026.

### Local development

The service worker registers on first visit. When testing cache or shell changes locally, unregister the worker in DevTools → Application → Service Workers, or use a hard refresh, before assuming stale assets reflect your edits.

## Content Security Policy

Public pages set a strict CSP: `default-src 'self'` with no third-party script or font hosts. `analyze.html` additionally allows `wasm-unsafe-eval` and `worker-src blob:` so OCR can be enabled later without a separate CSP pass.

## Test suites

Run all tests:

```bash
node --test tests/*.test.js
```

| File pattern | Focus |
|--------------|-------|
| `project.test.js` | Manifest, service-worker shell assets, CSP, fonts, brand copy, history guards |
| `scoring.test.js` | Signal matching, bands, abstention, thread behavior |
| `privacy-storage.test.js`, `history-migration.test.js` | Opt-in and migration invariants |
| `beta-readiness.test.js` | Benign controls stay Low; safety must-catch corpus |
| `audit-v032-gate.test.js` | Release copy, cache version, OCR disabled, pilot score suppression |
| `audit-v032.test.js`, `audit-v031.test.js` | Methodology version and regression fixtures |
| `audit-r*.test.js`, `benign-adversarial.test.js`, `audit-fixtures.test.js` | Round-specific scoring and safety regressions |
| `gold-report.test.js`, `tests/gold/corpus.js` | Labeled gold harness (regression count, not published accuracy) |
| `trust-pages.test.js` | Legal and methodology page copy |
| `ocr.test.js` | OCR module behavior (vendor present; feature gated off in UI) |

## Release checklist

Use this when shipping a screening or site update:

1. **Methodology** — If rules change, update `scoring.js` / `safety.js`, bump `METHODOLOGY_VERSION`, and sync `methodology.html`, `contact.html`, `index.html`, `analyze.html`, and `changelog.html`.
2. **Cache** — Bump `CACHE_NAME` and every `styles.css?v=` query param to the same value; add a `changelog.html` entry.
3. **Copy** — Confirm limitations, acceptable use, and privacy pages still match behavior.
4. **Tests** — `node --test tests/*.test.js` must pass locally and in CI.
5. **Deploy** — Merge to `main`; GitHub Actions (`.github/workflows/ci.yml`) runs tests then deploys to GitHub Pages (see `README.md` and `docs/HTTPS.md`).

## Related documentation

| Document | Use when |
|----------|----------|
| `README.md` | Local run, deploy, DNS |
| `VISION.md` | Product scope and constraints |
| `BRAND.md` | Clarity voice, palette, experience architecture |
| `DESIGN.md` | Compact design contract for agents and contributors |
| `docs/DESIGN_ENGINEERING.md` | UI implementation guidance |
| `docs/HTTPS.md` | Production HTTPS verification |
| `methodology.html` | User-facing screening explanation |
