# Manipulation Score

A privacy-first communication analysis dashboard that helps people identify potentially manipulative language, understand the signals behind a score, and choose from grounded pause, boundary, and clarification responses.

## What is included

- Six deterministic language-pattern categories with transparent fixed weighting.
- Exact, safely rendered message evidence and plain-language explanations.
- Personal, work, and family conversation contexts.
- Adaptable pause, boundary, and clarification response coaching.
- A responsive, keyboard-accessible interface with print support.
- An installable offline experience using a web app manifest and service worker.
- No analytics, accounts, backend, external runtime assets, or message persistence.

## Run locally

No build step or third-party dependencies are required.

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

The site can be deployed as-is to any static host. HTTPS is required for service-worker installation in production; `localhost` is permitted during development.

## Test

```bash
node --test tests/*.test.js
```

## Privacy and limitations

The scoring engine is deterministic and runs entirely in the browser. Evidence is rendered with safe DOM APIs rather than inserted as HTML, so pasted content cannot become executable markup. A restrictive Content Security Policy prevents third-party connections, and message content is never persisted in local storage or the offline cache.

Clarity analyzes phrases, not intent, identity, or relationship dynamics. It is an educational aid—not a diagnosis, safety assessment, or substitute for professional advice. A low score does not mean a situation is safe, and a high score does not establish intent.
