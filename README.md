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

## Important

Clarity by Manipulation Score is an educational aid—not a diagnosis, safety assessment, or substitute for professional advice. See [limitations.html](limitations.html).

## Documentation

| Document | Purpose |
|----------|---------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Analysis pipeline, modules, caching, tests, release checklist |
| [BRAND.md](BRAND.md) | Clarity brand direction, voice, and pause-field visual system |
| [DESIGN.md](DESIGN.md) | Compact design contract for interface work |
| [docs/DESIGN_ENGINEERING.md](docs/DESIGN_ENGINEERING.md) | UI implementation guidance for agents and contributors |
| [docs/HTTPS.md](docs/HTTPS.md) | Production HTTPS verification |
| [VISION.md](VISION.md) | Product scope, privacy, and safety constraints |
| [methodology.html](methodology.html) | User-facing screening explanation (v0.3.3) |

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Home: Learn or Analyze entry, product boundaries |
| `learn.html` | Twelve language functions and benign lookalikes |
| `analyze.html` | Analyzer UI, opt-in local history |
| `app.js` | UI logic, stale-result invalidation, safe DOM rendering |
| `scoring.js` | Deterministic scoring engine (`METHODOLOGY_VERSION`) |
| `safety.js` | Safety notices independent of manipulation band |
| `text-normalize.js` | Unicode normalization and English pilot checks |
| `history-storage.js` | Opt-in history keys and v1→v2 migration |
| `ocr.js`, `ocr-clean.js` | On-device OCR (gated off; `BETA_OCR_ENABLED = false`) |
| `service-worker.js` | Offline app shell (`CACHE_NAME`, currently `clarity-v37`) |
| `styles.css`, `fonts.css` | Pause-field brand tokens and self-hosted fonts |
| `vendor/` | Bundled Tesseract and HEIC conversion assets |
| `tests/` | Node test runner suites (scoring, safety, release gates, trust pages) |
| `privacy.html`, `terms.html`, `limitations.html`, `acceptable-use.html`, `accessibility.html`, `contact.html`, `changelog.html` | Trust and legal pages |

After CSS or shell changes, bump `CACHE_NAME` in `service-worker.js` and the matching `styles.css?v=` query on every HTML page. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#stylesheet-cache-busting-common-pitfall).
