# classifier.dev privacy disposition (evaluation-only)

Recommendation: **KEEP_EVALUATION_ONLY**

Status: **evaluation-only**. `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` remains **off by default**. Live URL is unauthorized. Live pasted-text is unauthorized. This note is **not production-ready** and is not an accuracy claim. Related to [Issue #118](https://github.com/Bthornton1994/Manipulation-score/issues/118); it does **not** close that issue.

This file is the in-repo source of truth for Independent QA and future operators. It records the 2026-09-19 PT public-source review. It does not enable any live flag.

Vision check: **Aligns with constraints** (`VISION.md` “Privacy is the default architecture”, “Uncertainty must be visible”, “Analyze communication, not identity”). Private messages stay on Clarity’s on-device path. classifier.dev is not a browser-side caller.

**Not selected:** `READY_FOR_OWNER_PRIVACY_ACCEPTANCE` (signed DPA, residency, breach SLA, upstream retention/training, and a subprocessor register remain open). Evaluation with non-article / fixture / synthetic probes may continue under existing flags; production and live enablement remain unauthorized.

## Sufficiency rule

A public statement that classifier.dev “stores no request text” (or “does not write them to disk”) is **insufficient alone** for production acceptance.

Production needs contractual and technical verification of the **full processing chain**, including TypeSafe (Jev), OpenRouter, any ultimate reasoning-model provider, Cloudflare Analytics Engine, and any fallback path. Do not copy classifier.dev marketing language into Clarity user-facing privacy copy.

## Top gaps (2026-09-19 PT)

1. **No signed DPA.** classifier.dev has no public `/dpa`. Written contract is contact-only / partner-arrangement. This is the primary Issue #118 privacy blocker.
2. **Upstream retention unverified** for TypeSafe, OpenRouter, and any ultimate model on the real call path. Media Lens is not that contracting party today.
3. **Smart / fallback training risk.** OpenRouter documents provider-dependent training use. classifier.dev does not publish ZDR / `data_collection: deny` enforcement for Media Lens traffic.
4. **No data residency** commitment from classifier.dev. TypeSafe public privacy says Services are hosted in the United States.
5. **No customer breach-notification SLA** and **no formal subprocessor register** (public `/subprocessors` 404).

Prefer default tier **fast**. Do **not** enable `smart` on any live path until contracts close the TypeSafe / OpenRouter / ultimate-model chain.

## How to read statuses

| Status | Meaning |
| --- | --- |
| `VERIFIED_PUBLIC_CLAIM` | Text appears on a cited public page or repo file as of the retrieval date. Not independently audited runtime behavior. Not a contract with Media Lens. |
| `UNVERIFIED` | Claim exists but is unproven for Media Lens production use, or depends on unreviewed upstream terms, account settings, or routing. |
| `CONFLICTING` | Sources disagree or leave a material ambiguity for Media Lens. |
| `NOT_FOUND` | No public page located after fetching the listed URLs and common legal paths. |

All provider claims below are **UNVERIFIED as production guarantees** until Owner plus Independent QA accept contractual and technical evidence.

## Public sources (retrieved 2026-09-19 PT)

### classifier.dev

- https://classifier.dev/privacy (last updated 2026-09-19)
- https://classifier.dev/docs
- https://classifier.dev/auth.md (last updated 2026-09-19)
- https://classifier.dev/terms (last updated 2026-09-19)
- https://classifier.dev/benchmark
- https://classifier.dev/pricing
- https://classifier.dev/pro
- Probed 404: https://classifier.dev/dpa · https://classifier.dev/legal · https://classifier.dev/subprocessors

### GitHub `mrmps/classifier-dev`

- https://github.com/mrmps/classifier-dev (no `LEGAL/`, `PRIVACY.md`, DPA, or subprocessors document found)
- https://raw.githubusercontent.com/mrmps/classifier-dev/main/README.md
- https://raw.githubusercontent.com/mrmps/classifier-dev/main/LICENSE (MIT)
- https://raw.githubusercontent.com/mrmps/classifier-dev/main/src/privacy.ts (analytics hashing; corroborates hashing claims, not a DPA)

### Upstream named by classifier.dev (not Media Lens counterparties unless contracted)

- https://typesafe.ai/privacy-policy
- https://typesafe.ai/legal/data-processing
- https://openrouter.ai/privacy
- https://openrouter.ai/docs/guides/privacy/data-collection

## Topic dispositions

### Input retention

| Field | Content |
| --- | --- |
| Public claim | Privacy: texts and labels are forwarded to the model provider; “This service does not write them to disk.” README: “No request text is ever stored.” Operational metadata (tier, model, latency, status, coarse country, client family, keyed label-set fingerprint, daily keyed IP hash) kept 90 days in Cloudflare Analytics Engine. |
| Status | `VERIFIED_PUBLIC_CLAIM` for classifier.dev’s **stated** practice; `UNVERIFIED` for runtime truth, upstream TypeSafe / OpenRouter / ultimate-model retention, transient logs, abuse systems, Cloudflare edge, or provider-side caches |
| Owner implication | “Not stored by classifier.dev” does not mean “not retained anywhere in the chain.” |

### Training use of inputs

| Field | Content |
| --- | --- |
| Public claim | classifier.dev terms: uses texts only to answer the request and does not store them. TypeSafe privacy: “We will not train or fine tune any artificial intelligence or machine learning models on your prompts or other Input.” OpenRouter: OpenRouter does not train on Inputs/Outputs; Model Providers may retain and use them for training unless constrained by routing, settings, or DPA. |
| Status | `CONFLICTING` / incomplete chain |
| Owner implication | Fast / Jev may be closer to a no-train story **if** TypeSafe terms apply to classifier.dev’s TypeSafe account (Media Lens is not that account holder). Smart plus fallback LLM is a material training/retention risk until routing controls and contracts are evidenced. Keep default tier `fast`. |

### Fallback / subprocessors

| Field | Content |
| --- | --- |
| Public claim | TypeSafe for the decision model; smart-tier re-asks via the reasoning model's provider via OpenRouter. Infra named: Cloudflare Worker + Analytics Engine; billing Autumn + Stripe; newsletter Neon; email Resend; optional Vercel AI Gateway. README documents a past primary-model delist that quietly served granite for weeks. |
| Status | `VERIFIED_PUBLIC_CLAIM` that these parties are named; `NOT_FOUND` for a formal subprocessor register; `UNVERIFIED` which party processes a given Media Lens call under failure/fallback |
| Owner implication | Treat classifier.dev as a multi-party processor graph. Owner must approve named parties and silent-fallback behavior. |

### Commercial use and terms

| Field | Content |
| --- | --- |
| Public claim | Terms: lawful use within limits; answers are yours to keep. Service “as is,” accuracy not promised, liability limited. California governing law. Continued use after a posted change is acceptance. Partner keys have their own written terms. MIT license covers the open-source code, not the hosted service. |
| Status | `VERIFIED_PUBLIC_CLAIM` for public ToS commercial permission of outputs; `UNVERIFIED` whether Media Lens commercial product use is acceptable under Owner risk appetite given as-is + no DPA |
| Owner implication | Output ownership language does not create processor obligations, SLAs, or indemnities suitable for Clarity production. Prefer partner/written terms before any live enablement. |

### DPA availability

| Field | Content |
| --- | --- |
| Public claim | No public `/dpa`, `/legal`, or `/subprocessors` (404). Pricing Partner: teams who need a contract should email / book Cal.com. Terms: no other contract unless you hold a partner key with one. |
| Status | `NOT_FOUND` as a public self-serve DPA; contact-only / partner-arrangement for a written contract |
| Owner implication | Production acceptance needs a signed DPA (or written partner terms) naming subprocessors, retention, training, residency, breach, deletion, and audit rights — or an Owner-accepted residual-risk waiver (not recommended without Independent QA). |

### Data residency

| Field | Content |
| --- | --- |
| Public claim | No residency / region-pinning commitment on classifier.dev privacy or terms. Service is a Cloudflare Worker. TypeSafe privacy: Services hosted in the United States. OpenRouter describes US/other transfers and optional enterprise in-region routing (not claimed for classifier.dev). |
| Status | `NOT_FOUND` for a classifier.dev residency guarantee; US hosting is a `VERIFIED_PUBLIC_CLAIM` for TypeSafe only |
| Owner implication | Assume US / multi-region edge processing unless dedicated deployment / private inference is contracted. |

### Incident / breach notification

| Field | Content |
| --- | --- |
| Public claim | classifier.dev privacy/terms: no published customer breach-notification timeline. TypeSafe DPA (if one were a TypeSafe “Customer”): notify within 72 hours of a Security Incident — does not bind Media Lens via classifier.dev today. |
| Status | `NOT_FOUND` for a classifier.dev customer breach SLA |
| Owner implication | Cannot claim downstream breach notification for Media Lens live traffic without a written term. |

### Provider model disclosure

| Field | Content |
| --- | --- |
| Public claim | Response discloses `model` / `modelsUsed`. Docs describe per-result `model` / `escalated`. README names Jev / jev-1.13 and smart escalation choices, and documents prior silent primary delist. |
| Status | `VERIFIED_PUBLIC_CLAIM` that disclosure fields are documented; `UNVERIFIED` that every live response always names the true ultimate provider under all fallbacks |
| Owner implication | Require the adapter to log/store `model`/`modelsUsed` (not request text) for any future canary. Treat silent fallback as an operational and privacy event. |

### Anonymous vs authenticated processing

| Field | Content |
| --- | --- |
| Public claim | Free classification: no account; per-IP limits; analytics use daily keyed IP hash + label-set fingerprint. Billing identity is never included in classification analytics. Partner key: attributed for limits “and to nothing else.” MCP: stateless. |
| Status | `VERIFIED_PUBLIC_CLAIM` for documented logging design; `UNVERIFIED` operationally |
| Owner implication | Prefer anonymous or Media-Lens-controlled key only after contract. Never put keys or article text in git, logs, or tickets. Anonymous still sends **full input text** to upstream models in flight. |

### Rate limits / SLA (operational, not a privacy gate)

| Field | Content |
| --- | --- |
| Public claim | Free per IP: fast 3,000/min and 20,000/day; smart 200/min and 2,000/day. Pro 10×. **No** uptime SLA (as-is / as-available). |
| Status | `VERIFIED_PUBLIC_CLAIM` for published limits; `NOT_FOUND` for availability SLA |
| Owner implication | Shared free tier is unsuitable as a production dependency without partner/dedicated terms. |

## Product disposition

- The Media Lens classifier.dev adapter stays **evaluation-only** behind `MEDIA_LENS_ENABLE_CLASSIFIER_DEV=true` (exact string).
- The default requested tier is `fast` when `MEDIA_LENS_CLASSIFIER_DEV_TIER` is unset or empty. Smart (the path whose provider docs mention a further reasoning provider) requires the exact value `MEDIA_LENS_CLASSIFIER_DEV_TIER=smart`.
- Do not enable `smart` on any live path until contracts close the TypeSafe / OpenRouter / ultimate-model chain.
- Until owner and contractual verification of privacy, retention, and DPA terms, this feature must not be treated as a release candidate.
- Only **public article** span text is contemplated for any future live use.
- **Private messages, pasted sensitive content, and material the user is not authorized to examine are prohibited.** Live pasted-text remains disabled. Live URL remains disabled.
- Browser-served Media Lens files must not call classifier.dev. Only the local worker may call `POST /v1/classify`.
- Kill switch (`MEDIA_LENS_KILL_SWITCH=true` or kill file) forces **zero** classifier.dev calls, independently of Jev fixture files.

Do not put API keys, raw article text, or Authorization headers in git, logs, tickets, or walkthrough artifacts.

## What would change this disposition

Move from **KEEP_EVALUATION_ONLY** toward **READY_FOR_OWNER_PRIVACY_ACCEPTANCE** only if **all** of the following are evidenced in writing and Independent QA concurs:

- Signed DPA or partner agreement with classifier.dev (or dedicated deployment under Owner’s cloud) covering Article 28-style processor terms.
- Named subprocessor list including TypeSafe, OpenRouter, Cloudflare, and any LLM fallback providers, plus a change-notice process.
- Written no-training (or Owner-accepted training) covering **all** paths Media Lens will call — preferably fast-only with fallback disabled or confined to no-train / ZDR endpoints.
- Written retention: request text not retained beyond transient inference; metadata retention capped; deletion process.
- Residency / transfer terms acceptable to Owner (or dedicated / private inference).
- Breach notification within Owner’s required window, with a contact path.
- Technical attestation or Owner-approved synthetic-only probe plan confirming response `model`/`modelsUsed` and no unexpected smart/fallback under Media Lens config.
- Product constraints remain: public article spans only; private messages on-device; live URL still requires Issue #118 security gates; Owner canary + kill switch + Independent security/QA review.
- User-facing Clarity privacy copy updated **only after** Owner authorization.

Until then: **KEEP_EVALUATION_ONLY**. Live URL remains unauthorized. No production-ready claim. Not an accuracy claim.

## Non-claims

- This note does **not** enable `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` or any live flag.
- This note does **not** authorize live URL, live pasted-text, GitHub Pages hosting of Media Lens, or merge/release of frozen PR #117.
- This note does **not** assert production readiness or real-world accuracy.
- Evaluation harness numbers remain software-consistency checks. See `docs/media-lens-classifier-dev-eval.md`.
- Operator runbook: `docs/media-lens-ops-runbook-v2.md`. Canary drill packet: `docs/media-lens-canary-drill-v1.md` (`DRILL_PACKET_ONLY`; does not grant `READY_FOR_CANARY`).
