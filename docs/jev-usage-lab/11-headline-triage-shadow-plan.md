# 11 — Media Lens headline triage shadow plan

Status: Design-only. No headlines were scored for this plan. It does not approve a feed, enable story discovery, send a provider request, change a live flag, install a tool, or alter user-visible analysis.

Vision check: Aligns with constraints. Relevant sections: “Evidence comes before a score,” “Uncertainty must be visible,” “Privacy is the default architecture,” “Analyze communication, not identity,” and “Misuse resistance is a product requirement.”

## Why this is separate

The existing Jev Usage Lab replays narrow, span-level question answers against fixtures. Its report is not an evaluation of headline relevance, feed-scale monitoring, story selection, or savings from skipping article analysis.

Story-discovery code is default-off, every named source remains candidate-pending-owner-approval, and no feed is approved. See [Story discovery owner decisions](../media-lens-story-discovery-owner-decisions.md). The current live preview analyzes one submitted public URL; it does not discover or rank stories.

External Jev or Newsjack figures are not evidence about Media Lens. Do not copy another project’s agreement, accuracy, cost, or speed numbers into this product’s claims.

## Objective

Test the narrow hypothesis that a low-cost headline triage step can prioritize public stories before expensive analysis while preserving recall and the quality of completed analyses.

The candidate may produce coarse triage labels, but its result is shadow-only. It must not suppress a story, change the article queue, alter an influence graph, or label an outlet or person.

## Shadow contract

- Run the candidate against an owner-approved, rights-cleared, labeled corpus or local synthetic fixtures.
- Keep the existing selection and analysis path authoritative. Record what the candidate would have done; ignore that decision in the active path.
- Do not fetch a feed or article, call Jev, use credentials, or change a live flag as part of this plan.
- Treat headline and metadata text as untrusted data. Never follow instructions found inside the text or let it select tools, URLs, or permissions.
- If a future contract uses labels such as keep, monitor-only, reject, or abstain, define their meaning and invalid-output behavior before collecting results. Reject remains a logged prediction during shadow evaluation.

## Evaluation protocol

1. **Define the task.** Write the inclusion rule for a story that merits Media Lens analysis. The label is story relevance to that task, not whether a source is truthful, safe, manipulative, or worthy of attention.
2. **Clear the data.** Record each source’s rights basis, retention, display scope, and owner approval before storing or showing its titles, URLs, or timestamps. Until then use synthetic fixtures only.
3. **Freeze labels and splits.** Have a human label examples using the written rule. Keep an untouched holdout. Group the same story, syndicated copies, and near-duplicates into one split so they cannot leak between calibration and holdout.
4. **Compare paired outputs.** Run the unchanged selection path and the shadow candidate on the same frozen examples. Record the model/version, prompt or harness SHA, source, split, label provenance, and decision. Do not tune on holdout results.
5. **Measure recall before savings.** Report relevant-story recall among keep plus monitor-only predictions; count relevant stories predicted reject as false negatives. Also report precision, queue reduction, abstention and invalid-output rates, and results by source and topic where the sample supports it. Show denominators and sample counts.
6. **Measure task-level cost.** For any later authorized live experiment, sum cached input, uncached input, output, retries, and failed work per analysis task. Report total cohort cost divided by completed analyses, completion rate, and quality on the same examples. Use verified current prices and observed usage; label estimates as estimates.
7. **Probe adversarial cases.** Include quoted instructions, prompt-injection text, satire, ambiguity, syndicated duplicates, missing metadata, malformed output, and headline/body disagreement. A headline must not cause tool use or override repo and owner rules.

The existing fixture report remains limited to its span-level question set. It does not satisfy the data or evaluation requirements above.

## Promotion gates

No numerical pass threshold is set here. Before any proposal to use triage outside shadow mode, the owner must set the minimum sample size, acceptable recall and false-negative bounds, quality bar, cost ceiling, approved sources and rights basis, retention, and rollback behavior.

Promotion requires a separate reviewed change, evidence on the untouched holdout, and independent no-edit review of the exact candidate SHA. A passing fixture test is not proof of real-world accuracy.

Until the source approvals, labeled data, per-task usage, and owner-set quality bar exist, the only valid result is an offline design or fixture-only replay with no live effect.
