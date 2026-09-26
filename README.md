# Clarity by Manipulation Score

**Clarity** is private communication literacy by **Manipulation Score**. It helps people inspect potentially pressuring language, understand the functions behind an experimental band, and choose a grounded response.

Clarity runs entirely in your browser. No accounts, no uploads, no analytics for the core experience.

## Features

- On-device pattern analysis with highlighted evidence in the message
- Twelve language signal categories with plain-language explanations
- Three response styles: pause, boundary, and clarify
- Installable PWA with offline support after first visit
- Self-hosted fonts — no third-party requests at runtime
- Legal pages: privacy, terms, limitations, methodology, contact, acceptable use, accessibility, and changelog

## Run locally

No build step or package install required.

```bash
python3 -m http.server 4173
```

Open http://localhost:4173.

## Test

```bash
node --test tests/*.test.js
```

## Deploy

GitHub Actions deploys to GitHub Pages on pushes to `main`. Enable Pages under repository Settings → Pages → Source: **GitHub Actions**.

**Production URLs:** https://manipulationscore.com and https://www.manipulationscore.com

The `CNAME` file sets the apex domain as canonical. GitHub Pages serves both hostnames and redirects `www` to the apex domain once DNS is configured.

Configure DNS at your registrar:

### Apex domain (`manipulationscore.com`)

Add **A** records for `@`:

| Type | Name | Value |
|------|------|-------|
| A | @ | `185.199.108.153` |
| A | @ | `185.199.109.153` |
| A | @ | `185.199.110.153` |
| A | @ | `185.199.111.153` |

Optional **AAAA** records for IPv6:

| Type | Name | Value |
|------|------|-------|
| AAAA | @ | `2606:50c0:8000::153` |
| AAAA | @ | `2606:50c0:8001::153` |
| AAAA | @ | `2606:50c0:8002::153` |
| AAAA | @ | `2606:50c0:8003::153` |

### `www` subdomain (`www.manipulationscore.com`)

| Type | Name | Value |
|------|------|-------|
| CNAME | www | `bthornton1994.github.io` |

### GitHub Pages settings

1. Settings → Pages → Source: **GitHub Actions**
2. Settings → Pages → Custom domain: `manipulationscore.com`
3. After DNS checks pass for both hostnames, enable **Enforce HTTPS**

GitHub provisions TLS for both `manipulationscore.com` and `www.manipulationscore.com`. Visitors on `www` are redirected to the apex domain (canonical URL for SEO and sharing).

## Media Lens (preview)

Media Lens is a separate, experimental preview mode for public articles, advertisements, speeches, and campaign material — not for private messages. It is isolated from Clarity (no shared code, no shared network path) and is excluded from the GitHub Pages build, so it is **not deployed on manipulationscore.com**.

A limited Jev-only live URL preview runs on one operator host, `https://ml-jev.manipulationscore.com/media-lens/`, activated by the owner on 2026-09-21 PT (Issue #118 stays open). A Caddy site (`media-lens/deploy/Caddyfile`) serves only the three UI files and shared assets there and proxies `/health` and `/analyze` to a loopback worker. It analyzes one public page at a time from an operator allowlist. The page sends only `https://` URLs; the worker also accepts `http://` URLs sent directly to its API, under the same allowlist and redirect rules. It is not production-ready, and the operator can pause it with the kill switch.

What is live and what is fixture-only:

- Live on ml-jev: URL analysis with TypeSafe Jev only. Live pasted text, classifier.dev, fixture analysis, and Newsjack coverage are off there. The worker rejects a `kind` that is not an `influence-graph.v1` artifact kind with `400 invalid_kind` before any fetch or provider call.
- Fixture-only: the story explorer, the fixture story workspace, and `#story=` links run only in local preview. The landing page's static sample card appears on every host and is labeled as a made-up example.
- Real story discovery, same-story clustering, and cross-outlet coverage comparison are not live. The worker can read allowlisted RSS or Atom feeds only when `MEDIA_LENS_ENABLE_STORY_DISCOVERY` is the exact value true and the source registry marks that feed approved. No feed is approved. Every named candidate stays `candidate_pending_owner_approval` and is not fetched. Fixture discovery is labeled and is refused by a live-mode worker. The worker reads no Newsjack output, and no Newsjack binary is approved for ml-jev. Article URL analysis does not discover stories or compare outlet coverage. Owner decisions: `docs/media-lens-story-discovery-owner-decisions.md`.

Repository defaults stay off. The default and only mode exercised in automated tests is `fixture` mode, which reads local example files and makes no network calls. `live` mode needs explicit operator configuration (`MEDIA_LENS_ENABLE_LIVE=true` and `MEDIA_LENS_TYPESAFE_API_KEY`, never committed) and is not used by default or in CI. Live pasted-text analysis is disabled. Live URL mode is experimental, disabled by default (`MEDIA_LENS_ENABLE_LIVE_URL` unset), and not production-ready. An evaluation-only classifier.dev adapter (`MEDIA_LENS_ENABLE_CLASSIFIER_DEV`) is default-off, is not a second independent model, and makes zero outbound calls unless that exact flag is set and the kill switch is off. When that evaluation path is on, the default requested tier is `fast` (`MEDIA_LENS_CLASSIFIER_DEV_TIER` unset or empty); `smart` requires the exact value `MEDIA_LENS_CLASSIFIER_DEV_TIER=smart`. `MEDIA_LENS_KILL_SWITCH=true` stops every external Jev-capable path (live URL fetch, live Jev, isolated pin verification, and classifier.dev). Isolated `jev-1.13.0` pin verify (`MEDIA_LENS_JEV_VERIFY=true`, `scripts/jev-pin-verify.js`) is opt-in evidence plumbing, not a quality study, and does not enable live URL. Operator notes: `docs/media-lens-ops-runbook-v2.md`.

```bash
node --test tests/*.test.js                                                          # full suite, including Media Lens tests
node media-lens/worker/analyze-fixture.js synthetic-01-quoted-vs-authorial | node media-lens/schema/validate.js
MEDIA_LENS_MODE=fixture node media-lens/worker/server.js                             # http://127.0.0.1:8787/health
python3 -m http.server 4173                                                          # then open http://localhost:4173/media-lens/
```

See `media-lens/README.md` for the module layout, modes, limits, and the worker fixes in this release (#146 `live_fixture_disabled`, #145 timeout call accounting, #149 fail-closed budget record, plus the release-review budget write and `invalid_kind` changes), `docs/media-lens-frontend-deployment.md` for the ml-jev deploy procedure, `docs/media-lens-ops-runbook-v2.md` for kill switch / audit / rate limits and the current operator deployment, and `docs/media-lens-build-brief.md` / `docs/media-lens-influence-graph-plan.md` for the product decisions and implementation plan this feature follows.

## Important

Clarity by Manipulation Score is an educational aid—not a diagnosis, safety assessment, or substitute for professional advice. See [limitations.html](limitations.html).

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Platform home (Learn or Analyze) |
| `learn.html` | Twelve language functions and lookalikes |
| `analyze.html` | Clarity analyzer UI |
| `app.js` | UI logic (safe DOM rendering) |
| `scoring.js` | Deterministic scoring engine |
| `service-worker.js` | Offline caching |
| `privacy.html`, `terms.html`, `limitations.html` | Legal and safety pages |
