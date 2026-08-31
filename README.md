# Manipulation Score — Clarity

**Manipulation Score** is a private literacy platform. **Clarity** is the on-device message screener—it helps people inspect potentially pressuring language, understand the functions behind an experimental band, and choose a grounded response.

Clarity runs entirely in your browser. No accounts, no uploads, no analytics.

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

CI runs the same command on every push and pull request to `main`.

Key suites:

- **Gold harness** (`tests/gold-report.test.js`, `tests/gold/corpus.js`) — locked benign, autonomy, coercive, and hard-neutral slices
- **Safety gate** (`tests/audit-v032-gate.test.js`) — 40 critical + 40 benign safety cases
- **Beta readiness** (`tests/beta-readiness.test.js`) — calibration and safety smoke checks
- **Project integrity** (`tests/project.test.js`) — self-hosted assets, CSP, service worker shell, history opt-in

Regression counts verify software consistency before release; they are not a published accuracy study. See [methodology.html](methodology.html).

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

## Project structure

| Path | Purpose |
|------|---------|
| `index.html` | Platform home (Learn or Analyze) |
| `learn.html` | Twelve language functions and lookalikes |
| `analyze.html` | Clarity analyzer UI |
| `app.js` | UI logic, history, stale-result handling |
| `scoring.js` | Deterministic scoring engine (`METHODOLOGY_VERSION`, currently v0.3.3) |
| `safety.js` | Safety notices (separate from manipulation scoring) |
| `text-normalize.js` | Unicode normalization, clauses, English-only abstention |
| `history-storage.js` | Opt-in `localStorage` keys and migration |
| `ocr.js`, `ocr-clean.js` | On-device OCR (UI gate disabled; assets cached for future use) |
| `service-worker.js` | Offline caching (`CACHE_NAME`, currently `clarity-v35`) |
| `tests/` | Node test runner suites (gold harness, safety gate, regressions) |
| `docs/ARCHITECTURE.md` | Contributor architecture, pipeline, and release notes |
| `docs/HTTPS.md` | Production HTTPS enforcement |
| `VISION.md`, `AGENTS.md` | Product vision and engineering guardrails |
| `privacy.html`, `terms.html`, `limitations.html`, `methodology.html`, `contact.html`, `acceptable-use.html`, `accessibility.html`, `changelog.html` | Trust and legal pages |

For pipeline detail, module boundaries, and release checklist, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
