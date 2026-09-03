---
name: agent-native-tooling
description: Evaluates CLI, MCP, API connector, generated adapter, and agent-skill choices using end-to-end measurement, least privilege, provenance, and replaceable contracts. Use when adding or reviewing agent tooling or external integrations.
---

# Agent-native tooling

## Purpose

Use this skill when a task involves a CLI, MCP server, API connector, generated tool, external integration, or agent skill. The goal is reliable task completion with controlled authority, not the largest possible tool catalog.

The Printing Press source presents CLIs as a way to expose narrow, token-efficient, agent-oriented interfaces. Its repository documents useful patterns such as concise machine-readable output, compact field selection, typed exit codes, dry runs, local mirrors, and explicit data-source choices. These are design hypotheses to validate in our workload, not guaranteed outcomes.

## Devil's-advocate test

Before choosing CLI over MCP, or a generated adapter over a native integration, answer:

1. What exact capability does the task need?
2. What is the total cost from discovery through successful completion, including help lookup, argument construction, parsing, retries, and recovery?
3. What error does the agent receive when the call fails, and can it self-correct without scraping prose?
4. What network, filesystem, subprocess, credential, and remote-state effects are possible?
5. Can the capability be read-only, task-scoped, dry-run, or disposable?
6. What evidence would show that it improves outcome quality, latency, reliability, or context use?
7. Can the implementation be replaced without changing the product contract or invalidating historical evidence?

If these answers are unknown, record the proposal as unverified and keep it out of the default path.

## Capability contract

For an approved adapter:

- define a typed, repository-owned request and response contract;
- expose only the operations needed for the workstream;
- default to read-only and least privilege;
- return stable machine-readable output and structured errors;
- provide deterministic pagination, timeouts, retries, and idempotent read behavior;
- expose freshness and source selection when local or cached data is involved;
- support preview or dry-run for mutations;
- record source revision, tool version, inputs, outputs, and relevant hashes in the existing provenance/evidence system;
- keep credentials out of prompts, skills, executor profiles, logs, and artifacts;
- make removal or replacement a compatibility exercise, not a product rewrite.

## Generated-tool review

A generated CLI or MCP server must pass a separate review before use:

- inspect the exact source revision and license;
- review generated code and dependencies;
- enumerate domains, URLs, headers, environment variables, file writes, subprocesses, shell execution, and remote mutations;
- test malformed input, auth failure, rate limiting, pagination, partial failure, and retries;
- run a minimal read-only smoke test in a disposable environment;
- verify that untrusted API or website content cannot become instructions;
- pin the accepted revision and record why it is allowed;
- reject it if the generated surface is broader than the task or its side effects cannot be bounded.

Do not pipe arbitrary website text into a generator and treat the result as trusted. A generated tool can reduce interface friction while increasing supply-chain and attack-surface risk.

## Measurement

For a representative task set, compare the alternatives using the same task and starting context. Record:

- successful completion rate;
- tool-call count and failed-call count;
- discovery/help tokens and total context/tool tokens;
- wall-clock latency;
- retries and recovery turns;
- incorrect or dangerous action attempts;
- human intervention rate;
- maintenance and dependency cost.

The post's claim that a CLI can use a fraction of the tokens is not established for our repositories. Do not promote that claim into product copy or an architecture decision without measurements.

## Repository application

### Grounded

Limit candidate tooling to read-only supplier/catalog research and local fixture inspection. It must not create inventory, alter catalog truth, contact suppliers, purchase, publish, or enable checkout. Production remains fail-closed when verification data is absent.

### Virtual Assistant

Use adapters behind Delegation Cloud-owned capability contracts. Tool output is evidence, not authoritative state. Keep executor authority envelopes, approvals, receipts, and lifecycle transitions in the platform. No generated CLI or MCP server may silently send, purchase, publish, alter access, or claim completion.

### CareReserve

Keep tooling synthetic or pilot-scoped. Do not connect real public-program data, family/provider records, payments, eligibility decisions, ranking, fraud decisions, or benefits movement. Any future read-only integration requires a separate privacy, RLS, data-authority, and pilot review.

### Manipulation Score

Under the current HOLD/PAUSE posture, do not add runtime tooling, generated adapters, external data, scoring changes, or methodology changes. This skill remains review guidance unless an explicitly approved read-only analysis path is opened.

## Verification checklist

- [ ] The capability and authority boundary are explicit.
- [ ] CLI/MCP/embedded implementation alternatives were compared.
- [ ] End-to-end cost and outcome claims are measured or labeled unverified.
- [ ] Source revision, license, dependencies, and side effects were reviewed.
- [ ] Read-only, dry-run, approval, and audit behavior are present where applicable.
- [ ] Untrusted content cannot grant authority.
- [ ] Existing project vision, privacy, safety, and release gates still pass.
- [ ] No merge, deployment, credential, or external action was inferred from this skill.

## Sources

- [X post and visible replies](https://x.com/exm7777/status/2095256458107773331)
- [CLI Printing Press](https://github.com/mvanhorn/cli-printing-press)
- [Printing Press Library](https://github.com/mvanhorn/printing-press-library)
