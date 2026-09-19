# Media Lens live URL — operator runbook (v2)

Status: **operational controls only**. Live URL remains **disabled by default**. This document does not enable live URL, live pasted-text, GitHub Pages hosting of Media Lens, or a production-ready claim.

| Field | Value |
| --- | --- |
| Workstream | [Issue #118](https://github.com/Bthornton1994/Manipulation-score/issues/118) |
| Phase | Ops controls for Live URL v2 (kill switch, audit, rate limits, monitoring). Flags stay off. |
| Architecture | `docs/media-lens-live-url-v2-architecture.md` §§16–20 |
| Public site | GitHub Pages remains Clarity-only. `docs/` and `media-lens/` stay off the Pages allowlist. |

Issue #118 is not complete when these controls exist. Independent security review, canary evidence, public-claim review, and explicit owner authorization are still required before any live enablement.

---

## 1. Default posture

Repository and CI defaults:

| Variable | Default | Notes |
| --- | --- | --- |
| `MEDIA_LENS_MODE` | `fixture` | Only `live` if the exact value `live` |
| `MEDIA_LENS_ENABLE_LIVE` | unset / false | Exact string `true` required to *start* live mode |
| `MEDIA_LENS_ENABLE_LIVE_URL` | unset / false | Exact string `true` required **in addition** before `mode: "url"` may fetch |
| `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` | unset / false | Exact string `true` required before the evaluation-only classifier.dev adapter may make outbound calls. Default-off. Not a second independent model |
| `MEDIA_LENS_KILL_SWITCH` | unset / false | Exact string `true` only (same rule as the ENABLE flags). Forces live URL, live Jev, isolated pin verification, and classifier.dev off |
| `MEDIA_LENS_KILL_SWITCH_FILE` | unset | If set and the path exists, same as kill switch |
| `MEDIA_LENS_URL_ALLOWLIST` | empty | Empty means public-address policy only. Canary should set exact hostnames. When set, every redirect hop is re-checked before pin/connect; off-list hops are `live_url_not_allowlisted` |

Misspellings and `TRUE` / `1` / `yes` do not enable anything. They also do not assert the kill switch; use exact `true` or `touch` the kill file.

`/health` reports configured `liveEnabled` / `liveUrlEnabled` plus `killSwitch` (current assertion) and `classifierDev.effectiveEnabled`. If `killSwitch` is true, live URL fetch, live Jev, isolated pin verification, and classifier.dev do not run, even when the enable flags or `MEDIA_LENS_JEV_VERIFY=true` are set.

---

## 2. Staging / canary / production configs

These are operator-run worker configs. They are not GitHub Pages settings. Do not put API keys in git, tickets, or chat.

### Staging (isolated operator machine)

Purpose: exercise live Jev against a mock or a non-production key, **without** article fetch.

```
MEDIA_LENS_MODE=live
MEDIA_LENS_ENABLE_LIVE=true
# MEDIA_LENS_ENABLE_LIVE_URL remains unset
MEDIA_LENS_TYPESAFE_API_KEY=<from a secret store, never git>
MEDIA_LENS_TYPESAFE_BASE_URL=https://api.typesafe.ai   # or a documented mock
# Live Jev uses connect-time IP pinning and does not follow redirects.
# Not production-ready.
MEDIA_LENS_HOST=127.0.0.1
MEDIA_LENS_PORT=8787
MEDIA_LENS_KILL_SWITCH_FILE=/var/lib/media-lens/KILL
MEDIA_LENS_MAX_ANALYSES_PER_MINUTE=10
```

Expected: fixture and live pasted-text stay rejected for paste; `mode: "url"` returns `400 live_url_disabled`. No DNS for user URLs.

### Canary (owner-operated, tiny, not a public product surface)

Purpose: safety/ops rehearsal. Success is “kill switch and SSRF policy work,” not accuracy.

```
MEDIA_LENS_MODE=live
MEDIA_LENS_ENABLE_LIVE=true
MEDIA_LENS_ENABLE_LIVE_URL=true
MEDIA_LENS_TYPESAFE_API_KEY=<secret store>
MEDIA_LENS_HOST=127.0.0.1
MEDIA_LENS_URL_ALLOWLIST=example.com,www.example.com
MEDIA_LENS_KILL_SWITCH_FILE=/var/lib/media-lens/KILL
MEDIA_LENS_MAX_ANALYSES_PER_MINUTE=10
MEDIA_LENS_MAX_LIVE_URL_PER_MINUTE=10
MEDIA_LENS_MAX_LIVE_URL_PER_HOST_PER_MINUTE=3
MEDIA_LENS_MAX_CONCURRENT_LIVE_URL=1
```

Canary abort: pinning test failure, adversarial fixture failure, `model_match` false on the pinned Jev id, Pages allowlist drift, or any suspected SSRF. Production live URL is already off, so a canary abort is not a production incident.

This runbook does **not** authorize turning these flags on in any shared environment.

### Production Clarity site (manipulationscore.com)

The public site must keep Media Lens off Pages. Worker flags stay at repository defaults:

```
MEDIA_LENS_MODE=fixture
# MEDIA_LENS_ENABLE_LIVE unset
# MEDIA_LENS_ENABLE_LIVE_URL unset
# no TypeSafe key in the Pages environment
```

A production live-URL worker is **not authorized** by Issue #118 until every acceptance gate is evidenced and an owner explicitly enables it. If that ever happens, it would still be an operator-run loopback worker, not the Pages artifact, and defaults in this repository should remain off unless the owner changes them in a dedicated enablement PR.

---

## 3. Rate limits

Per worker process, fixed one-minute windows (except concurrency, which is in-flight):

| Limit | Default | Env override | When checked |
| --- | --- | --- | --- |
| Analyses / minute | 10 | `MEDIA_LENS_MAX_ANALYSES_PER_MINUTE` | Before the `/analyze` body is read |
| Live URL attempts / minute | 10 | `MEDIA_LENS_MAX_LIVE_URL_PER_MINUTE` | After JSON parse, on `mode: "url"` |
| Live URL attempts / host / minute | 3 | `MEDIA_LENS_MAX_LIVE_URL_PER_HOST_PER_MINUTE` | After JSON parse, on `mode: "url"` |
| Concurrent live URL fetches | 1 | `MEDIA_LENS_MAX_CONCURRENT_LIVE_URL` | After JSON parse, on `mode: "url"` |

Only the analyses/minute limiter runs before the body is read. Live-URL, per-host, and concurrent limiters need `payload.mode` and the URL, so they run after JSON parse.

Host budget keys on the exact hostname and a registrable-domain approximation (not the full Public Suffix List). Concurrent fetch is also serialized inside `safe-fetch.js`. Exhaustion returns `429 rate_limited`. Setting a live-URL max to `0` rejects all live URL attempts (an extra local brake, not a substitute for the kill switch).

Other existing caps: 512 KiB request body, 60k prepared chars, 200 spans, 8s Jev call, 30s analysis, 8s URL fetch, 2 MiB URL bytes, 3 redirects. Oversized bodies are `413` unless the analyze rate limit already fired (`429` wins).

---

## 4. Kill switch

Two equivalent controls, re-checked on each `/analyze` (and kill-file `stat` each time). Isolated pin verification uses the same assertion before any TypeSafe call:

1. `MEDIA_LENS_KILL_SWITCH=true` — the exact string `true` only, same rule as `MEDIA_LENS_ENABLE_LIVE`, `MEDIA_LENS_ENABLE_LIVE_URL`, and `MEDIA_LENS_ENABLE_CLASSIFIER_DEV`. `TRUE`, `1`, and `yes` do not assert the kill switch.
2. `touch` the path in `MEDIA_LENS_KILL_SWITCH_FILE` (existence, not file contents)

The kill switch stops every external Jev-capable path, including isolated pin verification and classifier.dev:

- Live URL fetch does not run (no DNS, no connect).
- Live Jev does not run.
- classifier.dev does not run (zero `POST /v1/classify`, even if `MEDIA_LENS_ENABLE_CLASSIFIER_DEV=true`).
- Isolated pin verification (`scripts/jev-pin-verify.js`) fail-closes immediately with reason `verify_kill_switch`, exit nonzero, and zero network calls. It does not invoke the TypeSafe adapter. This applies even when `MEDIA_LENS_JEV_VERIFY=true` and a key are set.
- If `MEDIA_LENS_MODE=live`, `/analyze` returns `503 live_killed` (before the body is read).
- Fixture `mode: "fixture"` continues to serve local examples.
- Fixture `mode: "url"` is `400 URL_MODE_REQUIRES_LIVE` even when the kill switch is on. The kill check runs after that gate.

`/health` remains up so operators can confirm `killSwitch: true` without secrets.

---

## 5. Rollback

No history rewrite. Do not rebase or force-push PR #117 / `9cca564`.

1. Assert the kill switch (`MEDIA_LENS_KILL_SWITCH=true` or `touch` the kill file). Confirm live `/analyze` is `503` or fixture-only, that `scripts/jev-pin-verify.js` exits nonzero with `verify_kill_switch`, and that classifier.dev makes zero outbound calls.
2. Unset `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` to disable classifier.dev **without** touching Jev fixture mode. Unset `MEDIA_LENS_ENABLE_LIVE_URL` and/or `MEDIA_LENS_ENABLE_LIVE` to stop live Jev/URL. Restart the worker.
3. Forward-fix or `git revert` the implementation PR on `main`.
4. Rotate `MEDIA_LENS_TYPESAFE_API_KEY` if logs or a proxy might have seen it.
5. If a mistaken Pages allowlist change published `media-lens/` or `docs/`, revert `scripts/build-pages-site.js` and redeploy. Treat that as an incident even if the worker was not hosted there.

---

## 6. Incident response

Do not paste article bodies, span text, URLs with userinfo, or API keys into tickets.

| Class | Immediate action |
| --- | --- |
| Suspected SSRF (metadata/LAN reached) | Kill switch; keep redacted audit lines; do not paste bodies |
| Key leak | Rotate key; kill live; scan git history for the value (should be none) |
| Schema-invalid graphs reaching clients | Pipeline already validate-or-abstains; if bypassed, kill live Jev |
| Abuse (bulk scoring people) | Rate limit / bind localhost; acceptable-use enforcement is human |
| TypeSafe outage | Jev `unavailable` abstention; worker can still serve fixture |

Public communications must not claim that Media Lens “detected an attack” against a named outlet or person. Stick to operational facts (HTTP status, error code, commit SHA).

See architecture §20 for the same rollback and incident classes.

---

## 7. Audit events (JSON lines, redacted)

The worker writes one JSON object per event to stderr (tests may capture a sink). Unknown fields, credentialed URLs, `sk-` values, and `Bearer` tokens are dropped.

| `event` | When |
| --- | --- |
| `live_url_blocked` | URL fetch refused (`live_url_disabled`, allowlist miss including redirect hops, URL mode without live) |
| `ssrf_block` | Policy denial (`BLOCKED_HOST`, `BAD_SCHEME`, `BAD_URL`, `REDIRECT_DOWNGRADE`, `PIN_MISMATCH`) |
| `kill_switch` | Kill switch asserted on a live-mode `/analyze` (`503 live_killed`). Fixture `mode: "url"` is `live_url_blocked` / `URL_MODE_REQUIRES_LIVE` first, not `kill_switch` |
| `rate_limit` | Analyze, live-URL, per-host, or concurrent budget exhausted |
| `analyze_complete` | Response about to be sent (latency and counts only) |
| `classifier_dev_cascade` | Evaluation-only cascade ran (counts, model id, circuit state; never span text) |

Allowed fields include `ts`, `event`, `mode`, `input_mode`, `error`, `scheme`, `host_key` (registrable DNS only, never IP literals or userinfo), `duration_ms`, `jev_calls`, `jev_failures`, `model_match`, `abstention_count`, `limiter`, `kill_switch`. `/health` has no `secrets` object and no bearer strings.

---

## 8. Monitoring metrics

Scrape audit lines and `influence-graph.v1` `engine` / `abstentions` on operator machines. These are operational counters, not accuracy.

| Metric | Source | Notes |
| --- | --- | --- |
| Latency | `analyze_complete.duration_ms` | Worker time, not user-perceived accuracy |
| Failures | HTTP 4xx/5xx; `analyze_complete` absent after `rate_limit` / `kill_switch` | Include `503 live_killed` |
| Retries | Jev adapter: up to 4 attempts, exponential backoff, abort on analysis timeout | Not a first-class audit counter yet; use `jev_failures` and `elapsed_ms` |
| Abstentions | `analyze_complete.abstention_count`; graph `abstentions[].reason` | `engine_unavailable`, `insufficient_text`, `oversized_input`, … |
| Provider errors | `engine.jev.failures`, `model_match: false` | Typed Jev only; not a quality study |
| SSRF blocks | `ssrf_block` count | Should stay non-zero in tests; a production canary spike is an incident |

Also watch: live-URL 429s (`limiter: live_url` / `live_url_host` / `live_url_concurrent`), allowlist blocks, and Pages deploys that might copy `media-lens/` (CI must keep using `scripts/build-pages-site.js`).

---

## 9. What this does not do

- It does not set `MEDIA_LENS_ENABLE_LIVE`, `MEDIA_LENS_ENABLE_LIVE_URL`, or `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` true by default.
- It does not host Media Lens on GitHub Pages.
- It does not enable live pasted-text.
- It does not claim production readiness, real-world accuracy, or that Issue #118 is done.
- It does not replace independent security review or owner authorization.
- It does not treat classifier.dev as a second independent model or as production-ready.

---

## 10. classifier.dev (evaluation-only, independently disableable)

Privacy claims: `docs/media-lens-classifier-dev-privacy.md`. Eval scaffold: `docs/media-lens-classifier-dev-eval.md`.

Default-off. Versioned path only: `POST /v1/classify`. Browser pages must not call classifier.dev.

| Control | Default | Effect |
| --- | --- | --- |
| `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` | unset / false | Exact `true` required for any outbound classify call |
| `MEDIA_LENS_CLASSIFIER_DEV_BASE_URL` | `https://classifier.dev` | Exact production origin `https://classifier.dev` and path `POST /v1/classify`. Other hosts fail closed before connect. Tests may use loopback HTTP. Credentials in the URL are rejected. Redirects are not followed. Outbound HTTPS uses connect-time IP pinning |
| `MEDIA_LENS_CLASSIFIER_DEV_TIER` | `smart` | Escalation uses smart; eval harness may record fast separately |
| `MEDIA_LENS_CLASSIFIER_DEV_TIMEOUT_MS` | 12000 | AbortController timeout; timeouts are not retried |
| `MEDIA_LENS_CLASSIFIER_DEV_MAX_BATCH` | 8 | Local cap below the documented 1000-input ceiling |
| `MEDIA_LENS_CLASSIFIER_DEV_MAX_DAILY_CLASSIFICATIONS` | 200 | In-process budget; exhaustion is explicit `daily_budget`, not an unmarked other model |
| `MEDIA_LENS_CLASSIFIER_DEV_MIN_CONFIDENCE_FOR_ESCALATION` | 0.7 | Jev confidence below this can escalate |
| Circuit breaker | 3 consecutive 502/timeout-class failures | Further spans are `circuit_open` with zero additional calls until reset |
| Kill switch | off | Zero classifier.dev calls, including when the enable flag is true |

Retries: HTTP **429** and **selected 502** codes only (`typesafe`, `typesafe_NNN`, `openrouter_NNN`, `chain_exhausted`, `timeout`, `batch_unavailable`, `upstream_other`), honoring `Retry-After` with exponential backoff capped at 5s. HTTP 3xx is **not** followed (`redirect: manual` plus connect-time pin); off-allowlist `Location` is fail-closed. Malformed bodies fail closed. Unavailable escalation is explicit review/unavailable; Jev is never silently replaced.

`agree_calibrated` requires the reported provider model id to be on the evaluation allowlist (`jev-1.13.0` only). `mixed`, `jev-latest`, unmarked reasoning models, and any other id become review, not calibrated agreement. The reported name is still stored as redacted `cdev_model`.

To disable classifier.dev without touching Jev:

```
unset MEDIA_LENS_ENABLE_CLASSIFIER_DEV
# or
MEDIA_LENS_KILL_SWITCH=true
```

Restart the worker. Confirm `/health` shows `classifierDev.effectiveEnabled: false` and that a mock or probe records zero network calls. This is not a production-ready path.

