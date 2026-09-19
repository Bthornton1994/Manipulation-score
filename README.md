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

Media Lens is a separate, unreleased preview mode for public articles, advertisements, speeches, and campaign material — not for private messages. It is isolated from Clarity (no shared code, no shared network path) and is **not deployed**: it is excluded from the GitHub Pages build.

Media Lens runs entirely through a local worker process. The default and only mode exercised in automated tests is `fixture` mode, which reads local example files and makes no network calls. A `live` mode exists as an adapter seam behind explicit operator configuration (`MEDIA_LENS_ENABLE_LIVE=true` and `MEDIA_LENS_TYPESAFE_API_KEY`, never committed) and is not used by default or in CI. Live pasted-text analysis is disabled. Live URL mode is experimental, disabled by default (`MEDIA_LENS_ENABLE_LIVE_URL` unset), and not production-ready. `MEDIA_LENS_KILL_SWITCH=true` forces live URL and live Jev off. Isolated `jev-1.13.0` pin verify (`MEDIA_LENS_JEV_VERIFY=true`, `scripts/jev-pin-verify.js`) is opt-in evidence plumbing, not a quality study, and does not enable live URL. Operator notes: `docs/media-lens-ops-runbook-v2.md`.

```bash
node --test tests/*.test.js                                                          # full suite, including Media Lens tests
node media-lens/worker/analyze-fixture.js synthetic-01-quoted-vs-authorial | node media-lens/schema/validate.js
MEDIA_LENS_MODE=fixture node media-lens/worker/server.js                             # http://127.0.0.1:8787/health
python3 -m http.server 4173                                                          # then open http://localhost:4173/media-lens/
```

See `media-lens/README.md` for the module layout, modes, and limits, `docs/media-lens-ops-runbook-v2.md` for kill switch / audit / rate limits, and `docs/media-lens-build-brief.md` / `docs/media-lens-influence-graph-plan.md` for the product decisions and implementation plan this feature follows.

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
