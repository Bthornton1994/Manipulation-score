# Media Lens story workspace

Date: 2026-09-21 UTC. Draft product note for the fixture-first Media Lens workspace. This does not enable live analysis, change release flags, or close Issue #118. Updated 2026-09-25: "Fixture versus live" and "Still blocked" now describe the host-mode behavior of the release.

## What this follows

- `docs/media-lens-build-brief.md` for Media Lens, the influence graph, and the Newsjack boundary.
- `VISION.md` for the company safety boundary: analyze communication, not identity; evidence before a score; visible uncertainty; privacy by default; misuse resistance.
- The owner direction for a public media-intelligence workspace, with Clarity kept as the separate private message product.

A company blueprint file named `ManipulationScore_Build_Blueprint.md` was not in the git checkout. The 2026-09-22 remediation reviewed the uploaded copy `ManipulationScore_Build_Blueprint_211d.md` (Version 1.0, July 24, 2026). Conformity against that file is reported below and in the PR #143 body. It is not a claim that this draft implements the blueprint's M-Score product. Non-claims that still bind this page come from `VISION.md` and the in-repo Media Lens brief: no overall 0–100 manipulation score, no outlet or person ranking, and no rhetoric-to-factuality claim.

## Ground News is a category reference only

Useful information architecture, translated into Media Lens language. A 2026-09-22 pass looked at the public category patterns on ground.news and one unsigned story page. Those pages are not a source of branding, copy, logos, chart chrome, or ratings.

| Category pattern | Media Lens translation |
| --- | --- |
| Topic lanes and interests | Fixture lanes on this page: All fixtures, Quoted language, Syndicated cluster, Coverage gap. A lane filters examples. It is not saved and does not follow live coverage. |
| Story card with a coverage count and a compact distribution mark | Fixture card shows the recorded cluster count, the independent-source estimate, the syndicated-or-duplicate estimate, and the frame count when the golden graph has them. The mark is a two-part count meter. The estimate is labeled as an estimate, not a list of outlets. Stories with no cluster say the count is absent. |
| Summary and metadata separate from the source list | Recorded opening and retrieval metadata stay above the related-source list. |
| Comparison control | All recorded, Independent reporting, Syndicated repetition, Same story. These filter recorded cluster members and appear only when a cluster is recorded (local fixtures today). The Represented frames control was removed on 2026-09-25 because the owner deferred frame generation. Independent reporting lists only members named in recorded story-origin evidence (`evidence_urls`, `timestamp_evidence` URL keys, and a canonical URL whose basis is `first_independent_report`) after excluding syndicated relations and recorded wire, press-release, or partner-republication URLs. A `same_story` relation is not treated as independent reporting. The numeric `independent_sources_estimate` stays a separate estimate. |
| Distribution with counts | Relation mix plus the independent-source estimate and the syndicated-or-duplicate estimate. No frame records exist, so the page says "No coverage-frame comparison was available for this analysis." |
| A card for absence of coverage | Coverage gap copy on the card and in the workspace. An omission candidate stays a candidate. Absence is not proof a fact was left out. |
| Update time and a feedback affordance | The workspace shows the fixture graph timestamp and says it is not a live update. "Question this reading" reveals that this preview does not send feedback or store a correction, repeats that sentence in the limitations section, then moves focus there. |

Not used: Left/Center/Right labels, outlet bias or factuality rankings, ownership ratings, Ground News wording, and copied chart or card chrome.

Earlier mapping that still holds:

| Category pattern | Media Lens region |
| --- | --- |
| Story page | Headline, recorded opening, source and retrieval metadata |
| Same-story coverage | Related-source cluster, independent reporting, syndicated repetition |
| What is missing | Omission candidates, empty when no candidate was recorded |
| How it is told | Language observations tied to spans; represented frames when a frame record exists |
| Whether a statement holds | Claim ledger with support status |
| Who published it | Source context, kept separate from influence language |

## Independent reporting versus the estimate

The Independent reporting control does not rewrite the graph. It does not treat `same_story` as proof of independent reporting, and it does not turn `independent_sources_estimate` into a list of outlets.

A member is listed only when its recorded `url` or `url_key` is already named by story-origin evidence, and the recorded relation is not `syndicated`, and the recorded URL is not identified as wire, press-release, or partner republication. Those URL markers are the same exclusion list `media-lens/worker/fusion.js` already uses when it computes the estimate. The page uses them only to drop a recorded URL. It does not add a provenance field.

On `synthetic-02-syndicated-cluster`, that list is Fictional Daily and Second Outlet. PR Newswire stays off the list even if its URL is copied into `evidence_urls`, because the recorded URL identifies a wire release. If story-origin evidence names nobody, the list stays empty even when the estimate is greater than zero.

Lane buttons are rebuilt in the DOM when a lane is activated. If focus was on the activated button, focus returns to the replacement button with the same `data-lane`. Focus outside the lane group is left alone.

## Blueprint conformity

Reviewed file: uploaded `ManipulationScore_Build_Blueprint_211d.md`, not a committed repo path. This note does not claim the blueprint and `VISION.md` are the same document.

Satisfied by this draft, with the evidence in the Media Lens page and tests:

- Section 3.4 non-claims that overlap the Media Lens boundary: the page does not diagnose a person, rank an outlet, or treat claim support as checked. Candidate language stays "Possible influence signal".
- Section 10.4 political neutrality, as applied to this page: fixture rules do not vary by speaker, party, or ideology, and the UI has no Left/Center/Right taxonomy.
- Section 11.3 items that this page can meet without a new engine: coverage members are not invented; empty frames and missing evidence stay empty; the independent list requires recorded story-origin evidence.
- Section 14.4 avoided wording: the page does not use "proved", person-diagnosis labels, or a lie probability. Coverage-gap copy says an absence is not proof a fact was left out.
- Section 19.1 artifact-not-character rule, for this UI: the Influence Profile restates section states and is not a person or outlet score.
- Section 13.6 keyboard operation, for the fixture lanes only: activating a lane keeps focus on that lane button. Counts are written in text, not color alone. A full WCAG 2.2 AA audit was not run.

Mismatches, stated rather than implemented:

- Sections 1, 2.2, 2.3, and 8 require an M-Score from 0 to 100, risk bands, and a Manipulation Fingerprint. This draft does not add them. `VISION.md` and `docs/media-lens-build-brief.md` forbid an overall manipulation score.
- Section 7.4's report order includes dimension scores, a verification block, and an autonomy-preserving rewrite. This workspace has a summary, evidence-linked observations, limitations, and an Influence Profile. It does not have those scorecard sections.
- Section 7.5's public artifact registry and entity profiles are not built.
- Section 11.4's `AnalysisReport` contract is not `influence-graph.v1`, which is what this page renders.
- Section 14.2's starter palette is not the palette this page uses.
- Section 10.4's tactic list (polarization, scapegoating, narrative laundering, and the rest) is not a rendered taxonomy here.
- Sections 19.1 and 19.6 describe a correction and appeal process. "Question this reading" only says this preview does not send feedback or store a correction.

Not verifiable from this repo state:

- WCAG 2.2 AA contrast, a full accessibility audit, and Core Web Vitals.
- Legal review, funding disclosures, a published nonpartisanship policy, or reviewer conflicts.
- The validation study, human review, and appeals process in section 18.
- Whether the uploaded blueprint matches any later owner revision. It is not committed in this checkout.

## Fixture versus live

Local preview (`localhost`, `127.0.0.1`, `[::1]`, or `file:`) keeps the labeled fixture story explorer, the fixture workspace, and `#story=` deep links for development. Counts, distributions, and provenance there are fixture records, not live facts. The page says so in the catalog, the sample card, and the workspace badge. Opening a fixture there requests only a same-origin file, `./fixtures/expected/<fixture-id>.graph.json`, from the local static server. It does not call TypeSafe, classifier.dev, or a news cluster API.

On any other host, including the operator host ml-jev, the fixture story explorer and workspace are hidden, `#story=` deep links do nothing, and the page requests no fixture files. The operator host would return 404 for them in any case, because its Caddy site serves only the three UI files and shared assets. The static sample card stays on every host and is labeled as a made-up example.

Story discovery is the section above the article URL form. On this host it says discovery is not live and that analyzing one article URL does not discover stories or compare outlet coverage. The URL form under it is still single-page analysis. A Coverage context section says coverage comparison is not live because no approved source exists for finding other reports of the same story. Live results show one plain coverage statement instead of empty comparison controls. A result that contains only abstentions says "No analysis was run". Consent is a dialog after Analyze and is asked again for each analysis. URLs that contain a username or password are rejected in the browser, and the worker also rejects them. On ml-jev, Jev-only live URL analysis is on for the operator allowlist (owner activation 2026-09-21 PT, Issue #118). This note does not change any flag.

## Still blocked

Real story discovery, same-story clustering, and cross-outlet coverage comparison are not live. The worker can read allowlisted RSS or Atom feeds only when `MEDIA_LENS_ENABLE_STORY_DISCOVERY` is the exact value true and the source registry marks that feed approved. No feed is approved. Every named candidate stays `candidate_pending_owner_approval` and is not fetched. Fixture discovery is labeled and is refused by a live-mode worker. The worker reads no Newsjack output, and no Newsjack binary is approved for ml-jev. Article URL analysis does not discover stories or compare outlet coverage. Owner decisions: `docs/media-lens-story-discovery-owner-decisions.md`. A cluster member is labeled `independent_reporting` only when the feed supplies `mediaLens:originEvidence=first_independent_report`. That tag exists in fixture XML only. It is not a separate evidence store.

Also not built: frame generation and side-by-side coverage (deferred by the owner until a real backend contract exists), claim support other than "not checked", and omission findings that were not already recorded. Person or outlet ratings are out of scope under `VISION.md`. This note does not authorize that work.
