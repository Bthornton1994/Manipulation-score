# classifier.dev privacy disposition (evaluation-only)

Status: **evaluation-only**. `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` remains **off by default**. This note does not enable live URL, live pasted-text, GitHub Pages hosting of Media Lens, or a production-ready claim. Related to [Issue #118](https://github.com/Bthornton1994/Manipulation-score/issues/118); it does **not** close that issue.

Vision check: **Aligns with constraints** (`VISION.md` “Privacy is the default architecture”, “Uncertainty must be visible”, “Analyze communication, not identity”). Private messages stay on Clarity’s on-device path. classifier.dev is not a browser-side caller.

## Public provider claims (UNVERIFIED)

The following are claims from public classifier.dev documentation, treated as **UNVERIFIED** until an owner plus contractual review says otherwise. They are not guarantees and are not copied into user-facing Clarity privacy copy.

| Claim (provider docs) | Disposition |
| --- | --- |
| Texts and labels are forwarded to TypeSafe (fast / Jev) and, for smart re-asks, an OpenRouter-routed reasoning provider | UNVERIFIED as a data-processing map for Media Lens |
| classifier.dev does not write classification texts to disk | UNVERIFIED |
| Only operational metadata is stored (tier/model/latency/status and similar) for 90 days | UNVERIFIED |
| Request text and labels are not stored in analytics | UNVERIFIED |
| Caller IP is used in-flight for rate limiting and not written down | UNVERIFIED |
| No contractual retention, deletion, residency, or no-training terms for TypeSafe, OpenRouter, or the ultimate reasoning-model provider were reviewed for this product | UNVERIFIED / not established |

“Not stored by classifier.dev” does **not** establish “not retained or used for training by upstream providers.”

## Product disposition

- The Media Lens classifier.dev adapter stays **evaluation-only** behind `MEDIA_LENS_ENABLE_CLASSIFIER_DEV=true` (exact string).
- Until owner and contractual verification of privacy, retention, and DPA terms, this feature must not be treated as a release candidate.
- Only **public article** span text is contemplated for any future live use.
- **Private messages, pasted sensitive content, and material the user is not authorized to examine are prohibited.** Live pasted-text remains disabled. Live URL remains disabled.
- Browser-served Media Lens files must not call classifier.dev. Only the local worker may call `POST /v1/classify`.
- Kill switch (`MEDIA_LENS_KILL_SWITCH=true` or kill file) forces **zero** classifier.dev calls, independently of Jev fixture files.

Do not put API keys, raw article text, or Authorization headers in git, logs, tickets, or walkthrough artifacts.
