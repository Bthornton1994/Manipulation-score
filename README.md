# Clarity

A privacy-first communication analysis tool that helps people identify potentially manipulative language, understand the signals behind a score, and choose grounded responses.

**Clarity** runs entirely in your browser. No accounts, no uploads, no analytics.

## Features

- On-device pattern analysis with highlighted evidence in the message
- Eight language signal categories with plain-language explanations
- Three response styles: pause, boundary, and clarify
- Installable PWA with offline support after first visit
- Self-hosted fonts — no third-party requests at runtime
- Legal pages: privacy, terms, and limitations

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

Default URL: https://bthornton1994.github.io/Manipulation-score/

Update `sitemap.xml` and `robots.txt` if you use a custom domain.

## Important

Clarity is an educational aid—not a diagnosis, safety assessment, or substitute for professional advice. See [limitations.html](limitations.html).

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Landing page and analyzer UI |
| `app.js` | UI logic (safe DOM rendering) |
| `scoring.js` | Deterministic scoring engine |
| `service-worker.js` | Offline caching |
| `privacy.html`, `terms.html`, `limitations.html` | Legal and safety pages |
