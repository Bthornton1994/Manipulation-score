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
