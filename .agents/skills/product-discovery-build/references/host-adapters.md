# Cross-repository and cross-host adoption

This skill is the canonical workflow text. A host adapter only makes it discoverable; it does not grant tools, permissions, or approval authority. Verify each host's current documentation and the actual project configuration before claiming the skill is loaded.

## Keep one source and equivalent copies

- Preserve `SKILL.md` and its referenced files together. When copying to a host that does not support references, inline only the needed iOS or host-specific section and label that copy's source version.
- Record the canonical skill version or content hash in the rollout inventory. Compare copied files to the canonical source; do not let local edits silently fork the guidance.
- Do not overwrite a repository's product vision, design authority, security rules, build instructions, or existing agent skills. Add a short pointer in the existing instruction file only when it improves discoverability.
- A portfolio coordinator may route work and report evidence, but the active project repository, its owner decisions, deterministic checks, and release gates remain authoritative.

## Candidate discovery locations

Use these as adapter candidates, not as proof that a particular installed version scans them:

| Host | Candidate location | Adoption note |
|---|---|---|
| Codex | User skill library or repo `.agents/skills/product-discovery-build/` | The user skill can be global to Codex; a repo copy helps workers that only load project files. Avoid duplicate copies in one scope. |
| Claude Code | User skill library or repo `.claude/skills/product-discovery-build/` | Keep any `CLAUDE.md` pointer consistent with the repository's established skill-loading pattern. |
| Cursor | Repo `.cursor/skills/product-discovery-build/` or `.agents/skills/product-discovery-build/` | Check local, cloud, SSH, and self-hosted worker discovery separately. Do not assume a local user skill reaches a remote worker. |
| Grok Build | Project `.grok/skills/product-discovery-build/` or its documented user-skill location | Verify discovery and reference-file behavior in the installed build. |
| Grok Bot | Its saved-skill library, if enabled for the account | Filesystem discovery is not assumed. Save the canonical text through the library and verify invocation behavior. |
| OpenMausBot | No filesystem adapter is assumed | Check the installed build. If no skill importer exists, include the concise workflow contract in the task prompt or existing project instructions. |

Do not rely on an adapter path from memory when host support could have changed. Verify with current host documentation or a harmless discovery test. If a host strips references or metadata, make the smallest equivalent copy and record the difference.

## Rollout to repositories

1. Inventory the current repositories, their governing instruction files, installed skills, active writers, branches/worktrees, and project-specific gates. Do not treat a stale repository list as complete.
2. Select the canonical portfolio policy location and verify it exists on its current branch before editing. Keep the full workflow here; put only a short pointer and applicability rule in shared instructions.
3. Add the skill to existing repositories through each repository's established process. Preserve active sessions and frozen review tips. Use one writer per repository/worktree, and continue independent repositories without duplicating discovery.
4. Update the future-repository template so new projects inherit the pointer or skill copy. Do not retrofit a new design authority into a repo that already has one.
5. Run inexpensive local validation first. Do not trigger hosted CI, push, open or update PRs, or change permissions unless the owner has authorized that rollout step or a repository's explicit gate requires it.
6. Track each repo and host separately as **NOT STARTED**, **IN PROGRESS**, **VERIFIED**, **BLOCKED**, or **NOT APPLICABLE**. Include the branch/SHA, path, source skill version/hash, loader evidence, relevant checks, and unresolved differences. Do not say "all repositories and hosts" until every inventoried target has a verified disposition.

## Minimal project pointer

Adapt this text to the repository's instruction style:

> For new products and substantial user-facing work, use the `product-discovery-build` workflow. Read the canonical or repository-local skill before implementation. Follow this repository's vision, design authority, architecture, privacy, security, and release gates; the workflow does not override them. For narrow maintenance work, use the smallest relevant parts. If the skill is unavailable, use the task's explicit research, design, acceptance, and verification brief and report the missing adapter.
