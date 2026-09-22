# Media Lens (preview)

Media Lens is an experimental, unreleased mode of Manipulation Score for analyzing **public** material — articles, advertisements, speeches, and campaign pages — as opposed to Clarity, which analyzes private messages entirely on-device. Media Lens is not deployed to the production site (`media-lens/` is excluded from the GitHub Pages build) and is isolated from Clarity: no Clarity file imports anything here, and no file here imports a Clarity module.

Media Lens produces evidence-linked observations across four separate dimensions — **Language**, **Claims**, **Coverage**, and **Source context** — as an `influence-graph.v1` document. It never produces an overall 0-100 score for an article, and no field labels a person or outlet as manipulative. See `docs/media-lens-build-brief.md` (owner brief) and `docs/media-lens-influence-graph-plan.md` (implementation plan) for the full product and architecture rationale.

## Architecture

A local Node `http` worker (`worker/server.js`, zero dependencies) owns all network access, keys, and limits. The browser page (`index.html` + `media-lens.js`) is a thin renderer that only talks to that worker, at `http://127.0.0.1:8787` or `http://localhost:8787` (the only two origins allowed by the page's Content Security Policy).

```
media-lens/
  index.html, media-lens.js, media-lens.css   browser UI (own CSP; not linked from the deployed site)
  schema/                                     influence-graph.v1 JSON Schema doc, hand-written validator, taxonomy
  worker/                                     prepare -> newsjack adapter -> jev adapter -> fusion -> graph pipeline
  fixtures/                                   synthetic example articles + fixture answers + golden expected output
```

## Modes

Set with `MEDIA_LENS_MODE` (default `fixture`):

- **`fixture`** — the only mode automated tests and CI exercise. No outbound network at all. The Jev and Newsjack adapters read local JSON fixtures under `fixtures/jev/` and `fixtures/newsjack/`.
- **`live`** — refuses to start unless **both** `MEDIA_LENS_ENABLE_LIVE=true` and `MEDIA_LENS_TYPESAFE_API_KEY` are set. Live pasted-text analysis is disabled and is rejected before any external request. Live URL fetch is experimental, **disabled by default**, and additionally requires `MEDIA_LENS_ENABLE_LIVE_URL=true`. It is not production-ready. When those gates pass, prepared public span text from a fetched URL may be sent to TypeSafe's Jev classifier over HTTPS. Newsjack provenance in live mode is read from an **operator-provided artifacts directory** (`MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR`) — the worker never spawns the Newsjack CLI and never calls a live news-search service.

Worker environment variables (read only by `worker/config.js`, never logged, never returned by `/health`):

| Variable | Purpose |
| --- | --- |
| `MEDIA_LENS_MODE` | `fixture` (default) or `live` |
| `MEDIA_LENS_ENABLE_LIVE` | explicit opt-in; must be the exact value `true` before live mode can start (default: unset/false) |
| `MEDIA_LENS_ENABLE_LIVE_URL` | exact value `true` required **in addition** before `mode: "url"` may fetch; live Jev tests must not open article fetch (default: unset/false) |
| `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` | exact value `true` required before the evaluation-only classifier.dev adapter may call `POST /v1/classify` (default: unset/false; not a second independent model) |
| `MEDIA_LENS_CLASSIFIER_DEV_BASE_URL` | HTTPS production origin must be exactly `https://classifier.dev` (path `POST /v1/classify`). Other hosts and schemes fail closed before connect. Tests may use loopback HTTP. Redirects are not followed |
| `MEDIA_LENS_CLASSIFIER_DEV_TIER` | unset/empty → `fast`. Smart escalation requires the exact value `smart` (`SMART` / `Smart` do not select smart; same exact-match rule as ENABLE flags) |
| `MEDIA_LENS_CLASSIFIER_DEV_TIMEOUT_MS` | per-request AbortController timeout (default 12000) |
| `MEDIA_LENS_CLASSIFIER_DEV_MAX_BATCH` | local batch cap (default 8) |
| `MEDIA_LENS_CLASSIFIER_DEV_MAX_DAILY_CLASSIFICATIONS` | in-process daily classification budget (default 200) |
| `MEDIA_LENS_CLASSIFIER_DEV_MIN_CONFIDENCE_FOR_ESCALATION` | Jev confidence below this may escalate (default 0.7) |
| `MEDIA_LENS_KILL_SWITCH` | exact value `true` forces live URL fetch, live Jev, isolated pin verification, and classifier.dev off regardless of the enable flags (default: unset/false) |
| `MEDIA_LENS_KILL_SWITCH_FILE` | if set and the path exists, same as kill switch; a missing file does not assert; permission/IO/`stat` errors fail-closed as asserted; re-checked per request so ops can `touch` the file |
| `MEDIA_LENS_URL_ALLOWLIST` | optional comma-separated exact hostnames for canary; empty means public-address policy only. When set, every redirect hop is re-checked against the list before pin/connect |
| `MEDIA_LENS_MAX_ANALYSES_PER_MINUTE` | per-process `/analyze` budget (default 5) |
| `MEDIA_LENS_MAX_LIVE_URL_PER_MINUTE` | per-process live URL attempt budget (default 5) |
| `MEDIA_LENS_MAX_LIVE_URL_PER_HOST_PER_MINUTE` | per-host live URL attempt budget (default 2) |
| `MEDIA_LENS_MAX_CONCURRENT_LIVE_URL` | concurrent live URL fetches (default 1) |
| `MEDIA_LENS_MAX_JEV_CALLS_PER_ANALYSIS` | hard cap on live Jev calls per analysis (default 160) |
| `MEDIA_LENS_PER_ANALYSIS_TIMEOUT_MS` | whole-pipeline timeout including in-flight Jev retries (default 15000) |
| `MEDIA_LENS_TYPESAFE_ESTIMATED_USD_PER_CALL` | ESTIMATED planning rate for monthly budget math (default 0.002; not verified billing) |
| `MEDIA_LENS_TYPESAFE_ESTIMATED_TOKENS_PER_CALL` | ESTIMATED token count recorded per Jev call (default 1500; no article text stored) |
| `MEDIA_LENS_TYPESAFE_BUDGET_WARN_USD` | ESTIMATED monthly warn threshold (default 20) |
| `MEDIA_LENS_TYPESAFE_BUDGET_STOP_USD` | ESTIMATED monthly hard stop (default 30) |
| `MEDIA_LENS_TYPESAFE_BUDGET_FILE` | durable ESTIMATED budget counter path (default `/var/lib/media-lens/typesafe-budget.json`; exclusive lock + atomic write; mode `0600`; no article text) |
| `MEDIA_LENS_ALERT_CREDENTIAL_FILE` | SMTP (`smtp://` requires STARTTLS before AUTH; prefer `smtps://`) or **https://** webhook credential injected by systemd `LoadCredential=media-lens-alert`; JSON `{"type":"smtp","url":"..."}` or `{"type":"webhook","url":"..."}` also accepted (never git/worker.env/logs) |
| `MEDIA_LENS_ALERT_DELIVERY_TEST` | exact `true` required for optional real alert delivery test when a credential is present |
| `MEDIA_LENS_HOST` / `MEDIA_LENS_PORT` | worker bind address (default `127.0.0.1:8787`) |
| `MEDIA_LENS_TYPESAFE_API_KEY` | Jev API key; required for `live` mode together with `MEDIA_LENS_ENABLE_LIVE=true`; also required for isolated pin-verify |
| `MEDIA_LENS_TYPESAFE_BASE_URL` | Jev API base URL override (used by tests to point at a mock server) |
| `MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR` | directory of operator-produced Newsjack run artifacts for `live` mode coverage |
| `MEDIA_LENS_JEV_VERIFY` | exact value `true` required before `scripts/jev-pin-verify.js` may call TypeSafe; does not enable live URL or live pasted-text (default: unset/false) |
| `MEDIA_LENS_JEV_SHADOW` | exact value `true` enables fixture replay in `scripts/jev-usage-lab.js` and shadow observation on `/analyze`; default unset/false; the `/analyze` response is unchanged; shadow errors are not part of that response; no extra TypeSafe call; does not ask `media-lens-narrow.v1`; does not enable live URL, live pasted-text, or live Jev |
| `MEDIA_LENS_JEV_SHADOW_NARROW` | exact value `true` arms a separate, non-authoritative comparison that can ask `media-lens-narrow.v1` after the `/analyze` response is sent; default unset/false; does not change the HTTP body; not model accuracy; not production-ready; see `docs/jev-usage-lab/10-narrow-shadow-execution.md` |
| `MEDIA_LENS_JEV_SHADOW_NARROW_MAX_CALLS_PER_ANALYSIS` | approved operating point 5 when set (2026-09-22 PT); not injected; unset means no narrow shadow call |
| `MEDIA_LENS_JEV_SHADOW_NARROW_TIMEOUT_MS` | approved operating point 10000 when set (2026-09-22 PT); not injected; unset means no narrow shadow call |
| `MEDIA_LENS_JEV_SHADOW_NARROW_RATE_LIMIT_PER_MINUTE` | approved operating point 6 when set (2026-09-22 PT); not injected; unset means no narrow shadow call; process-local |
| `MEDIA_LENS_JEV_SHADOW_NARROW_MONTHLY_COST_CEILING_USD` | approved operating point 5.00 when set (2026-09-22 PT); not injected; unset means no narrow shadow call; process-local only; does not enforce the production TypeSafe stop (default $30) across workers or restarts |
| `MEDIA_LENS_JEV_SHADOW_NARROW_ESTIMATED_USD_PER_CALL` | authorized ESTIMATED planning value 0.002 when an operator sets this variable (2026-09-22 PT); not account-verified; `loadConfig` does not inject the constant; unset keeps real narrow calls at zero; distinct from the production `MEDIA_LENS_TYPESAFE_ESTIMATED_USD_PER_CALL` default, which is also 0.002; basis is the universal 9467-character / 3156-token bound, public $0.042/MTok, and a 20% buffer (raw buffered about $0.000159/call; five calls at 0.002 are $0.010); see `docs/jev-usage-lab/10-narrow-shadow-execution.md` |
| `MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE` | exact value `true` required before the optional classifier.dev live contract probe test may call `POST /v1/classify` with synthetic labels; never default CI |

Worker environment variables are read only by `worker/config.js`. Isolated pin verify is a separate CLI (`scripts/jev-pin-verify.js`) that reads `MEDIA_LENS_JEV_VERIFY` and the TypeSafe key from the environment. The Usage Lab CLI (`scripts/jev-usage-lab.js`) reads `MEDIA_LENS_JEV_SHADOW` and replays local fixtures only. The same flag, when it is exactly `true`, makes `/analyze` schedule a shadow record after the response is sent. That record projects production answers. It does not ask `media-lens-narrow.v1` and it is not model accuracy. `MEDIA_LENS_JEV_SHADOW_NARROW` is a different flag. Exact `true` schedules that question set after the response only when every limit above is set, including a positive per-call estimate. The approved operating posture (2026-09-22 PT, `docs/jev-usage-lab/10-narrow-shadow-execution.md`) records 0.002 as an ESTIMATED planning value on `NARROW_SHADOW_APPROVED_OPERATING_POINTS` only. `loadConfig` does not inject it. The runtime variable stays unset until an operator sets it, and that omission keeps the network off. Those numbers are named constants for operators and tests. They are not written into the environment. Fixture mode and CI still do not call TypeSafe for it. Any other flag value, including unset, does not schedule it. `.env` is git-ignored; no key value is ever committed or shipped in a browser-served file.

## Limits (enforced in `worker/config.js`, `worker/server.js`, `worker/prepare.js`)

512 KB request body; 60,000 char prepared text; 200 spans; 5 analyses/minute/worker (operator-configurable); 5 live URL attempts/minute/worker and 2/host/minute when live URL is on; 1 concurrent live URL fetch; 160 Jev calls/analysis; 8 s per Jev call; 15 s per analysis; ESTIMATED TypeSafe monthly budget warn $20 / stop $30 (not verified provider billing), persisted under `/var/lib/media-lens/typesafe-budget.json` with an exclusive lock file and atomic writes (override `MEDIA_LENS_TYPESAFE_BUDGET_FILE`, mode `0600`, no article text). Per-analysis timeout aborts the shared pipeline `AbortController` and threads its `AbortSignal` through newsjack and downstream fetches so in-flight work stops, not only new stages. Live URL oversized input returns the exact copy: “This public page is too long for Media Lens live analysis. No manipulation analysis or score was generated. Try a shorter public article.” Exceeding a limit returns HTTP 413/429 and a graph with a single abstention, never a partial result. Budget warn alerts target `bthornton9415@gmail.com` via authenticated SMTP when the LoadCredential file contains a valid `smtp://` URL with STARTTLS or `smtps://` (or JSON `{"type":"smtp","url":"..."}`), or via **https://** webhook when the file contains a webhook URL. Until a valid credential is present, alert delivery remains `BLOCKED_ALERT_TRANSPORT` (CI uses mock transport). `MEDIA_LENS_KILL_SWITCH=true` or a kill file returns `503 live_killed` for live `/analyze` and does not fetch, call Jev, or call classifier.dev. The same kill switch also fail-closes isolated pin verification (`scripts/jev-pin-verify.js`) before any TypeSafe call. classifier.dev stays evaluation-only; unset `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` to disable it without changing Jev.

`worker/safe-fetch.js` fetches live-mode article URLs with **connect-time destination pinning** (Issue #118): it classifies every A/AAAA, fails closed on mixed public+private DNS, and connects only to one pre-classified public IP via a custom `lookup` that never calls DNS again. Live TypeSafe Jev (`POST /v1/systemone`) and evaluation-only classifier.dev (`POST /v1/classify`) use the same pin pattern when those paths actually call the network (`worker/provider-pinned-fetch.js`); they do not follow redirects. classifier.dev production origin remains `https://classifier.dev` only. IPv4-mapped `::ffff:0:0/96` (R1), SIIT `::ffff:0:0:0/96`, well-known NAT64 `64:ff9b::/96`, deprecated IPv4-compatible `::/96`, and 6to4 extract IPv4 and apply the IPv4 table. Well-known NAT64 is `allow_public` only when that embedded IPv4 is public. Local-use NAT64 `64:ff9b:1::/48` (RFC 8215), other addresses under `64:ff9b::/32`, and ISATAP (`0000:5efe` / `0100:5efe` / `0200:5efe` / `0300:5efe` IIDs, RFC 5214 u/g) fail closed even when the embedded IPv4 is public. Residual last-32 embeddings (sparse forms with bits 64–95 zero and residual forms with bits 64–95 non-zero) fail closed only when that IPv4 is blocked by the IPv4 table; a public last-32 (for example Cloudflare `2606:4700:10::6814:179a` → `104.20.23.154`) is native unicast `allow_public`, not extra NAT64. IPv6 benchmarking `2001:2::/48` is blocked and is not treated as native unicast. Deprecated site-local `fec0::/10` (RFC 3879) and retired 6bone `3ffe::/16` fail closed before connect. ORCHID `2001:10::/28`, ORCHIDv2 `2001:20::/28`, Teredo, and deprecated 6to4 anycast `192.88.99.0/24` fail closed. Exotic IPv4 literals (octal, hex, decimal, short) are accepted only after WHATWG canonicalization to dotted-decimal; IPv4 policy then applies (so `0177.0.0.1` is loopback, not a syntax error). Redirects are re-validated hop-by-hop with re-pin and, when `MEDIA_LENS_URL_ALLOWLIST` is set, a hostname allowlist check on every hop (off-list hops fail closed as `live_url_not_allowlisted` before connect; same-host relative redirects remain allowed when the host is still listed); HTTPS→HTTP is denied; `HTTP_PROXY` is ignored. DNS rebinding cannot retarget an established pinned socket. Residual risk: a public pinned IP can still serve hostile HTML (content risk, not SSRF). Real-socket tests against loopback fixtures (`127.0.0.1` / `::1`, local CA) cover pin, SNI, certificate identity, and DNS-name redirect re-pin. Live URL mode is still not production-ready.

## Consent and disclosure

The UI shows a persistent, non-dismissable notice describing what Media Lens analyzes, that a local worker performs any processing, what happens in live mode, and that private messages belong in Clarity instead. The full live-URL disclosure stays visible before submit. A per-session "I confirm this is public material I am allowed to analyze, and I understand that live URL mode may send prepared public spans to TypeSafe AI’s Jev service." checkbox gates the submit button; the worker rejects `/analyze` requests without `user_asserted_public: true`.

## Privacy / DPA (evaluation-only)

In-repo source of truth: `docs/media-lens-classifier-dev-privacy.md`. Recommendation: **KEEP_EVALUATION_ONLY** (public sources retrieved 2026-09-19 PT). `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` remains default-off. A public classifier.dev claim that it stores no request text is insufficient alone for production. Prefer default tier `fast`; do not enable `smart` on any live path until contracts close the TypeSafe / OpenRouter / ultimate-model chain. classifier.dev's public README records a past silent primary-model delist that served a backup for weeks without disclosure; Media Lens does not treat that as a current model-availability claim. Live URL and live pasted-text stay unauthorized. Not production-ready. Not an accuracy claim. Related to Issue #118; does not close it.

## Incidents and rollback

Operator runbook: `docs/media-lens-ops-runbook-v2.md`. Canary/kill-switch drill packet (Issue #118 E, **DRILL_PACKET_ONLY**, not production-ready, does not authorize live enablement): `docs/media-lens-canary-drill-v1.md`. Architecture rollback and incident classes: `docs/media-lens-live-url-v2-architecture.md` §20. classifier.dev privacy SoT: `docs/media-lens-classifier-dev-privacy.md` (**KEEP_EVALUATION_ONLY**).

Do not paste API keys, article bodies, or URLs with credentials into tickets. To stop every external Jev-capable path immediately (live URL fetch, live Jev, isolated pin verification, and classifier.dev): set `MEDIA_LENS_KILL_SWITCH=true` or `touch` the kill file, then confirm live `/analyze` returns `503 live_killed` (live mode) or that fixture-only behavior continues, that `scripts/jev-pin-verify.js` exits nonzero with `verify_kill_switch`, and that classifier.dev makes zero outbound calls. This is not a production-ready mode and is not hosted on GitHub Pages.

## Run it

```bash
node --test tests/*.test.js
node media-lens/worker/analyze-fixture.js synthetic-01-quoted-vs-authorial | node media-lens/schema/validate.js
MEDIA_LENS_MODE=fixture node media-lens/worker/server.js      # http://127.0.0.1:8787/health
python3 -m http.server 4173                                    # open http://localhost:4173/media-lens/
```

## Isolated Jev pin verify (Issue #118 Phase 4)

Default CI stays fixture-only. This does not enable live URL. It does not enable live pasted-text. It is not production-ready and not a quality study.

When `MEDIA_LENS_JEV_VERIFY=true` and `MEDIA_LENS_TYPESAFE_API_KEY` are both set, `scripts/jev-pin-verify.js` sends synthetic spans from `media-lens/fixtures/articles/` with `model: "jev-1.13.0"`. If the API rejects the versioned id or reports any other model, the gate fails. It does not fall back to `jev-latest`. `MEDIA_LENS_KILL_SWITCH=true` (exact), an existing `MEDIA_LENS_KILL_SWITCH_FILE`, or a kill-file `stat` error fail-closes immediately with reason `verify_kill_switch`, zero network calls, and no TypeSafe adapter invocation — even when the verify flag and key are set. A missing kill file does not assert. The report (commit SHA, timestamp, pass/fail) is a local or CI artifact, never an accuracy claim in `docs/`.

```bash
MEDIA_LENS_JEV_VERIFY=true MEDIA_LENS_TYPESAFE_API_KEY=... node scripts/jev-pin-verify.js
```

## Out of scope for v1

No score/rank/leaderboard of any kind; no live Jev/Newsjack calls in CI or by default; no server-side deployment of the worker; no fact-checking (every claim's `support` is always `not_checked` in this preview; fusion never sets any other value); no third-party outlet ratings; no spawning the Newsjack CLI; no history, accounts, or persistence beyond the in-memory response; English text only. See `docs/media-lens-influence-graph-plan.md` section 11 for the full list.
