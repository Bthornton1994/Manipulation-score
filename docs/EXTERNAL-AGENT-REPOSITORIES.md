# External repository references

This is a review record for the seven repositories named in [RodmanAI's post](https://x.com/RodmanAi/status/2094819727030079933). The post was reviewed on 2026-09-02. It is not an install manifest.

The post's Headroom link uses the historical path `chopratejas/headroom`, which redirects to [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom). The redirected repository is the one pinned below.

## Review rule

- Repository descriptions, default branches, commit pins, and license metadata were checked against the public GitHub repositories.
- A reference is not a dependency. No repository code, model, credential, hosted service, external data source, memory store, trading logic, or UI component is enabled by this record.
- Existing `VISION.md`, safety, privacy, methodology, data, commerce, and release controls remain authoritative.
- Future adoption requires a scoped architecture and license review, explicit owner approval, tests, and fresh verification evidence.

## Source list and disposition

| Source | Pinned revision | License metadata | Disposition |
| --- | --- | --- | --- |
| [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) | [`6e6e56aedb559ccb6e147e25024352b60da28b90`](https://github.com/HKUDS/DeepTutor/commit/6e6e56aedb559ccb6e147e25024352b60da28b90) | Apache-2.0 | Lifelong personalized tutoring and multi-agent research application. Reference only. |
| [volcengine/OpenViking](https://github.com/volcengine/OpenViking) | [`c486088ee7c43c46ba0e6d494e5622086a499aab`](https://github.com/volcengine/OpenViking/commit/c486088ee7c43c46ba0e6d494e5622086a499aab) | AGPL-3.0 | Context database for agent memory, RAG, and skills. Not vendored or connected. |
| [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | [`1390d897155e69f8b4554eed5641c2e523860d0f`](https://github.com/headroomlabs-ai/headroom/commit/1390d897155e69f8b4554eed5641c2e523860d0f) | Apache-2.0 | Local context compression library, proxy, and MCP server. Reference only. |
| [virattt/ai-hedge-fund](https://github.com/virattt/ai-hedge-fund) | [`eff8a7320fcf0b473b135690fa1a5b0d9b022a83`](https://github.com/virattt/ai-hedge-fund/commit/eff8a7320fcf0b473b135690fa1a5b0d9b022a83) | MIT | Educational and research-oriented multi-agent market-analysis proof of concept. Excluded from product behavior. |
| [khoj-ai/khoj](https://github.com/khoj-ai/khoj) | [`ae229ca894c0b80ad84664afcfdde523b5e87057`](https://github.com/khoj-ai/khoj/commit/ae229ca894c0b80ad84664afcfdde523b5e87057) | AGPL-3.0 | Self-hosted second brain with custom agents, research, and automation. Not adopted. |
| [letta-ai/letta](https://github.com/letta-ai/letta) | [`4511fa0bc91f68fbab32b91f694617271ea9012b`](https://github.com/letta-ai/letta/commit/4511fa0bc91f68fbab32b91f694617271ea9012b) | Apache-2.0 | Current repository is a landing page that points to `letta-ai/letta-code`. No persistent-memory runtime is enabled. |
| [open-webui/open-webui](https://github.com/open-webui/open-webui) | [`2a960a59fe1dbbd35282f0556b3666d81102e781`](https://github.com/open-webui/open-webui/commit/2a960a59fe1dbbd35282f0556b3666d81102e781) | Other / NOASSERTION | Self-hosted AI interface. Design reference only; no code or component is copied. |

The source post describes the list as free and open source, but the repository metadata is mixed, including AGPL-3.0 and an unasserted SPDX license. The list is therefore not license approval.

## Current project fit

No adoption. Persistent message context or agent runtimes would change data handling and behavior, while AI Hedge Fund is unrelated. Scoring, methodology, message handling, and safety behavior remain unchanged.

## UI decision

This source is a repository discovery list, not a UI brief. The existing vendored UI skills and previously scoped UI changes remain the applicable interface guidance. No product UI, data flow, scoring, memory, model, or dependency change is justified by this source alone.

## Verification and authority

This file records source review only. It does not authorize installing dependencies, enabling model calls, persisting user context, connecting external services, changing product claims, changing scoring or methodology, merging, deploying, publishing, or taking external actions.


## Printing Press and generated-tool reference

This [X post](https://x.com/exm7777/status/2095256458107773331) was reviewed on 2026-09-03. It presents a workflow for exposing many services through CLIs, using a ready-made CLI where one exists and generating a CLI from a website or API where one does not.

The linked [CLI Printing Press generator](https://github.com/mvanhorn/cli-printing-press) and [published CLI library](https://github.com/mvanhorn/printing-press-library) are reference sources only. Their documented agent-oriented patterns are useful design hypotheses: concise machine-readable output, compact field selection, structured exit codes/errors, dry-run behavior, local/offline data where appropriate, and explicit live/local source selection.

The source post does not provide an end-to-end benchmark proving that CLIs always use a fraction of MCP tokens. Replies correctly identify discovery/help parsing, tool errors, and generated-tool side effects as part of the comparison. Treat that performance claim as unverified until measured on the actual workload.

Disposition:

- No Printing Press binary, generated CLI, MCP server, prompt library, credential, external connector, or website-derived code is enabled by this record.
- Any future adoption requires a capability-specific architecture decision, source and revision pin, license and dependency review, side-effect and secret-flow review, sandboxed read-only smoke test, measured comparison, and existing project approval gates.
- Generated tools remain replaceable implementations. They cannot become product truth, authoritative state, verification authority, or permission to perform external actions.
