# Media Lens story workspace

Date: 2026-09-21 UTC. Draft product note for the fixture-first Media Lens workspace. This does not enable live analysis, change release flags, or close Issue #118.

## What this follows

- `docs/media-lens-build-brief.md` for Media Lens, the influence graph, and the Newsjack boundary.
- `VISION.md` for the company safety boundary: analyze communication, not identity; evidence before a score; visible uncertainty; privacy by default; misuse resistance.
- The owner direction for a public media-intelligence workspace, with Clarity kept as the separate private message product.

A company blueprint file named `ManipulationScore_Build_Blueprint.md` was named in the task and was not present in this checkout. Non-claims below are taken from `VISION.md` and the in-repo Media Lens brief. No overall 0–100 manipulation score. No outlet or person ranking. No rhetoric-to-factuality claim.

## Ground News is a category reference only

Useful information architecture, translated into Media Lens language. A 2026-09-22 pass looked at the public category patterns on ground.news and one unsigned story page. Those pages are not a source of branding, copy, logos, chart chrome, or ratings.

| Category pattern | Media Lens translation |
| --- | --- |
| Topic lanes and interests | Fixture lanes on this page: All fixtures, Quoted language, Syndicated cluster, Coverage gap. A lane filters examples. It is not saved and does not follow live coverage. |
| Story card with a coverage count and a compact distribution mark | Fixture card shows the recorded cluster count, independent and syndicated counts, and frame count when the golden graph has them. The mark is a two-part count meter. Stories with no cluster say the count is absent. |
| Summary and metadata separate from the source list | Recorded opening and retrieval metadata stay above the related-source list. |
| Comparison control | All recorded, Independent reporting, Syndicated repetition, Same story, Represented frames. The control filters the loaded fixture cluster. |
| Distribution with counts | Relation mix plus independent-source concentration and a represented-frame count. Empty frames stay empty. |
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

## Fixture versus live

Home story search and the story workspace read labeled in-repo fixtures. Counts, distributions, and provenance in those workspaces are fixture records, not live facts. The page says so in the catalog, the sample card, and the workspace badge.

Opening a fixture requests only a same-origin file: `./fixtures/expected/<fixture-id>.graph.json`. It does not call TypeSafe, classifier.dev, ml-jev, or a news cluster API.

Article URL analysis stays a separate entry. Consent, URL checks, and the Jev-only experimental disclosure are unchanged. Live URL remains off unless an operator host already enables it. This PR does not enable it.

## Still blocked

Live story discovery, topic search over real coverage, Newsjack CLI or news-search, canonical-source resolution beyond a fixture or supplied artifact, frame comparison when `coverage.frames` is empty, claim support other than "not checked", omission findings that were not already recorded, and any person or outlet rating. Those wait on Newsjack, backend, data, and owner authorization. This note does not authorize that work.
