# Media Lens Jev / TypeSafe integration notes (v2)

Date: 2026-09-19 UTC.
Issue: GitHub `#118` Phase 2 (typed TypeSafe Jev adapter).
Pinned model: `jev-1.13.0`.
Public docs fetched: `https://docs.typesafe.ai` (index `llms.txt`, API, models, primitives, confidence, jaggedness, JavaScript SDK, legal index).
This file lives under `docs/` and is excluded from GitHub Pages. It is operator/engineering evidence, not a public accuracy claim.

Vision check: **Aligns with constraints** (`VISION.md` sections “Evidence comes before a score”, “Uncertainty must be visible”, “Analyze communication, not identity”, “Privacy is the default architecture”). Jev remains a typed classifier for public Media Lens spans. It is not enabled for Clarity private messages, live URL fetch, or published real-world accuracy.

## 1. What this phase verifies

Phase 2 hardens the existing worker adapter (`media-lens/worker/adapters/jev.js`) against the public TypeSafe HTTP contract. It does **not**:

- enable `MEDIA_LENS_ENABLE_LIVE` in CI or by default
- implement connect-time URL pinning or change `safe-fetch.js` (Phase 3)
- enable live URL analysis or live pasted-text analysis
- edit `privacy.html` or any Clarity core file
- treat Jev output as factual verification, intent, diagnosis, or an outlet/person label

## 2. Verified API shape (from public TypeSafe docs, 2026-09-19)

Verified by fetching the live docs, not by a production key in this environment.

| Item | Verified value |
| --- | --- |
| Evaluate endpoint | `POST https://api.typesafe.ai/v1/systemone` |
| Auth | `Authorization: Bearer <API_KEY>` |
| Content type | `application/json` |
| Request | `{ model, state, questions }` |
| `state` | string, object, or array of text; text only; no image/audio/video |
| `questions` | map of caller-chosen ids to `{ type, instructions, criteria }` |
| Question ids | for application code only; not sent to the model |
| Choice `criteria` | **map** of option id → description (`null` allowed in the SDK; our set uses strings) |
| Score `criteria` | ordered **array** of levels (not used by Media Lens) |
| Noul `criteria` | optional `{ true, false }` |
| Choice answer | `{ type: "choice", choice, probabilities, confidence }` |
| Noul answer | `{ type: "noul", noul }` (no separate confidence) |
| Score answer | `{ type: "score", score, legend, probabilities, confidence }` (unused here) |
| `probabilities` | floats in `[0, 1]` that sum to 1 over every supplied option/level |
| `confidence` | `[0, 1]`, derived from the Choice/Score distribution |
| Response envelope | `{ model, answers, usage }` |
| `model` in the response | versioned id that actually answered (pin aliases by logging this) |
| Models list | `GET /v1/models` (lists aliases; versioned ids such as `jev-1.13.0` are still accepted) |
| Errors | `401` missing/invalid key; `422` request validation; `429` rate limit; `529` overloaded |
| SDK retry statuses | `408`, `429`, `500–599`; honor `Retry-After` / `retry-after-ms` |
| Default SDK retries | `maxRetries: 2` after the first attempt; Media Lens keeps 4 total attempts from the existing Newsjack-ported shape |
| Default SDK model alias | `jev-latest` → currently `jev-1.13.0` (aliases can move; we pin the versioned id) |

Pinned `jev-1.13.0` limits from `https://docs.typesafe.ai/models.md`:

- Price: $42 / billion input tokens ($0.042 / million). Output tokens free. This is a public list price. It is not an account invoice, and it is not `MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL`. The narrow-shadow planning token fence is the universal bound in `docs/jev-usage-lab/narrow-shadow-request-bound.v1.json` (`T_max = ceil(charBound / 3)`). That fence is not provider-measured and not a dollar estimate. The narrow estimate stays unset.
- Rate: 250,000 tokens/second and 1,200 requests/minute (docs say these can change without notice).
- Context: 64k tokens per request; 32k for `state` plus the longest question.
- Input: text only.

## 3. Media Lens request we actually send

One HTTP call per span (not one call per article). Questions are batched per span.

```
POST {baseUrl}/v1/systemone
Authorization: Bearer {MEDIA_LENS_TYPESAFE_API_KEY}
{
  "model": "jev-1.13.0",
  "state": {
    "artifact": { "kind": "...", "title": "..." },
    "span": { "id": "...", "role": "...", "text": "<capped at 1200 chars>" },
    "context": { "before": "<capped at 400 chars or null>", "after": "<capped at 400 chars or null>" }
  },
  "questions": <contents of worker/jev/questions.v1.json>
}
```

`influence_signal` is a Choice over eleven taxonomy ids plus `none`. `selective_context_candidate` is **not** a Jev option; fusion assigns that id from deterministic coverage/quote rules only.

`is_quoted_or_attributed` is a Noul. Fusion may move a deterministically authorial span to `uncertain` when `noul >= 0.70`. Jev is never the authority for authorship and never sets claim `support` to anything other than what fusion already does (`not_checked` in this preview).

Question-set hash: `sha256(canonical JSON of questions.v1.json)` stored in `questions.v1.sha256` and copied into `engine.jev.question_set_sha256`.

## 4. Adapter failure modes (v2)

| Condition | Adapter disposition | Fusion effect today |
| --- | --- | --- |
| Valid Choice/Noul, `confidence >= 0.5` | `ok` | observations may be emitted from thresholds in `fusion.js` |
| Valid Choice/Noul, `confidence < 0.5` | `review` (answers still returned) | still subject to 0.45/0.60 probability thresholds; calibration counts review separately |
| Missing span, malformed JSON, incomplete live distribution, unknown option, choice not argmax, NaN/out-of-range, missing `type` | `unavailable` + `failedSpanIds` | span `engine_failure` abstention; >20% failures unreview the Language dimension |
| `401` / `422` / other non-retryable HTTP | `unavailable` (`http_NNN`), no retry | same |
| `408` / `429` / `5xx` including `529` | retry up to 4 attempts, then `unavailable` | same |
| Transport error or per-attempt timeout | retry, then `unavailable` (`timeout` or `transport_error:...`) | same |
| Caller abort (per-analysis timeout) | stop immediately, `aborted`; unstarted spans are not counted | analyze.js serves graph-level `engine_unavailable` |
| Reported `model` ≠ `jev-1.13.0` | answers may still be kept; `modelMatch === false` | fusion marks Jev observations `needs_review` and adds `model_mismatch` |

Free-form fields (`explanation`, generated text, extra question ids) are stripped. They are never used as labels, claim support, or UI copy.

Live responses must include a **complete** probability map over every Choice option, summing to 1 ± 1e-6. Recorded fixture answers may omit near-zero options (Phase 0 files) as long as listed keys are in-range, the chosen id is present, and it is the argmax. That fixture leniency is documented; it is not treated as the live contract.

## 5. License and data-handling notes

Verified from `https://docs.typesafe.ai/legal.md` and `https://docs.typesafe.ai/models.md`:

- TypeSafe publishes a Data Processing Agreement, Master Customer Agreement, and Privacy Policy.
- Docs state Jev is not trained on customer requests or responses.
- Zero data retention (ZDR) is described as an enterprise option via `privacy@typesafe.ai`.

Assumed / not independently archived in this repo:

- Full DPA/MCA/Privacy Policy text (the legal index did not inline them in the fetched Markdown).
- Exact retention hours for non-ZDR accounts.
- Whether a future `jev-latest` alias move would still accept `jev-1.13.0` (docs currently say versioned ids remain accepted).

This worker does not depend on `@typesafe-ai/sdk`. Live TypeSafe HTTPS uses the repository-owned pinned HTTP client (connect-time IP pin, no redirect follow, zero new dependencies), not global `fetch` on the hostname. Retry statuses and `Retry-After` behavior were copied from the public SDK docs, with a 5s cap on honored retry delay so CI cannot be stalled by a huge header.

Newsjack: only the existing retry-attempt shape is ported (MIT, Elvis Sun, commit `bdb41b8`). The question set is Media Lens’s, not Newsjack’s PR-relevance questions. See `docs/NEWSJACK-LICENSE.md`.

## 6. Calibration / quality eval

`media-lens/worker/jev/calibration.js` plus labeled cases under `media-lens/fixtures/jev-calibration/` measure, on synthetic fixtures:

- exact class match
- binary signal confusion (TP/FP/FN/TN), excluding abstentions
- abstention count (`unavailable` / malformed)
- review count (`confidence < 0.5`)

The same cases run in fixture mode (no network) and against a mock HTTP server that speaks the pinned live contract.

These numbers are software-consistency checks. They are **not** sensitivity, specificity, fairness, or real-world accuracy. `VISION.md` forbids publishing those claims without representative validation of the exact claim.

## 7. Live call policy

Automated tests call TypeSafe only when **both** are true:

- `MEDIA_LENS_TYPESAFE_API_KEY` is set in the environment
- `MEDIA_LENS_ENABLE_LIVE=true` (exact string)

Otherwise `tests/media-lens-jev-live-optional.test.js` **skips** (does not fail). CI must not set a production key. Keys are never committed (`.env` is gitignored; `worker/config.js` is the only worker module that reads `process.env`).

Live URL fetch remains disabled by default. `MEDIA_LENS_TYPESAFE_BASE_URL` may point tests at a loopback mock; it is not a live-URL enablement flag.

### Isolated pin verify (Phase 4)

`scripts/jev-pin-verify.js` is a separate fail-closed gate. It runs only when `MEDIA_LENS_JEV_VERIFY=true` (exact string) **and** `MEDIA_LENS_TYPESAFE_API_KEY` is set, and the kill switch is not asserted. `MEDIA_LENS_KILL_SWITCH=true` (exact), an existing `MEDIA_LENS_KILL_SWITCH_FILE`, or a kill-file `stat` error stops this path immediately (`verify_kill_switch`, no TypeSafe adapter, zero network calls). A missing kill file does not assert. Default `node --test tests/*.test.js` CI does not set that flag and uses mock servers only.

The gate sends `model: "jev-1.13.0"` with invented spans from `media-lens/fixtures/articles/`. It asserts `response.model === "jev-1.13.0"`. If the API rejects the versioned id, the gate fails. It does not fall back to `jev-latest`. Answers must match the typed adapter shape; extra keys are ignored; out-of-taxonomy choices fail closed through the existing adapter. The JSON report (commit SHA, timestamp, pass/fail, optional diagnostic diff vs fixture answers) is a local or CI artifact. It is not an accuracy claim, not a quality study, and not production-ready. Do not copy that report into `docs/`. Optional workflow: `.github/workflows/jev-pin-verify.yml` (`workflow_dispatch` only).

## 8. Assumed vs unverified

| Topic | Status |
| --- | --- |
| HTTP request/response field names and primitive criteria shapes | Verified from public docs 2026-09-19 |
| `jev-1.13.0` as current `jev-latest` target | Verified from models page |
| Rate/price/context numbers | Verified from models page as of that fetch; docs warn they can change |
| Exact `confidence` formula | Unverified (docs say it is derived from `probabilities`; we threshold the returned number) |
| Production TypeSafe response for our question set | Unverified in this environment (no API key; optional live test skipped) |
| Real-world FP/FN of influence classification | Unverified; synthetic fixtures only |
| DNS rebinding / connect-time pinning for article fetch | Implemented in `safe-fetch.js` (still default-off; not production-ready) |
| DNS rebinding / connect-time pinning for live Jev and classifier.dev | Implemented in `provider-pinned-fetch.js` for network paths only (still default-off; not production-ready) |
