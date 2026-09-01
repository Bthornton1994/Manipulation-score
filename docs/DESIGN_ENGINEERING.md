# UI design engineering

Manipulation Score uses a focused, vendored subset of Emil Kowalski's UI skills to make Clarity feel calm, private, and easy to understand.

## Source

- Upstream: https://github.com/emilkowalski/skills
- Pinned source commit: `d23d7f88a2e21c9e4b1418c7abe420f5c1052ba7`
- License: MIT, see `docs/EMIL-SKILLS-LICENSE.md`.
- Vendored skills are updated deliberately from the pinned source commit so agent behavior remains reproducible.

## How agents use the skills

- Read this file, `VISION.md`, methodology, limitations, and acceptable-use guidance before UI work.
- Read `.claude/skills/emil-design-eng/SKILL.md` for every UI change.
- Use `animate` for a new interaction, `review-animations` for motion review, and `find-animation-opportunities` or `improve-animations` before proposing additional motion.
- Use `pick-ui-library` before adding a third-party UI primitive. Use `prototype` only when multiple materially different directions are needed.

## Clarity guardrails

- UI polish must not change scoring, signal definitions, methodology, privacy behavior, local-only message handling, or safety language.
- Keep the experience non-diagnostic and non-deterministic in tone. Do not make a transition or visual emphasis look like a certainty claim.
- Preserve no-account operation, history off by default, and current `prefers-reduced-motion` behavior.

The vendored files are source material for agents. Project-specific instructions in `AGENTS.md`, `VISION.md`, methodology, limitations, and acceptable-use guidance override them.

## Jakub Krehel interface-quality skills

Manipulation Score also vendors Jakub Krehel’s interface-quality skills as a complementary, evidence-first layer for accessibility, layout, writing, typography, color, and UI polish.

### Source

- Upstream: https://github.com/jakubkrehel/skills
- Pinned source commit: `267330e1adfc66a718fb65fa6918c1f06d0a689e`
- License: MIT, see `docs/JAKUB-KREHEL-SKILLS-LICENSE.md`.
- The vendored files are updated deliberately from this pinned source commit so agent behavior remains reproducible.

### How agents use the skills

- Read this file and the project’s governing vision and safety documents before UI work.
- Use `better-interface` as the cross-discipline orchestrator and read the owning `better-*` skill for the domain being changed.
- `interface-review`, `explain-interface`, `variant`, and `break` are user-invoked procedures and must not be started implicitly.
- Preserve the project’s existing tokens, component patterns, motion language, and responsive conventions. Measure rendered contrast before proposing a color change.

### Project guardrails

- Keep the product private, non-diagnostic, evidence-linked, and non-accusatory; visual emphasis must not turn a score into a verdict.
- Preserve no-account operation, history-off-by-default behavior, local-only message handling, uncertainty, and safety boundaries.
- Do not change scoring, signal definitions, methodology, or message handling as part of interface polish.

The vendored files are source material for agents. Project-specific instructions in `AGENTS.md`, `VISION.md`, and the existing design-engineering guidance override them.

## Taste skill and redesign guidance

This repository vendors a focused subset of Leonxlnx's `taste-skill` collection for evidence-backed interface refinement.

### Source

- Upstream: https://github.com/Leonxlnx/taste-skill
- Pinned source commit: `undefined`
- License: MIT, see `docs/LEONXLNX-TASTE-SKILL-LICENSE.md`.
- The pinned core skill is v2 experimental, so agent behavior remains reproducible at this revision.
- Vendored files:
  - `.claude/skills/design-taste-frontend/SKILL.md`
  - `.claude/skills/redesign-existing-projects/SKILL.md`

### How agents use it

- Start with the core skill's design read and the redesign skill's scan, diagnose, and fix sequence.
- Treat an existing surface as preserve-mode unless an owner explicitly approves an overhaul.
- Use the core pre-flight for accessibility, mobile collapse, reduced motion, copy clarity, visual hierarchy, and performance. Do not treat its landing-page patterns as requirements for product surfaces.
- Keep this project's tokens, information architecture, copy voice, data semantics, privacy, safety, and release controls authoritative.

### Project application map

- Design read: preserve-mode private literacy experience for people reading difficult messages, with calm cream, teal, coral semantic signals, and readable display type.
- Review dials: DESIGN_VARIANCE 3, MOTION_INTENSITY 2, VISUAL_DENSITY 4 on public literacy routes. These describe the current surface and guide proportionate review; they are not permission to replace the product language or layout.
- Scope: Apply taste guidance to the public landing, Learn, limitations, methodology, privacy, and trust pages. Analyzer results remain governed by the methodology and safety boundaries; do not apply a marketing aesthetic to scoring evidence.
- Guardrails: Preserve no-account operation, history off by default, local-only message handling, uncertainty, evidence-linked language, safety notices, and non-diagnostic framing. Do not change scoring, signal definitions, methodology, or message handling.

The upstream collection also contains image-generation, image-to-code, Stitch, legacy v1, and fixed aesthetic preset skills. Those are intentionally not vendored here because they would introduce unrelated assets, dependencies, or visual mandates. The vendored files are source material for agents, and this repository's governing instructions override them.
