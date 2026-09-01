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
