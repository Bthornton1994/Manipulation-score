# Manipulation Score: Media Lens and Influence Graph — Build brief
Date: 2026-09-18 UTC
Repo: https://github.com/Bthornton1994/Manipulation-score
Newsjack: https://github.com/elvisun/newsjack
Newsjack Jev plan: https://github.com/elvisun/newsjack/blob/main/docs/2026-09-18-jev-coarse-filter-plan.md

## Executive decision
Build a new public-content mode **Media Lens**. Keep existing private **Clarity** analyzer unchanged (browser-local, no account, no upload, no Jev, no third-party runtime for private messages).

Media Lens uses Newsjack for dated sources, clustering, origin/canonical, freshness/provenance.
Use Jev as typed semantic classifier only — not final authority on intent, truth, outlet quality, or person-level manipulation.
Do **not** ship overall 0–100 Media Lens manipulation score in v1.
Deliver evidence-linked `influence-graph.v1`.

## Hard bans
- No public manipulator scores for journalists/outlets/politicians/people
- No leaderboards/rankings of manipulative sources
- No single article score as factuality/intent/bias/proof
- No private Clarity messages to Jev/Newsjack
- No Jev/news API keys in browser JS
- No full article text persistence by default
- No paywall bypass
- No "This outlet/journalist/politician is manipulative" / "proves misinformation" / "source is unsafe" labels

## Allowed UI language
Observed influence signal; possible selective-context candidate; claim support unclear; quoted language not attributed as authorial; insufficient context.

## Read before code (Manipulation-score)
VISION.md, README.md, AGENTS.md, methodology.html, limitations.html, privacy.html, acceptable-use.html, scoring.js

## Read before code (Newsjack)
README.md, AGENTS.md, skills/relevance-coarse-filter/SKILL.md, skills/story-origin-check/SKILL.md, docs/2026-09-18-jev-coarse-filter-plan.md, eval/jev-coarse-agreement/README.md, LICENSE

## Influence taxonomy (initial)
loaded/moralized; fear/threat; urgency; false dilemma; identity/in-group; scapegoating/dehumanizing; certainty beyond evidence; vague authority; emotional anecdote→generalization; selective-context candidate; bandwagon; adversarial/conflict framing.

## Four UI dimensions (separate)
1. Language — span-tied signals
2. Claims — supported/contradicted/mixed/unclear/not_checked
3. Coverage — origin, independent reporting, duplication, frames
4. Source context — ownership/metadata/ratings shown separately (not fused into manipulation)

## Schema invariants (influence-graph.v1)
Every observation has span or unlocalized; quotes ≠ authorial; every claim has support or not_checked; sources have URL/timestamp when available; engine/model/question-set/timestamps; abstention first-class; no person/outlet inherently manipulative field.

## Privacy/security
Server-side or local worker for keys; disclose external processing; treat article text as untrusted/prompt-injection; size/timeout/retry/rate limits; Jev fail → unreviewed/needs_review/abstention never fabricate; pin jev-1.13.0; record model + question-set hash.

## Implementation order
1. Audit repo + short plan; STOP on VISION/privacy/acceptable-use/methodology conflict
2. Adapter + versioned influence-graph schema
3. Fixtures + contract tests
4. Media Lens preparation layer
5. Jev typed-analysis adapter
6. Deterministic fusion, evidence mapping, abstention, failure handling
7. Separate Media Lens UI
8. Privacy/retention/consent docs
9. Full existing tests + new Media Lens tests
10. Draft PR only — no merge/deploy

## Required tests (summary)
Clarity suite still pass; private path zero network; no API key in browser bundle; quote vs authorial; observation→span/abstention; claim support; duplicates ≠ independent; fresh story needs Newsjack provenance; prompt-injection inert; missing timestamps → uncertainty; no full text persist by default; a11y (keyboard/focus/contrast/responsive/reduced motion).

## Completion report required
exact SHA; changed files; architecture decisions; commands; test results; privacy/network verification; fixtures/evals; known limitations; not implemented; preview URL if any.
