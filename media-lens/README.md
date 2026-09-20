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
| `MEDIA_LENS_KILL_SWITCH_FILE` | if set and the path exists, same as kill switch; re-checked per request so ops can `touch` the file |
| `MEDIA_LENS_URL_ALLOWLIST` | optional comma-separated exact hostnames for canary; empty means public-address policy only. When set, every redirect hop is re-checked against the list before pin/connect |
| `MEDIA_LENS_MAX_ANALYSES_PER_MINUTE` | per-process `/analyze` budget (default 10) |
| `MEDIA_LENS_MAX_LIVE_URL_PER_MINUTE` | per-process live URL attempt budget (default 10) |
| `MEDIA_LENS_MAX_LIVE_URL_PER_HOST_PER_MINUTE` | per-host live URL attempt budget (default 3) |
| `MEDIA_LENS_MAX_CONCURRENT_LIVE_URL` | concurrent live URL fetches (default 1) |
| `MEDIA_LENS_HOST` / `MEDIA_LENS_PORT` | worker bind address (default `127.0.0.1:8787`) |
| `MEDIA_LENS_TYPESAFE_API_KEY` | Jev API key; required for `live` mode together with `MEDIA_LENS_ENABLE_LIVE=true`; also required for isolated pin-verify |
| `MEDIA_LENS_TYPESAFE_BASE_URL` | Jev API base URL override (used by tests to point at a mock server) |
| `MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR` | directory of operator-produced Newsjack run artifacts for `live` mode coverage |
| `MEDIA_LENS_JEV_VERIFY` | exact value `true` required before `scripts/jev-pin-verify.js` may call TypeSafe; does not enable live URL or live pasted-text (default: unset/false) |
| `MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE` | exact value `true` required before the optional classifier.dev live contract probe test may call `POST /v1/classify` with synthetic labels; never default CI |

Worker environment variables are read only by `worker/config.js`. Isolated pin verify is a separate CLI (`scripts/jev-pin-verify.js`) that reads `MEDIA_LENS_JEV_VERIFY` and the TypeSafe key from the environment. `.env` is git-ignored; no key value is ever committed or shipped in a browser-served file.

## Limits (enforced in `worker/config.js`, `worker/server.js`, `worker/prepare.js`)

512 KB request body; 60,000 char prepared text; 200 spans; 10 analyses/minute/worker (operator-configurable); 10 live URL attempts/minute/worker and 3/host/minute when live URL is on; 1 concurrent live URL fetch; 8 s per Jev call; 30 s per analysis. Exceeding a limit returns HTTP 413/429 and a graph with a single abstention, never a partial result. `MEDIA_LENS_KILL_SWITCH=true` or a kill file returns `503 live_killed` for live `/analyze` and does not fetch, call Jev, or call classifier.dev. The same kill switch also fail-closes isolated pin verification (`scripts/jev-pin-verify.js`) before any TypeSafe call. classifier.dev stays evaluation-only; unset `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` to disable it without changing Jev.

`worker/safe-fetch.js` fetches live-mode article URLs with **connect-time destination pinning** (Issue #118): it classifies every A/AAAA, fails closed on mixed public+private DNS, and connects only to one pre-classified public IP via a custom `lookup` that never calls DNS again. Live TypeSafe Jev (`POST /v1/systemone`) and evaluation-only classifier.dev (`POST /v1/classify`) use the same pin pattern when those paths actually call the network (`worker/provider-pinned-fetch.js`); they do not follow redirects. classifier.dev production origin remains `https://classifier.dev` only. IPv4-mapped `::ffff:0:0/96` (R1), SIIT `::ffff:0:0:0/96`, well-known NAT64 `64:ff9b::/96`, deprecated IPv4-compatible `::/96`, and 6to4 extract IPv4 and apply the IPv4 table. Well-known NAT64 is `allow_public` only when that embedded IPv4 is public. Local-use NAT64 `64:ff9b:1::/48` (RFC 8215), other addresses under `64:ff9b::/32`, custom NAT64 `/96` (last 32 bits an IPv4 whose first octet is not 0, including sparse forms with bits 64–95 zero and residual forms with bits 64–95 non-zero), and ISATAP (`0000:5efe` / `0200:5efe` IIDs) fail closed even when the embedded IPv4 is public. IPv6 benchmarking `2001:2::/48` is blocked and is not treated as native unicast. ORCHID `2001:10::/28`, ORCHIDv2 `2001:20::/28`, Teredo, and deprecated 6to4 anycast `192.88.99.0/24` fail closed. Exotic IPv4 literals (octal, hex, decimal, short) are accepted only after WHATWG canonicalization to dotted-decimal; IPv4 policy then applies (so `0177.0.0.1` is loopback, not a syntax error). Redirects are re-validated hop-by-hop with re-pin and, when `MEDIA_LENS_URL_ALLOWLIST` is set, a hostname allowlist check on every hop (off-list hops fail closed as `live_url_not_allowlisted` before connect; same-host relative redirects remain allowed when the host is still listed); HTTPS→HTTP is denied; `HTTP_PROXY` is ignored. DNS rebinding cannot retarget an established pinned socket. Residual risk: a public pinned IP can still serve hostile HTML (content risk, not SSRF). Real-socket tests against loopback fixtures (`127.0.0.1` / `::1`, local CA) cover pin, SNI, certificate identity, and DNS-name redirect re-pin. Live URL mode is still not production-ready.

## Consent and disclosure

The UI shows a persistent, non-dismissable notice describing what Media Lens analyzes, that a local worker performs any processing, what happens in live mode, and that private messages belong in Clarity instead. A per-session "This is public material I am allowed to analyze" checkbox gates the submit button; the worker rejects `/analyze` requests without `user_asserted_public: true`.

## Privacy / DPA (evaluation-only)

In-repo source of truth: `docs/media-lens-classifier-dev-privacy.md`. Recommendation: **KEEP_EVALUATION_ONLY** (public sources retrieved 2026-09-19 PT). `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` remains default-off. A public classifier.dev claim that it stores no request text is insufficient alone for production. Prefer default tier `fast`; do not enable `smart` on any live path until contracts close the TypeSafe / OpenRouter / ultimate-model chain. Live URL and live pasted-text stay unauthorized. Not production-ready. Not an accuracy claim. Related to Issue #118; does not close it.

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

When `MEDIA_LENS_JEV_VERIFY=true` and `MEDIA_LENS_TYPESAFE_API_KEY` are both set, `scripts/jev-pin-verify.js` sends synthetic spans from `media-lens/fixtures/articles/` with `model: "jev-1.13.0"`. If the API rejects the versioned id or reports any other model, the gate fails. It does not fall back to `jev-latest`. `MEDIA_LENS_KILL_SWITCH=true` (exact) or an existing `MEDIA_LENS_KILL_SWITCH_FILE` fail-closes immediately with reason `verify_kill_switch`, zero network calls, and no TypeSafe adapter invocation — even when the verify flag and key are set. The report (commit SHA, timestamp, pass/fail) is a local or CI artifact, never an accuracy claim in `docs/`.

```bash
MEDIA_LENS_JEV_VERIFY=true MEDIA_LENS_TYPESAFE_API_KEY=... node scripts/jev-pin-verify.js
```

## Out of scope for v1

No score/rank/leaderboard of any kind; no live Jev/Newsjack calls in CI or by default; no server-side deployment of the worker; no fact-checking (every claim's `support` is always `not_checked` in this preview; fusion never sets any other value); no third-party outlet ratings; no spawning the Newsjack CLI; no history, accounts, or persistence beyond the in-memory response; English text only. See `docs/media-lens-influence-graph-plan.md` section 11 for the full list.
