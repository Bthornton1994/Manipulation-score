# Manipulation Score

A privacy-first communication analysis dashboard that helps people identify potentially manipulative language, understand the signals behind a score, and choose a grounded response.

## Run locally

No build step or third-party dependencies are required.

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Test

```bash
node --test tests/*.test.js
```

The scoring engine is deterministic and runs entirely in the browser. Evidence is rendered with safe DOM APIs rather than inserted as HTML, so pasted content cannot become executable markup. It is an educational aid—not a diagnosis, safety assessment, or substitute for professional advice.
The scoring engine is deterministic and runs entirely in the browser. It is an educational aid—not a diagnosis, safety assessment, or substitute for professional advice.
