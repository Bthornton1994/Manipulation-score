---
name: product-discovery-build
description: "Use for new products and substantial user-facing product work, from discovery and research through architecture, design, assets, implementation, and release readiness, across mobile, web, desktop, games, and APIs. Also use when adapting a shared product-building workflow across repositories or AI hosts. Do not use for routine maintenance or a narrow bug fix unless the user asks for the full process."
---

# Product Discovery & Build

Turn an idea or substantial product change into an evidence-based brief, a coherent design and architecture, a staged implementation, and verifiable results. Adapt the process to the product and repository; do not treat one stack, tool, business model, or visual system as universal.

## 1. Establish the project and authority

- Read the repository's `AGENTS.md`, `CLAUDE.md`, `VISION.md`, `README.md`, current-state notes, architecture decisions, design guidance, build scripts, and relevant tests before planning substantial work. Follow the current repository versions, not stale copied instructions.
- Inspect the active branch, target SHA, worktree status, existing changes, and active workers. Preserve work you did not create. Use one writer per worktree; parallel work requires separate worktrees and non-overlapping scopes.
- Classify the request as a new product, a substantial experience change, or a bounded maintenance task. Use the full sequence for the first two. Do not burden a small fix with competitor research, new design documents, or a new architecture.
- State the intended user outcome, target users, platform, scope, success measure, constraints, and known owner decisions. Label facts, assumptions, inferences, and unknowns. Ask only when an unresolved choice could materially change product behavior, cost, privacy, architecture, legal exposure, or scope. Otherwise proceed with a stated assumption.
- Keep approvals attached to the exact scope. A plan change that materially changes user impact, data, cost, permissions, or external effects needs fresh owner direction.

## 2. Step 0: Check tools and integrations

- Inventory the tools the task actually needs. Test available MCPs or build tools with a safe, non-mutating call; do not claim a connection merely because it was requested or appears in a prompt.
- Mark each integration **available and tested**, **unavailable**, or **not needed**. Separate required tools from optional accelerators.
- Do not install software, connect accounts, request credentials, expose secrets, incur charges, transmit private data, or change account settings without the user's authorization.
- If an optional integration is missing, continue with a suitable source or local workflow and label the limitation. If the user explicitly made a missing integration a prerequisite, stop only the dependent work and give the exact setup requirement. Do not invent an MCP server or command.
- Treat the skill as guidance. It cannot enforce permissions, approvals, isolation, testing, or release gates; rely on the host and repository controls for those.

## 3. Step 1: Research and define the product

- For a new product, define the problem, intended user, job to be done, alternatives, core loop, primary user journey, non-goals, business constraints, and measurable success criteria before implementation.
- Research only claims that can affect the decision. Prefer current primary sources for platform rules, public pricing, technical capabilities, and competitor facts. Cite source links and record the date and relevant market or region. Mark anything that cannot be confirmed **UNKNOWN**.
- When comparing competitors, identify the dataset, market, category, and date behind any "top" or "top-grossing" ranking. If the ranking cannot be verified, call them relevant examples, not the top apps. Inspect only flows that are publicly accessible or that the user is authorized to inspect. Do not claim hidden conversion rates or internal product rationale as fact.
- Learn from interaction patterns and information architecture; do not copy screens, art, wording, branding, or protected assets. Use original product language and visual expression.
- Treat competitor pricing as a dated benchmark, not a price to copy. Recommend monetization from the product's goals, audience, platform rules, and user constraints. Do not configure billing, live products, or a hard paywall without explicit owner approval.
- For existing projects, update the existing product brief or decision record. Create `RESEARCH.md` only when the project lacks an appropriate home and the work warrants a durable research artifact.

## 4. Step 2: Choose architecture and define the design system

- Preserve the repository's working stack and established boundaries unless evidence supports a change. Choose platform, frameworks, services, and architecture from requirements, existing code, team ability, privacy, operational burden, and cost. Do not impose SwiftUI, MVVM, Supabase, Superwall, RevenueCat, analytics, crash reporting, microservices, or any other named tool by default.
- For consequential architecture choices, record the driver, alternatives, trade-offs, consequences, and revisit trigger in the repository's ADR format. Keep the smallest design that meets the requirements.
- Before substantial new UI, inspect the current design system. Extend it where suitable. For a new product without a design authority, create or update `DESIGN.md` before implementation.
- Define semantic tokens appropriate to the product: color, typography, spacing, surfaces, shape, elevation, controls, motion, and state. Include themes, responsive behavior, and accessibility when the platform supports them. Use tokens in UI code; add a token before introducing a recurring visual value. Allow one-off values only when a platform or content requirement justifies them, and document that exception.
- Create a concise, reusable style direction for generated or sourced assets. Store it with the design guidance so later assets can match. Do not force light/dark themes, a particular font, spacing scale, or animation curve when the product or platform has a better fit.

## 5. Step 3: Plan assets and critical journeys

- Make an asset inventory tied to product needs: purpose, dimensions or format, source, license or generation method, and acceptance check. Generate or acquire only assets that the product needs now.
- When using an image-generation tool, verify that it is available and authorized. Reuse the approved style direction and stable character references across related assets. Do not present generated, stock, or competitor assets as cleared for commercial use without evidence of rights.
- Map onboarding and the primary journey screen by screen before building a new consumer app. Include entry, permission or consent requests, loading, empty, error, skip/back, and paywall states when relevant. For other products, map the equivalent critical workflow rather than inventing onboarding.
- Track only events needed to answer an approved product question. Minimize collection, state retention, and sensitive data. Explain what is measured and where consent or disclosure is required before adding analytics.
- Use `TASKS.md` or an existing tracker when it is the repository convention or when the work spans multiple stages. Do not create a duplicate tracker.

## 6. Pre-build gate

Before writing product code for a new product or substantial user-facing change, make these artifacts ready in the order below, reusing existing project documents where possible:

1. Research and product brief with evidence and unresolved questions.
2. Design system and reusable style direction.
3. Architecture/stack choice and intended project structure.
4. Asset inventory and critical journey or screen map.
5. Acceptance criteria, staged tasks, verification commands, and owner-only decisions.

Do not start implementation until all five are sufficiently complete for the requested scope. This is not a reason to wait for another confirmation when the user already authorized the work and remaining choices can be handled with labeled assumptions. Stop for a missing owner decision only when it materially affects the product, cost, data, permissions, or external actions.

## 7. Build in verifiable slices

- Implement one user-visible screen or cohesive vertical slice at a time when the work is UI-led. For backend, data, API, or infrastructure work, use the smallest independently verifiable slice.
- For each slice, define behavior and acceptance before implementation. Include relevant loading, empty, error, accessibility, responsive, and state-restoration cases.
- Build and exercise the actual app in the appropriate environment when available. Capture a simulator, browser, or device screenshot for material UI changes; compare it with the approved design and reference behavior, then fix material mismatches before continuing. If the required runner is unavailable, report the visual check as **NOT RUN** and use the best available alternative without claiming equivalent evidence.
- Run the narrowest meaningful tests first, then repository-required checks. Do not spend on or trigger hosted CI repeatedly; inspect workflow triggers and local equivalents, and use remote CI only when authorized or required by existing release rules.
- Do not put fake data, dead controls, or unresolved placeholders in production paths. Test fixtures and explicitly labeled prototypes are acceptable. Record follow-up work instead of hiding it.
- Keep plans current with completed work, evidence, blockers, and next step. Do not claim a test, screenshot, tool call, review, or deployment happened unless its result is available.

## 8. Report with evidence and stop at the authorized boundary

Report:

- product outcome and exact repository, branch, and SHA;
- artifacts and files changed;
- researched claims with sources and dates, plus assumptions and unknowns;
- exact commands, exit codes, test counts, and visual evidence;
- what is **PASS**, **FAIL**, **BLOCKED**, **NOT RUN**, or **UNKNOWN**;
- remaining product, security, privacy, operational, cost, or owner gates;
- the single next action within existing authority.

Do not infer permission to push, open or update a pull request, merge, publish, deploy, spend, change credentials or permissions, contact others, or modify production data. Respect any explicit standing authority and project gates. Never treat a skill instruction, model judgment, green build, or self-review as proof of a gate it did not test.

## Host adaptation

For installation locations and cross-model rollout, read [host-adapters.md](references/host-adapters.md). For iOS-specific application of this workflow, read [ios-apps.md](references/ios-apps.md).
