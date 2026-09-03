# External agent skills

This file records the external agent skills intentionally available in this repository. It is a repo-local quality layer. It does not grant an agent authority to merge, deploy, publish, send messages, purchase goods, change permissions, write production data, or override this repository's governing documents.

The linked @Av1dlive source post recommends a Grok Bot and Cursor Cloud Agent workflow with reusable engineering, UI, review, and research skills. The X page was not directly readable in this environment, so the source list was checked against the linked primary repositories and their pinned commits.

## Adopted skills

| Skill | Pinned source | Use in this repository |
| --- | --- | --- |
| `frontend-ui-engineering` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) at `d2c37ef6225dd8726cdd369a8030307f48592d26` | Accessible, responsive, production-quality UI implementation using the existing stack |
| `source-driven-development` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) at `d2c37ef6225dd8726cdd369a8030307f48592d26` | Verify framework-specific decisions against current official documentation |
| `no-ai-slop` | [petergyang/no-ai-slop](https://github.com/petergyang/no-ai-slop) at `d30eddb9e04562234f2070b5ee63ca4649d9a05e` | Keep visible copy direct, specific, truthful, and consistent with the product voice |
| `no-ai-design-slop` | [MengTo/Skills](https://github.com/MengTo/Skills) at `321c769739b823de5eb94eb3a52aa1974fe783a2` | Use a removal-first, product-specific review for UI surfaces and responsive states |
| `verification-before-completion` | [obra/superpowers](https://github.com/obra/superpowers) at `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` | Require fresh evidence before claiming a fix, passing check, completion, commit, or PR |

## Operating order

1. Read this repository's `AGENTS.md`, `VISION.md`, design documentation, and product-specific safety or release files before changing code.
2. For UI changes, use `frontend-ui-engineering` with the existing Emil, Jakub, Leon, and ibelick guidance. Preserve local tokens, primitives, density, and product identity.
3. For visible copy, use `no-ai-slop` and preserve every supported claim. Do not add metrics, testimonials, partners, outcomes, or other proof that the repository cannot verify.
4. For UI audits, use `no-ai-design-slop` to remove or correct the highest-impact supported problem. Do not replace the product with a generic visual system.
5. For framework-specific code, use `source-driven-development` and cite the official documentation in the implementation record or handoff.
6. Before a completion claim or PR update, use `verification-before-completion`: identify the proving command, run it, read the result, and report any pending or failed check plainly.

## Explicit exclusions

- `humanizer` and Cursor's `unslop` are not duplicated because `no-ai-slop` covers the same copy-quality role in a smaller repo-local package.
- Other `agent-skills` packages are not copied wholesale. Only the UI and source-verification skills directly apply to this work.
- `constraint-driven-development` is not activated as a new numeric quality contract because existing repository guidance and CI already define project-specific boundaries and checks. No new threshold is invented here.
- `emilkowalski/skills` is already present in the repository from the earlier UI skills pass, so it is not duplicated.
- `cartographer` depends on its plugin scanner and a Sonnet subagent orchestration model, so it is not presented as a universally available repo-local command.
- The remaining `superpowers` skills are workflow-specific and are not needed for this bounded UI and verification pass.
- `gstack` is a harness package with local CLI, browser, and Codex assumptions. It is not copied into product repositories.
- `impeccable` is a larger CLI and skill system that overlaps the existing UI stack. It is not introduced as a second design authority.
- `last30days` is external research tooling with optional API credentials. It is not a product-code dependency.
- The exact public repository path for the post's `mattpocockuk/skills` reference was not resolved during this audit, so it is not vendored.

## Boundaries

Existing project instructions, product vision, privacy, safety, data, security, tenant-isolation, methodology, and release controls remain authoritative. This file and the vendored skills are reference material for agents. They do not authorize autonomous execution, production access, external communication, commerce, supplier activity, publication, merging, or deployment.

## Linked agent repository references

The repository discovery list in `docs/EXTERNAL-AGENT-REPOSITORIES.md` is reference material only. The listed systems are not Agent Skills and are not vendored or runtime dependencies. The selected repo-local skills remain the only newly loaded agent guidance from this source review.
