<!-- BEGIN MANAGED BLOCK: shared-agents-policy v1 (t1739u) -->
# AGENTS.md

Shared operating rules for Codex and Claude Code in this repository. Follow every applicable rule. Keep this file operational: remove guidance that does not change an action.

1. Understand the task and protect the workspace

- Read the relevant repository instructions and inspect the files, tests, Git status, current branch, and worktrees before changing code.
- Preserve existing user changes. Do not reset, stash, overwrite, or discard work you did not create.
- Check for active workers, processes, or reviews before editing. Do not modify a frozen review tip or interrupt running work.
- If independent work must happen in parallel, use separate worktrees and keep each writer’s file scope distinct.

2. Plan in proportion to the task

- For a small, clear task, make the change directly.
- For a multi-step or long-running task, state the intended outcome and short plan in a progress update. Record steps and proof criteria in PLAN.md when the task needs durable tracking.
- If PLAN.md exists, preserve unrelated content and update only the relevant task section.
- Start work already authorized by the user; do not wait for another “yes” by default.
- Ask only when a material decision, missing owner-specific fact, or action outside existing authority prevents safe progress.
- If work pauses, update the plan with what is complete, evidence, current state, blocker, and next action.

3. Respect authority and keep work moving

- Proceed with routine, reversible repository work that advances the requested outcome.
- Follow repository-specific gates and the user’s explicit limits. Do not infer permission to merge, deploy, publish, spend money, change credentials, contact others, alter production data, or perform destructive actions.
- If the user has already granted standing authority for a specific action, do not ask again when the action is within that scope and all required gates pass.
- When one item is blocked, identify exactly what is blocked and continue independent authorized work.
- For minor implementation choices, use the least surprising option, record material assumptions, and continue. Ask only when the choice could materially change product behavior, risk, cost, or scope.

4. Make focused, durable changes

- Fix the cause of the requested problem with the smallest coherent change that meets the acceptance criteria.
- Preserve established behavior, interfaces, and data formats unless the task requires changing them.
- Avoid unrelated refactors and new dependencies. Add a dependency only when it materially improves the solution; explain why.
- Consider user experience, maintainability for developers, and clarity for future agents.
- Before destructive edits or deletions, verify the target and preserve any user data or work that must remain.

5. Use parallel workers deliberately

- Split work only when tasks are independent and parallel work will reduce time or improve review.
- Give each worker one bounded assignment, its baseline, files or scope, completion criteria, and required evidence.
- Keep implementation writers separate from read-only reviewers. Never assign two writers to the same files or worktree.
- Treat worker conclusions as claims, not proof. Check important findings against source files, command output, or other primary evidence.
- If subagents are unavailable or unsafe to use, continue directly and report the limitation.

6. Reproduce and fix bugs at their cause

- When reproduction steps are provided, follow them before changing code. Otherwise, use available tests, logs, and code to establish the failure.
- If the failure cannot be reproduced, report what you checked and what specific information is missing; keep investigating other useful evidence.
- Fix the underlying cause and add or update a regression check that verifies the expected behavior.
- Do not hide errors, weaken meaningful checks, or change a test merely to make the implementation pass.

7. Verify before claiming completion

- Derive checks from the task’s acceptance criteria and the repository’s documented commands.
- Run the narrowest relevant checks first, then broader required checks. Read the output and confirm the checks cover the changed behavior.
- For UI changes, exercise the actual flow in a browser or supported preview when available. Check relevant failure and edge cases, such as empty input, repeated submission, refresh, and error states.
- Wait for commands or workers that are still running when their results are needed.
- Label each check accurately: PASS, FAIL, BLOCKED, NOT RUN, or UNKNOWN. An unrun or unrelated check is not a pass.
- Do not say “done” until the requested acceptance criteria are met or the remaining blockers are clearly identified.

8. Report clearly and record durable lessons

- Give a concise final report: outcome, files or artifacts changed, exact verification and results, material tradeoffs or risks, and remaining blockers or next action.
- When the user corrects a behavior, add an actionable lesson under Lessons in the form: “When X, do Y.”
- Record reusable operating lessons, not one-time task facts or sensitive information. Put the newest lesson first and consolidate it if the same correction recurs.
- Ask before changing rules above Lessons. Remove a lesson only when it is clearly obsolete.

Lessons

<!-- Newest first. Keep each lesson concrete and reusable. -->
<!-- END MANAGED BLOCK: shared-agents-policy v1 (t1739u) -->


<!-- Project-specific instructions (outside managed block) -->
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

## Additional interface-quality skills

For broader interface work, read `docs/DESIGN_ENGINEERING.md` and the relevant `.claude/skills/better-*/SKILL.md` file before editing. Use `better-interface` to coordinate a holistic review and route each finding to its owning domain skill.

The `interface-review`, `explain-interface`, `variant`, and `break` skills are explicitly user-invoked. Do not start them implicitly. These skills guide interface craft and never authorize product-behavior changes, data writes, external communication, merges, deployments, or other consequential actions.

## Taste skill and redesign guidance

For existing UI work, read `docs/DESIGN_ENGINEERING.md`, `.claude/skills/design-taste-frontend/SKILL.md`, and `.claude/skills/redesign-existing-projects/SKILL.md` before editing.

- Apply the source brief inference, preserve-mode audit, and final pre-flight as review checks.
- Use the skills only on the surfaces named in `docs/DESIGN_ENGINEERING.md`. They do not supersede the product vision or authorize a visual rewrite.
- Keep user-facing text plain and specific. Avoid decorative labels, fake precision, and dash flourishes in new visible copy while preserving required product terminology and disclaimers.
- Do not copy image-generation, GSAP, fixed visual-preset, or landing-page patterns into product, trust, benefits, analyzer, or operational surfaces unless the surface is in scope, the interaction is justified, and dependencies are checked.
- Existing project instructions, product boundaries, accessibility requirements, and release controls remain authoritative.

## UI Skills from ibelick

For UI work, use the vendored `ui-skills-root` routing layer to select the smallest useful context. Use `baseline-ui` for spacing, hierarchy, typography, touch targets, and interaction polish; `fixing-accessibility` for controls, forms, focus, and semantics; `fixing-motion-performance` for animation and scroll-linked behavior; and `improve-ui` for evidence-backed surface audits and bounded implementation plans.

These files are vendored from `https://github.com/ibelick/ui-skills` at commit `f2dadf221a166a79606b337d08ce0b04d0d2bfd9` and are reference material, not a runtime dependency. Existing Emil, Jakub, and Leon guidance, `VISION.md`, methodology, acceptable-use, safety, privacy, and release controls remain authoritative.

Apply the guidance to the public landing, Learn, trust, and analyzer shell only. Preserve no-account operation, history-off-by-default behavior, local-only message handling, uncertainty, evidence-linked language, safety notices, and non-diagnostic framing. Do not change scoring, signal definitions, methodology, or message handling.


## Test audit skill

For adding, changing, reviewing, or auditing tests, read `.claude/skills/test-audit/SKILL.md` before editing. Use **authoring mode** when writing or reviewing test changes for a feature or bug fix. Use **audit mode** only when explicitly asked to find low-value, duplicated, or brittle tests, and start read-only with evidence before deleting anything.

This skill guides test design and review. It does not authorize broad test cleanup during unrelated work, production-behavior changes for test convenience, or merge, deployment, or release actions.

## External agent stack from linked Grok and Cursor setup

For UI, copy, source verification, and completion claims, read `docs/EXTERNAL-AGENT-SKILLS.md` and load only the smallest relevant vendored skill. Use `frontend-ui-engineering` for interface implementation, `source-driven-development` for framework-specific decisions, `no-ai-slop` for visible copy, `no-ai-design-slop` for product-specific UI audits, and `verification-before-completion` before claiming a fix or passing check.

Apply this stack to the public landing, Learn, trust pages, and analyzer shell. Existing project vision, product boundaries, security, privacy, accessibility, methodology, tenant isolation, and release controls remain authoritative. The vendored files are source material, not runtime dependencies, and they do not authorize autonomous execution, production access, external actions, merges, or deployments.

## External repository references

For linked repository discovery posts, read `docs/EXTERNAL-AGENT-REPOSITORIES.md` before evaluating a new dependency, context store, agent runtime, model proxy, or UI reference. It records dispositions only. Do not install or enable a listed system without a separate architecture, license, data-authority, safety, and verification review. Existing project documents remain authoritative.

## Design contract

Read `DESIGN.md` together with `docs/DESIGN_ENGINEERING.md`, `AGENTS.md`, and the governing project documents before UI work. `DESIGN.md` is the compact design contract for product intent, responsive states, accessibility, truthful copy, and verification. It does not authorize product-behavior, data, scoring, commerce, external-action, merge, or deployment changes.

## Stack rules

When editing stack-specific code, load the matching `.cursor/rules/*.mdc` file. These rules are versioned guidance and are scoped by their frontmatter. Confirm `package.json` and active framework configuration before applying them; the Prisma rule is dormant unless Prisma is present.
