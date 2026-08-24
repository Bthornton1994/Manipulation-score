# Agent Instructions

## Project vision

Read `VISION.md`, `README.md`, `methodology.html`, `limitations.html`, and `acceptable-use.html` before planning substantial changes to analysis, scoring, safety, privacy, user experience, data handling, accessibility, monetization, or scope.

For each substantial proposal, classify it as:

- **Aligns**
- **Aligns with constraints**
- **Conflicts**
- **Vision is silent**

Name the relevant `VISION.md` section in the plan or handoff. If a request conflicts with the vision or requires an owner decision the vision does not resolve, surface that conflict and ask whether the request or the vision should change. Do not silently reinterpret or rewrite the vision to make a feature fit.

Only edit `VISION.md` when the task explicitly authorizes a vision change. Keep methodology claims synchronized with tested behavior, and never present regression coverage as established real-world accuracy.

Small fixes do not require a formal vision analysis, but they must not violate the vision. Before handoff, report the checks performed and any remaining vision tension.

## Engineering quality layer

For substantial software work, use pstack as an optional Cursor engineering-quality layer when it is installed. Upstream: `https://github.com/cursor/plugins/tree/main/pstack`.

pstack is subordinate to this repository's vision, methodology, acceptable-use rules, safety/privacy requirements, release rules, and explicit authority boundaries. Its autonomy defaults never authorize a merge, deployment, scoring or methodology change, data write, external message, publication, account or permission change, or other consequential action that this repository has not already authorized.

When using Cursor, prefer `/poteto-mode` for non-trivial engineering work and use pstack's adversarial review, eval, verification-skill, and decision-trail workflows when they fit the task. When using Claude Code, Codex, or another runtime, apply the equivalent disciplines without pretending Cursor-only commands exist: model the domain before coding, keep validation at boundaries, make operations idempotent, reproduce defects when practical, sequence changes into verifiable units, verify the real artifact rather than only CI, and independently challenge consequential changes.

Do not vendor the whole pstack plugin into this repository by default. Install it through Cursor so the plugin can evolve upstream while these repository-local governance rules remain stable.
