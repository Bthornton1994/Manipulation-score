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