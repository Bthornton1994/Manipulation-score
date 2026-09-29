---
name: test-audit
description: Evaluate test value when adding, changing, reviewing, or auditing tests. Use for regression-test design, test-related code review, and focused searches for redundant or brittle tests. Keep broad cleanup bounded and separate from unrelated implementation work.
---

# Test Audit

Protect important behavior with tests that catch credible failures while keeping the suite understandable and maintainable. Optimize for confidence and useful feedback, not test count, coverage percentage, or lines deleted.

This skill reviews the value and design of tests. It does not replace independent QA, security review, release approval, production-readiness review, or project-specific owner gates. Follow the repository's instructions and the user's authorization. This skill never grants permission to merge, undraft, deploy, spend, contact third parties, or bypass an owner gate.

## Choose a mode

- **Authoring mode:** Use when adding or changing a test, or reviewing a test change.
- **Audit mode:** Use when asked to find low-value, duplicated, brittle, or implementation-coupled tests. Start read-only and report evidence before editing.
- **Do not start a broad cleanup by default.** If the current task is a feature or bug fix, focus on tests needed for that change. Propose a separate bounded audit only when there is clear evidence it would help.

## Authoring mode

Before adding or materially changing a test, answer these questions in the task notes or review:

1. **Behavior:** What observable behavior, invariant, or independent contract does the test protect?
2. **Failure:** What credible defect or regression should make it fail?
3. **Distinct value:** Why would existing tests not catch that failure? Extend a table-driven case or shared fixture when that gives clear coverage without obscuring intent.
4. **Boundary:** Does the test exercise the owning public or internal boundary? Does it require a production export, flag, wrapper, global, or injection hook used only by tests? Prefer testing through the real boundary. Add a seam only when it has a production need or is the clearest safe way to verify an otherwise inaccessible contract.

Make these judgments yourself from the code and repository guidance. Do not pause routine implementation to ask the user to answer them. If no meaningful behavior or failure mode can be named, omit the test or revise the test plan.

For a bug-regression test, demonstrate that it fails on the pre-fix behavior for the intended reason and passes after the fix. Use an isolated worktree, a baseline commit, or another repository-approved method. Do not reset or rewrite a shared checkout to manufacture a failing result. If a pre-fix failure cannot be demonstrated, say so and do not claim the test proves that regression is caught.

Prefer behavior-based assertions. A test that breaks under a behavior-preserving refactor is a candidate for redesign, but that alone does not prove it should be deleted: it may protect an independent source, protocol, or architecture contract.

## Audit mode

### Discovery

1. Read applicable repository guidance and identify the requested scope, current branch and SHA, relevant running work, and test commands before making changes.
2. Keep discovery read-only. Inspect each candidate test, its production owner and entry point, non-test callers, relevant sibling tests, CI routing, and history when available. Inspect dependency types or implementation when the test depends on a specific dependency behavior.
3. Prefer a small number of high-confidence candidates. Treat these as investigation signals, not automatic deletion reasons:
   - tests with no meaningful assertions;
   - self-comparisons or identity checks that prove no useful contract;
   - copied inventories, fixtures, or export lists that merely mirror production source;
   - source-string or import greps that duplicate stronger executable behavior checks;
   - private helper tests duplicated at a meaningful owner boundary;
   - repeated checks of the same contract;
   - production seams or code whose only callers are tests.
4. For broad repositories, split read-only discovery into non-overlapping areas when useful. Never create overlapping writers. Protect active sessions; do not cancel, redirect, or edit their files. Continue safe work in other areas while tests or independent QA run.

### Retention and deletion evidence

Keep tests that independently protect a public API, protocol, configuration, migration, storage, authorization, security, platform, default, serialization, release, or architecture contract. Keep credible regression tests and call-order tests when order is observable behavior. Static or slow tests can still provide valuable independent protection.

Before deleting a test or test-only seam, record for that candidate:

- exact test name and location;
- the failure or contract it currently detects;
- non-test callers of the covered production or support code;
- stronger remaining proof for the same behavior, or why no proof is needed;
- relevant history or evidence explaining why the test or seam exists;
- what test-support or production complexity deletion would remove;
- the risk and focused validation command.

If any field is unknown, investigate or retain the candidate. Do not delete based only on coverage percentages, runtime, test count, similarity in names, or a model's confidence. Do not preserve a redundant test merely to keep a metric high. Never use a deletion target or net-negative LOC as a success criterion.

Do not change production behavior solely to make tests easier to write or to reduce test count. Remove a production seam only after confirming its callers and contract, and only when that change is within the authorized scope. Keep test-suite cleanup in a separate coherent change from unrelated features, bug fixes, or security remediations. A regression test that belongs with its bug fix is part of that fix.

## Validation

1. Use the repository's documented test commands and required checks. Do not assume a language, test runner, or script from another project.
2. Run the smallest relevant owner and sibling tests first, followed by the required repository gate for the changed paths.
3. Respect shared-checkout safety. Do not edit tests or source while a test process is running against those files in the same checkout. Use an approved isolated worktree for concurrent work; otherwise wait for that process before editing.
4. For deleted source assertions or plan checks, run the executable command or workflow that owns the real contract.
5. Inspect the final diff and report production code, tests, and test-support changes separately. Confirm the exact tested SHA. A pass on an earlier SHA does not verify the current tip.
6. If repository policy requires independent QA, keep it independent of the implementer and bind its result to the exact final SHA. A self-review must be labeled as such.
7. Report skipped, failed, flaky, or unavailable checks plainly. Do not turn a passing test suite into a claim of complete product, security, visual, or production readiness.

## Handoff

Summarize:

- mode and scope;
- behavior or contract protected, or candidate categories removed and why;
- relevant tests and commands actually run, including failures or limitations;
- exact SHA verified;
- production, test, and test-support changes separately;
- remaining risks, independent-QA status, and bounded follow-up work.

Keep the handoff factual. Distinguish observed evidence from inference and do not claim proof that was not run.
