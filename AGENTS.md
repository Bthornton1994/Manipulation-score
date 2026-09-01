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

## Engineering execution principles

These rules are tool-agnostic. Apply them in Cursor, Claude Code, Codex, GitHub tooling, other agent runtimes, or human engineering work.

For substantial work:

- prefer the smallest sufficient change and remove obsolete complexity before adding layers;
- settle core data shapes, ownership, invariants, and concurrency assumptions before downstream logic;
- integrate new requirements from first principles rather than bolting them onto accidental structure;
- minimize hidden state, indirection, and reader load;
- prioritize the intended user experience over implementation convenience;
- compare multiple approaches when a consequential design is genuinely uncertain;
- build rerunnable scripts, validators, harnesses, generators, or benchmarks for repeated work and proof;
- model the domain explicitly and validate external data at system boundaries;
- make invalid states difficult to represent and lifecycle operations idempotent;
- migrate callers and remove obsolete internal APIs rather than maintaining permanent dual paths without cause;
- eliminate unnecessary shared mutable state before adding serialization or locks;
- reproduce defects and fix root causes when practical;
- sequence multi-step work into verifiable units and verify the real artifact or runtime behavior rather than treating green CI as sufficient proof;
- independently challenge consequential changes involving methodology, scoring, safety, privacy, evidence, release controls, or irreversible state;
- answer reversible, observable engineering questions with safe experiments when possible;
- encode repeated lessons into tests, schemas, types, invariants, metadata, verification tooling, or versioned Skills instead of repeating prose instructions.

These principles improve execution quality but grant no authority. They do not authorize merges, deployments, scoring or methodology changes, data writes, external messages, publication, account or permission changes, or any other consequential action not already allowed by this repository's vision, methodology, acceptable-use rules, and safety/privacy boundaries.

## UI design engineering skills

For UI or interaction work, read `docs/DESIGN_ENGINEERING.md` and `.claude/skills/emil-design-eng/SKILL.md` before editing. Use the supporting `animate`, `review-animations`, `improve-animations`, `find-animation-opportunities`, `animation-vocabulary`, `apple-design`, `pick-ui-library`, and `prototype` skills when the task calls for implementation, review, planning, vocabulary, gesture/material guidance, library selection, or genuine variant exploration.

The project's existing vision, security, privacy, accessibility, safety, data, and release rules remain authoritative. These skills guide interface craft and never authorize a merge, deployment, data write, external communication, or product-behavior change.
