# Manipulation Score — Clarity

**Clarity** is the message analysis product from **Manipulation Score**—a privacy-first tool that helps people identify potentially manipulative language, understand the signals behind a score, and choose grounded responses.

Clarity runs entirely in your browser. No accounts, no uploads, no analytics.

**Status:** Controlled Beta (screening v0.3.2). Pattern bands are shown; numeric 0–100 scores are suppressed in the UI during the pilot. English text only.

## Features

- On-device pattern analysis with highlighted evidence in the message
- Twelve language signal categories with plain-language explanations
- Safety notices for harm, coercion, and stalking language (separate from pattern scoring)
- Response suggestions: pause and boundary styles per detected signal
- Thread screening: paste multiple messages separated by blank lines
- Opt-in local history (up to 8 items, device-only)
- Installable PWA with offline support after first visit
- Self-hosted fonts — no third-party requests at runtime
- Trust and legal pages: privacy, terms, limitations, methodology, contact, acceptable use, accessibility, and changelog

## How analysis works

1. **Normalize** — Unicode text is normalized (NFKC, smart quotes, whitespace).
2. **Language gate** — non-English or mixed-script text abstains during the English-only pilot.
3. **Safety check** — violence, confinement, self-harm coercion, and contextual stalking trigger a safety notice instead of a score.
4. **Abstention** — fewer than 15 recognizable words → no band (unless safety applies).
5. **Pattern screening** — twelve signal families are matched; results map to Low / Moderate / High bands.

For architecture details, module boundaries, and contributor guidance, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For user-facing methodology, see [methodology.html](methodology.html).

## Run locally

No build step required for the static site.

```bash
python3 -m http.server 4173
```

Open http://localhost:4173.

Optional: `npm install` pulls OCR dependencies for local OCR testing (image upload is disabled in the UI during v0.3.2).

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

See [docs/HTTPS.md](docs/HTTPS.md) for TLS verification steps.

GitHub provisions TLS for both `manipulationscore.com` and `www.manipulationscore.com`. Visitors on `www` are redirected to the apex domain (canonical URL for SEO and sharing).

## Important

Clarity by Manipulation Score is an educational aid—not a diagnosis, safety assessment, or substitute for professional advice. See [limitations.html](limitations.html).

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Landing page and analyzer UI |
| `app.js` | UI logic, history, safe DOM rendering |
| `scoring.js` | Deterministic scoring engine (`analyzeMessage`) |
| `safety.js` | Safety-notice detection (independent of scoring) |
| `text-normalize.js` | Unicode normalization and English-only heuristic |
| `history-storage.js` | Opt-in history keys and legacy migration |
| `ocr.js`, `ocr-clean.js` | On-device screenshot OCR (UI disabled in v0.3.2) |
| `service-worker.js` | Offline caching (PWA) |
| `methodology.html`, `changelog.html` | Screening methodology and release notes |
| `privacy.html`, `terms.html`, `limitations.html`, `contact.html`, `acceptable-use.html`, `accessibility.html` | Trust and legal pages |
| `tests/` | Node test suite (regression audits, beta gates) |
| `docs/` | Contributor docs ([ARCHITECTURE.md](docs/ARCHITECTURE.md), [HTTPS.md](docs/HTTPS.md)) |
| `vendor/` | Vendored Tesseract.js and heic2any for OCR |
