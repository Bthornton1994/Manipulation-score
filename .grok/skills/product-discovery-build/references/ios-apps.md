# Applying the workflow to iOS apps

Use this reference only for an iOS app or iOS-specific feature. The main skill's evidence, authority, privacy, and verification rules still apply.

## Before implementation

- Inspect the repository's existing Swift, Xcode, package, design-system, backend, subscription, analytics, and testing setup. Preserve an established app architecture unless evidence supports a change.
- Check whether Xcode, simulators, and any requested MCPs are actually available. For App Store, platform-policy, SDK, and pricing claims, verify current primary sources and record the date. Do not require Appllama, Higgsfield, XcodeBuildMCP, Supabase, Superwall, or RevenueCat merely because an example prompt names them.
- Prepare a product brief and `RESEARCH.md` (or update the existing equivalent), then a `DESIGN.md`, architecture/stack decision, asset inventory, onboarding map, acceptance criteria, and task sequence before app code begins.
- Research three niche-relevant apps only when current evidence supports the selection. Describe a screen-by-screen flow only for screens the researcher can legitimately inspect. Separate observed UI and publicly listed offers from inferred strategy. Do not claim competitor conversion performance without public evidence.

## Design and implementation

- Define semantic design tokens before new screens. Include light and dark appearances, dynamic type, contrast, reduced motion, VoiceOver labels/focus, touch targets, and layout adaptation where relevant. Use SF Symbols only if they fit the product and platform; do not forbid a properly licensed custom icon system.
- Reuse the same approved base style prompt and character references for related generated images. Add subject-specific details per asset; preserve consistency without forcing a mascot into products that do not need one.
- Use SwiftUI, async/await, MVVM, or a `Models / Views / ViewModels / Services / DesignSystem / Resources` structure only when they fit the app and existing code. They are candidate defaults, not universal requirements.
- Select authentication, storage, subscriptions, paywalls, analytics, and crash reporting from product needs, privacy, platform policy, operational cost, and current project constraints. Do not add a provider, create live products, or spend money without authorization.
- Map onboarding and its states before implementation. Copy useful sequence-level patterns, not competitor text, pricing, illustrations, layout, or branding. A hard paywall and a competitor-matched price require an explicit product decision; neither is the default.
- Record an event plan with purpose, data fields, consent/disclosure needs, retention, and a minimization rationale before adding analytics. Do not log sensitive data just to measure every step.

## Verify each UI slice

- Build and run the real app in an available simulator or device. Capture a screenshot of each material screen/flow slice and compare it with the approved design tokens and original reference observations.
- Verify behavior as well as appearance: navigation, back/skip, loading, empty/error states, accessibility, persistence, and relevant purchase/auth flows in a test environment.
- If XcodeBuildMCP is unavailable, use the repository's documented Xcode build/test path where available. Label simulator or screenshot checks **NOT RUN** when they were not performed; a successful compile alone is not visual verification.
- Keep test billing and sandbox accounts separate from production. Do not create or modify live App Store, payment, analytics, or backend configuration without explicit authorization.
