# Clarity architecture

Contributor-oriented overview of how the Manipulation Score / Clarity static PWA is structured, how analysis runs on-device, and how releases are verified.

**Screening version:** `METHODOLOGY_VERSION` in `scoring.js` (currently `0.3.3`). User-facing pages echo this in footers and `methodology.html`.

## Site layout

Clarity is a zero-build static site deployed to GitHub Pages. There is no bundler or package install for runtime code.

| Page | Role |
|------|------|
| `index.html` | Platform home — routes visitors to Learn or Analyze |
| `learn.html` | Twelve language functions, lookalikes, and deep links to Analyze examples (`?e=0` … `?e=3`) |
| `analyze.html` | Message screener UI (form, results, opt-in history) |
| `methodology.html` | User-facing methodology, limitations, and regression-disclosure copy |
| `privacy.html`, `terms.html`, `limitations.html`, `acceptable-use.html`, `accessibility.html`, `contact.html`, `changelog.html` | Trust and legal pages |

Navigation, footer links, and `sitemap.xml` should stay aligned across these pages when adding routes.

## Analysis pipeline

All screening runs in the browser. No message text is uploaded.

```
User input (analyze.html / app.js)
        │
        ▼
normalizeAnalysisText()          ← text-normalize.js (NFKC, smart quotes, whitespace)
        │
        ├─ isLikelyUnsupportedLanguage? → abstain (English-only pilot)
        │
        ├─ splitMessages() (blank-line blocks) → thread mode
        │       └─ per-segment: safety → word count → scoring → threadSummary
        │
        ├─ detectSafetyNotice()        ← safety.js (independent of score)
        │       └─ safety notice result (score suppressed)
        │
        ├─ countMeaningfulWords() < MIN_MEANINGFUL_WORDS (15)? → abstain
        │
        └─ analyzeSingleMessage()      ← scoring.js
                ├─ clause-aware pattern match + context exclusions
                ├─ signal severity + leverage clusters
                ├─ band (Low / Moderate / High) — numeric score hidden when PILOT_SUPPRESS_NUMERIC_SCORE
                └─ pause / boundary / clarify responses
```

**Safety is separate from scoring.** `safety.js` can return a notice without a manipulation band. Thread mode surfaces a safety notice if any segment triggers one.

**Thread mode:** Messages separated by blank lines are screened individually. The combined result keeps the highest band and adds a `threadSummary` (counts of High/Moderate segments). This is not a verdict on the whole conversation.

## Core modules

| Module | Responsibility |
|--------|----------------|
| `scoring.js` | Twelve signal patterns, exclusions, bands, responses, `analyzeMessage()` |
| `safety.js` | Violence, confinement, stalking, weapons, self-harm coercion; fiction/training/logistics filters |
| `text-normalize.js` | Unicode normalization, clause/sentence splitting, English-only heuristic |
| `app.js` | DOM rendering, form state, history UI, stale-result invalidation, mobile nav |
| `history-storage.js` | Opt-in `localStorage` keys and v1→v2 migration |
| `ocr.js` / `ocr-clean.js` | On-device Tesseract OCR and screenshot cleanup (gated off in UI) |
| `service-worker.js` | Offline app shell; network-first for HTML/JS/CSS |

### Public scoring API

Primary entry point for tests and UI:

```js
import { analyzeMessage, METHODOLOGY_VERSION } from './scoring.js';

const result = analyzeMessage(text);
// result.band, result.signals, result.safetyNotice, result.abstained,
// result.segments (thread), result.threadSummary, result.methodologyVersion
```

`detectSafetyNotice(text)` from `safety.js` is also exported for safety-only checks.

### History storage

- **Opt-in:** Checkbox in Analyze must be checked in the submitting tab (`isHistoryEnabledInThisTab` in `app.js`).
- **Keys:** `clarity-history-v2`, `clarity-history-opt-in-v1` (`history-storage.js`).
- **Migration:** Legacy `clarity-history-v1` is deleted once on first load after upgrade.
- **Cap:** Last 8 analyses (`MAX_HISTORY` in `app.js`).
- Results clear when message text changes before re-analysis.

### OCR (disabled)

`BETA_OCR_ENABLED = false` in `app.js`. The Analyze page keeps a disabled image-upload control for a future gate. Vendor assets (Tesseract WASM, HEIC converter) are cached in the service worker but not required for core screening.

### Service worker caching

- **Cache name:** `CACHE_NAME` in `service-worker.js` (bump on every release that changes cached assets; currently `clarity-v35`).
- **Strategy:** Network-first for HTML, CSS, and application JS; cache-first for fonts and vendor blobs.
- **Install:** `APP_SHELL` must list every path the offline shell needs; `tests/project.test.js` verifies listed assets exist.

See also [HTTPS.md](./HTTPS.md) for production TLS expectations.

## Testing

```bash
node --test tests/*.test.js
```

CI runs the same command on push/PR to `main` (`.github/workflows/ci.yml`).

| Suite | Purpose |
|-------|---------|
| `scoring.test.js` | Unit tests for bands, signals, highlights, thread split |
| `gold-report.test.js` + `tests/gold/corpus.js` | Locked benign, autonomy, coercive, and hard-neutral regression slices |
| `audit-v032-gate.test.js` | 40 critical + 40 benign safety corpus (exported for gold harness) |
| `audit-v032.test.js`, `audit-v031.test.js` | Version-locked methodology assertions |
| `beta-readiness.test.js` | Benign controls, safety must-catch, calibration smoke checks |
| `benign-adversarial.test.js`, `audit-r*.test.js` | Round regression fixtures |
| `privacy-storage.test.js`, `history-migration.test.js` | Storage opt-in and migration |
| `trust-pages.test.js`, `project.test.js` | Site integrity, CSP, self-hosted assets, readme contracts |
| `ocr.test.js` | OCR module (when enabled) |

**Gold harness constraints (v0.3.3):**

- `dailyBenign` (≥80 cases): no safety notice; Low or abstain.
- `autonomy` (≥40): no Moderate+ obligation; Low or abstain.
- `coercive` (≥40): meets minimum band; required functions present.
- `hardNeutral`: edge cases that must not false-alarm.
- Safety gate: all `criticalSafetyCorpus` must trigger; `benignSafetyCorpus` must not.

Regression counts are **not** representative accuracy. Do not publish sensitivity/specificity claims from these suites alone (`methodology.html`, `VISION.md`).

## Release checklist (contributors)

1. Update scoring/safety logic and matching tests.
2. Set `METHODOLOGY_VERSION` in `scoring.js` when methodology changes.
3. Bump `CACHE_NAME` in `service-worker.js` and add any new static assets to `APP_SHELL`.
4. Sync `changelog.html`, footers, `contact.html` version note, and `methodology.html`.
5. Run `node --test tests/*.test.js`.
6. Push to `main` — GitHub Actions deploys to GitHub Pages.

## Related docs

- [README.md](../README.md) — run locally, deploy, DNS
- [VISION.md](../VISION.md) — product boundaries and decision tests
- [AGENTS.md](../AGENTS.md) — agent/human engineering guardrails
- [methodology.html](../methodology.html) — user-facing screening description
