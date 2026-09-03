# Design contract

This file is the compact, agent-readable entry point for interface work in this repository. It complements `docs/DESIGN_ENGINEERING.md`; it does not replace `AGENTS.md`, `VISION.md`, safety, privacy, methodology, data, or release documentation.

## Product intent

Clarity is a calm, private communication literacy and analyzer experience by Manipulation Score. Preserve evidence-linked explanations, uncertainty, alternative explanations, verification questions, safety notices, and non-diagnostic framing.

## Current brand direction

The public product leads with Clarity and uses Manipulation Score as the endorser. The current visual system is the pause field: ink, warm paper evidence surfaces, and one signal-lime accent. See `BRAND.md` for the positioning, voice, tokens, and experience architecture.

## Design principles

- Start with the Clarity brand system, existing product surface, tokens, primitives, and information architecture. Remove or correct the highest-impact supported problem before adding novelty.
- Keep one coherent visual idea per surface. Do not import a generic AI aesthetic, a copied brand system, or a fixed visual preset.
- Make hierarchy, interaction state, and next action legible through spacing, type, semantic color, and composition.
- Keep visible copy direct, specific, and truthful. Do not add invented proof, metrics, testimonials, partners, outcomes, or urgency.
- Design the complete state set: loading, empty, error, disabled, focus, keyboard, narrow viewport, and reduced motion.

## Responsive and accessibility gate

Before handoff, inspect the actual rendered surface at the repository's supported viewports, including narrow mobile and wide desktop states. Check:

- readable type hierarchy, wrapping, overflow, and tabular numbers where values are compared;
- keyboard order, accessible names, focus visibility, touch targets, contrast, and reduced-motion behavior;
- loading, empty, error, disabled, and recovery states;
- whether the primary task remains visible without unnecessary scrolling or a persistent panel blocking content.

## Project guardrails

- Score messages or interactions, never people; do not infer intent, diagnosis, or certainty.
- Do not change scoring, signal definitions, methodology, message handling, privacy behavior, or safety behavior through UI work.
- Preserve no-account operation, history-off-by-default behavior, local-only message handling, and honest limitations.

## Source discipline

The `DESIGN.md` pattern is informed by [Refero Styles](https://styles.refero.design/), [getdesign.md](https://getdesign.md/), [OpenDesign](https://github.com/nexu-io/open-design), and [awesome-design-md](https://github.com/VoltAgent/awesome-design-md). Those are catalogs and tooling references, not authorities for this product.

Do not copy external brand assets, hosted templates, generated claims, or third-party components into this repository without a separate review. This file is the local design contract; project-specific documentation and fresh verification evidence remain authoritative.

## Verification

Run the repository's documented lint, typecheck, test, and build checks relevant to the change. Report visual verification separately from automated checks. Do not claim completion when a required check is pending or failed.
