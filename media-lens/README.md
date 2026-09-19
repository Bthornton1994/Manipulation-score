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

Environment variables (read only by `worker/config.js`, never logged, never returned by `/health`):

| Variable | Purpose |
| --- | --- |
| `MEDIA_LENS_MODE` | `fixture` (default) or `live` |
| `MEDIA_LENS_ENABLE_LIVE` | explicit opt-in; must be the exact value `true` before live mode can start (default: unset/false) |
| `MEDIA_LENS_ENABLE_LIVE_URL` | exact value `true` required **in addition** before `mode: "url"` may fetch; live Jev tests must not open article fetch (default: unset/false) |
| `MEDIA_LENS_KILL_SWITCH` | exact value `true` forces live URL fetch and live Jev off regardless of the enable flags (default: unset/false) |
| `MEDIA_LENS_KILL_SWITCH_FILE` | if set and the path exists, same as kill switch; re-checked per request so ops can `touch` the file |
| `MEDIA_LENS_URL_ALLOWLIST` | optional comma-separated exact hostnames for canary; empty means public-address policy only |
| `MEDIA_LENS_MAX_ANALYSES_PER_MINUTE` | per-process `/analyze` budget (default 10) |
| `MEDIA_LENS_MAX_LIVE_URL_PER_MINUTE` | per-process live URL attempt budget (default 10) |
| `MEDIA_LENS_MAX_LIVE_URL_PER_HOST_PER_MINUTE` | per-host live URL attempt budget (default 3) |
| `MEDIA_LENS_MAX_CONCURRENT_LIVE_URL` | concurrent live URL fetches (default 1) |
| `MEDIA_LENS_HOST` / `MEDIA_LENS_PORT` | worker bind address (default `127.0.0.1:8787`) |
| `MEDIA_LENS_TYPESAFE_API_KEY` | Jev API key; required for `live` mode together with `MEDIA_LENS_ENABLE_LIVE=true` |
| `MEDIA_LENS_TYPESAFE_BASE_URL` | Jev API base URL override (used by tests to point at a mock server) |
| `MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR` | directory of operator-produced Newsjack run artifacts for `live` mode coverage |

`.env` is git-ignored; no key value is ever committed or shipped in a browser-served file.

## Limits (enforced in `worker/config.js`, `worker/server.js`, `worker/prepare.js`)

512 KB request body; 60,000 char prepared text; 200 spans; 10 analyses/minute/worker (operator-configurable); 10 live URL attempts/minute/worker and 3/host/minute when live URL is on; 1 concurrent live URL fetch; 8 s per Jev call; 30 s per analysis. Exceeding a limit returns HTTP 413/429 and a graph with a single abstention, never a partial result. `MEDIA_LENS_KILL_SWITCH=true` or a kill file returns `503 live_killed` for live `/analyze` and does not fetch or call Jev.

`worker/safe-fetch.js` fetches live-mode article URLs with **connect-time destination pinning** (Issue #118): it classifies every A/AAAA, fails closed on mixed public+private DNS, and connects only to one pre-classified public IP via a custom `lookup` that never calls DNS again. IPv4-mapped `::ffff:0:0/96` (R1), SIIT `::ffff:0:0:0/96`, well-known NAT64 `64:ff9b::/96`, local-use NAT64 `64:ff9b:1::/48` (RFC 8215), deprecated IPv4-compatible `::/96`, and 6to4 extract IPv4 and apply the IPv4 table. Other addresses under `64:ff9b::/32` are blocked as unknown NAT64. Network-specific NAT64 prefixes outside `64:ff9b::/32` are not detected and may classify as native unicast (classifier limit). IPv6 benchmarking `2001:2::/48` is blocked and is not treated as native unicast. ORCHID `2001:10::/28`, ORCHIDv2 `2001:20::/28`, Teredo, and deprecated 6to4 anycast `192.88.99.0/24` fail closed. Exotic IPv4 literals (octal, hex, decimal, short) are accepted only after WHATWG canonicalization to dotted-decimal; IPv4 policy then applies (so `0177.0.0.1` is loopback, not a syntax error). Redirects are re-validated hop-by-hop with re-pin; HTTPS→HTTP is denied; `HTTP_PROXY` is ignored. DNS rebinding cannot retarget an established pinned socket. Residual risk: a public pinned IP can still serve hostile HTML (content risk, not SSRF). Real-socket tests against loopback fixtures (`127.0.0.1` / `::1`, local CA) cover pin, SNI, certificate identity, and DNS-name redirect re-pin. Live URL mode is still not production-ready.

## Consent and disclosure

The UI shows a persistent, non-dismissable notice describing what Media Lens analyzes, that a local worker performs any processing, what happens in live mode, and that private messages belong in Clarity instead. A per-session "This is public material I am allowed to analyze" checkbox gates the submit button; the worker rejects `/analyze` requests without `user_asserted_public: true`.

## Incidents and rollback

Operator runbook: `docs/media-lens-ops-runbook-v2.md`. Architecture rollback and incident classes: `docs/media-lens-live-url-v2-architecture.md` §20.

Do not paste API keys, article bodies, or URLs with credentials into tickets. To stop live URL and live Jev immediately: set `MEDIA_LENS_KILL_SWITCH=true` or `touch` the kill file, then confirm `/analyze` returns `503 live_killed` (live mode) or that fixture-only behavior continues. This is not a production-ready mode and is not hosted on GitHub Pages.

## Run it

```bash
node --test tests/*.test.js
node media-lens/worker/analyze-fixture.js synthetic-01-quoted-vs-authorial | node media-lens/schema/validate.js
MEDIA_LENS_MODE=fixture node media-lens/worker/server.js      # http://127.0.0.1:8787/health
python3 -m http.server 4173                                    # open http://localhost:4173/media-lens/
```

## Out of scope for v1

No score/rank/leaderboard of any kind; no live Jev/Newsjack calls in CI or by default; no server-side deployment of the worker; no fact-checking (every claim's `support` is always `not_checked` in this preview; fusion never sets any other value); no third-party outlet ratings; no spawning the Newsjack CLI; no history, accounts, or persistence beyond the in-memory response; English text only. See `docs/media-lens-influence-graph-plan.md` section 11 for the full list.
