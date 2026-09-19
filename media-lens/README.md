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
- **`live`** — refuses to start unless **both** `MEDIA_LENS_ENABLE_LIVE=true` and `MEDIA_LENS_TYPESAFE_API_KEY` are set. Live pasted-text analysis is disabled and is rejected before any external request. Live URL fetch is experimental and not production-ready. When those gates pass, prepared public span text from a fetched URL may be sent to TypeSafe's Jev classifier over HTTPS. Newsjack provenance in live mode is read from an **operator-provided artifacts directory** (`MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR`) — the worker never spawns the Newsjack CLI and never calls a live news-search service.

Environment variables (read only by `worker/config.js`, never logged, never returned by `/health`):

| Variable | Purpose |
| --- | --- |
| `MEDIA_LENS_MODE` | `fixture` (default) or `live` |
| `MEDIA_LENS_ENABLE_LIVE` | explicit opt-in; must be the exact value `true` before live mode can start (default: unset/false) |
| `MEDIA_LENS_HOST` / `MEDIA_LENS_PORT` | worker bind address (default `127.0.0.1:8787`) |
| `MEDIA_LENS_TYPESAFE_API_KEY` | Jev API key; required for `live` mode together with `MEDIA_LENS_ENABLE_LIVE=true` |
| `MEDIA_LENS_TYPESAFE_BASE_URL` | Jev API base URL override (used by tests to point at a mock server) |
| `MEDIA_LENS_NEWSJACK_ARTIFACTS_DIR` | directory of operator-produced Newsjack run artifacts for `live` mode coverage |

`.env` is git-ignored; no key value is ever committed or shipped in a browser-served file.

## Limits (enforced in `worker/config.js`, `worker/server.js`, `worker/prepare.js`)

512 KB request body; 60,000 char prepared text; 200 spans; 10 analyses/minute/worker; 8 s per Jev call; 30 s per analysis. Exceeding a limit returns HTTP 413/429 and a graph with a single abstention, never a partial result.

`worker/safe-fetch.js` rejects loopback/private/link-local hosts (including IPv6 literals, IPv4-mapped IPv6 in dotted and hexadecimal forms, and via redirect) before fetching a live-mode URL, resolving the hostname once via DNS at request time. A residual risk in any such check is DNS rebinding: the resolved address could change between that lookup and the underlying TCP connection. Other IPv4-embedded IPv6 prefixes (for example NAT64 `64:ff9b::/96`, SIIT `::ffff:0:0:0/96`, and deprecated IPv4-compatible `::/96`) are not classified as IPv4. Live URL mode is still not production-ready.

## Consent and disclosure

The UI shows a persistent, non-dismissable notice describing what Media Lens analyzes, that a local worker performs any processing, what happens in live mode, and that private messages belong in Clarity instead. A per-session "This is public material I am allowed to analyze" checkbox gates the submit button; the worker rejects `/analyze` requests without `user_asserted_public: true`.

## Run it

```bash
node --test tests/*.test.js
node media-lens/worker/analyze-fixture.js synthetic-01-quoted-vs-authorial | node media-lens/schema/validate.js
MEDIA_LENS_MODE=fixture node media-lens/worker/server.js      # http://127.0.0.1:8787/health
python3 -m http.server 4173                                    # open http://localhost:4173/media-lens/
```

## Out of scope for v1

No score/rank/leaderboard of any kind; no live Jev/Newsjack calls in CI or by default; no server-side deployment of the worker; no fact-checking (every claim's `support` is always `not_checked` in this preview; fusion never sets any other value); no third-party outlet ratings; no spawning the Newsjack CLI; no history, accounts, or persistence beyond the in-memory response; English text only. See `docs/media-lens-influence-graph-plan.md` section 11 for the full list.
