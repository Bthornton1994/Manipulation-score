# Architecture

Contributor-oriented overview of how Clarity (Manipulation Score) is structured. For user-facing methodology, see [methodology.html](../methodology.html). For release history, see [changelog.html](../changelog.html).

## Design goals

- **Privacy-first:** all analysis runs in the browser. No accounts, uploads, or analytics.
- **Static delivery:** no bundler or build step for production. ES modules served as-is.
- **Safety before scoring:** harm and coercion language is classified independently of pattern scoring.
- **Deterministic screening:** regex-based signal matching with explicit abstention and calibration rules.

## Versioning

| Identifier | Location | Meaning |
|------------|----------|---------|
| Screening / methodology | `METHODOLOGY_VERSION` in `scoring.js` | Logic version shown to users (currently `0.3.2`) |
| Site package | `version` in `package.json` | Repository package version (`1.0.0`) |
| Service worker cache | `CACHE_NAME` in `service-worker.js` | Bumped when cached assets change (currently `clarity-v34`) |

Keep `METHODOLOGY_VERSION`, `methodology.html`, `changelog.html`, footer copy on `index.html` / `contact.html`, and `CACHE_NAME` aligned when changing screening behavior. `tests/audit-v032-gate.test.js` locks this consistency for v0.3.2.

## Module map

```
index.html
  └── app.js          UI, history, form handling
        ├── scoring.js      Pattern screening engine
        │     ├── safety.js       Safety notices (runs inside scoring)
        │     └── text-normalize.js   Unicode normalization, block splitting
        ├── history-storage.js    localStorage keys + v1→v2 migration
        └── ocr.js              Screenshot OCR (UI disabled in v0.3.2)
              └── ocr-clean.js    Post-OCR line scoring and cleanup
```

| Module | Role |
|--------|------|
| `app.js` | DOM rendering, example messages, opt-in history, stale-result invalidation, service-worker update banner |
| `scoring.js` | Twelve signal families, calibration tiers, leverage clusters, thread aggregation, `analyzeMessage()` |
| `safety.js` | Violence, confinement, self-harm coercion, contextual stalking — independent of manipulation scoring |
| `text-normalize.js` | NFKC normalization, smart-quote folding, blank-line block splitting, English-only heuristic |
| `history-storage.js` | `localStorage` keys and one-time migration from pre-opt-in auto-save |
| `ocr.js` / `ocr-clean.js` | On-device Tesseract pipeline; gated by `BETA_OCR_ENABLED` in `app.js` |
| `service-worker.js` | PWA app-shell cache including vendored OCR assets |

## Analysis pipeline

Entry point: `analyzeMessage(text)` in `scoring.js`.

```
normalizeAnalysisText(text)
  │
  ├─ empty → abstain ("No message")
  │
  ├─ isLikelyUnsupportedLanguage() → abstain (English-only pilot)
  │
  ├─ splitMessages() on blank lines
  │     └─ multiple segments → per-segment analysis + thread rollup
  │
  └─ single segment:
        detectSafetyNotice() → safety result (score suppressed)
        countMeaningfulWords() < 15 → abstain
        analyzeSingleMessage() → score, band, signals, responses, highlights
```

### Thread mode

Messages separated by a blank line (`\n\n`) are scored individually. The overall result reflects the **highest-scoring eligible segment**. Segments that abstain or trigger a safety notice do not contribute a numeric score to the rollup.

### Safety vs scoring

`safety.js` runs **before** pattern scoring on each segment. When a safety notice fires:

- No manipulation score or band is shown.
- `scoreSuppressed` is set; the UI renders the safety notice copy from `SAFETY_NOTICE`.
- Stalking detection requires intrusive behaviors paired with menace, severe intrusion, or multiple eligible behaviors (see module header in `safety.js`).

Safety and scoring share `text-normalize.js` for consistent Unicode handling. `splitMessageBlocks()` in `text-normalize.js` ensures a benign first paragraph does not suppress a threat in a later block.

### Abstention gates

| Gate | Threshold | User-facing effect |
|------|-----------|-------------------|
| Empty input | — | "No message" |
| Unsupported language | English heuristic in `isLikelyUnsupportedLanguage()` | English-only pilot message |
| Short text | `< MIN_MEANINGFUL_WORDS` (15) | Explains word count; no band |

Safety notices can still appear on short messages when explicit harm language is present.

### Controlled Beta UI

`PILOT_SUPPRESS_NUMERIC_SCORE = true` in `scoring.js`. The engine still computes a 0–100 score internally; `app.js` shows pattern bands (Low / Moderate / High) without the numeric value. Opt-in history stores the band label, not the numeric score.

### Response styles

`buildResponses()` in `scoring.js` produces three styles per signal: **pause**, **boundary**, and **clarify**. The UI (`app.js`) currently renders pause and boundary only; clarify is available in the engine for future UI work.

## Signal taxonomy

Twelve families in `SIGNALS` (`scoring.js`): guilt leverage, forced urgency, conditional threat, isolation pressure, reality dismissal, all-or-nothing framing, assigned obligation, reaction minimization, resigned withdrawal, implied rejection, conditional access, responsibility shifting.

Calibration uses specificity tiers (high / medium / low) so a single weak match stays in the Low band. See `methodology.html` for the user-facing explanation.

## Local storage

| Key | Constant | Purpose |
|-----|----------|---------|
| `clarity-history-v2` | `STORAGE_KEY` | Up to 8 recent analyses (text, preview, band label) |
| `clarity-history-opt-in-v1` | `OPT_IN_KEY` | User opt-in flag |
| `clarity-history-migration-v2` | `MIGRATION_KEY` | One-time legacy cleanup marker |

History is **opt-in only**. `saveHistory()` checks the visible checkbox in the submitting tab (`isHistoryEnabledInThisTab()`), not just the persisted flag. A `storage` event listener syncs opt-in state and history across tabs.

Legacy auto-saved history (`clarity-history-v1`) is deleted on first load via `migrateHistoryStorage()`.

## PWA and offline

`service-worker.js` caches the app shell, core modules, fonts, and vendored Tesseract assets. After the first visit, the analyzer works offline.

**Network-first** for safety-critical HTML, CSS, and JS (`app.js`, `scoring.js`, `safety.js`, `history-storage.js`, and trust pages) so deployed fixes reach users quickly. Fonts and vendor OCR assets use cache-first.

When a new service worker activates, `app.js` shows a "Refresh now" banner so users pick up updated screening logic.

## OCR (disabled in v0.3.2)

`BETA_OCR_ENABLED = false` in `app.js` hides image upload controls. The pipeline remains in the codebase:

1. `prepareImageForOcr()` — HEIC conversion, raster normalization
2. `extractTextFromImage()` — Tesseract worker
3. `cleanScreenshotText()` — line scoring, UI chrome removal

Re-enable by setting `BETA_OCR_ENABLED = true` and verifying OCR regression tests (`tests/ocr.test.js`, `tests/audit-v032.test.js`).

## UI behavior contracts

- **Stale results:** editing the message after analysis clears the results panel (`invalidateResults()` on `input`).
- **Safe DOM:** `app.js` uses `textContent` and `createElement`; no `innerHTML` for user or analysis content (empty-state template excepted).
- **History restore:** clicking a history item re-runs analysis without invalidating first (`invalidate: false`).

## Test suite

```bash
node --test tests/*.test.js
# or
npm test
```

| File pattern | Purpose |
|--------------|---------|
| `scoring.test.js` | Core scoring API, bands, responses |
| `audit-r*.test.js` | Regression rounds (R2–R11) for safety and scoring fixes |
| `audit-v031.test.js`, `audit-v032.test.js` | Release gate tests for v0.3.1 / v0.3.2 behavior |
| `audit-v032-gate.test.js` | Locked 40 critical + 40 benign safety corpus; release copy and cache consistency |
| `benign-adversarial.test.js` | False-positive controls |
| `beta-readiness.test.js` | Controlled Beta requirements |
| `privacy-storage.test.js` | Opt-in history and migration |
| `history-migration.test.js` | Legacy storage cleanup |
| `trust-pages.test.js` | Trust/legal page content |
| `ocr.test.js` | OCR pipeline |
| `project.test.js` | Repo-wide invariants (CSP, sitemap, versions) |
| `stabilization-r2.test.js` | Service worker network-first policy; app suppresses patterns for safety/abstention |

CI (`.github/workflows/ci.yml`) runs the full suite on every push and PR to `main`, then deploys to GitHub Pages.

## Common pitfalls

- **Changing regex patterns:** run the full test suite; audit fixtures encode expected behavior for safety and scoring edge cases.
- **Unicode input:** always route user text through `normalizeAnalysisText()` before matching.
- **Thread boundaries:** use `\n\n` (blank line), not single newlines, to separate messages.
- **Version drift:** update `METHODOLOGY_VERSION`, `changelog.html`, `methodology.html`, footer copy, and bump `CACHE_NAME` when shipping logic changes.
- **OCR word counts:** screenshot noise can affect the 15-word abstention gate; keep OCR disabled until re-validated.
- **Safety corpus changes:** update both `criticalSafetyCorpus` and `benignSafetyCorpus` in `audit-v032-gate.test.js` together; the gate requires all 80 fixtures to pass.

## Related docs

- [README.md](../README.md) — setup, deploy, quick start
- [HTTPS.md](./HTTPS.md) — production TLS enforcement
- [methodology.html](../methodology.html) — user-facing screening explanation
- [limitations.html](../limitations.html) — what Clarity cannot do
