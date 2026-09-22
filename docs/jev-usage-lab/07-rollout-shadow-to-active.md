# 07 — Rollout from shadow to active

This document is a gate list. It does not flip a flag, merge, deploy, or close Issue #118. Jev does not authorize any step below.

## Current step

Shadow replay and `/analyze` observation, both default off, zero extra TypeSafe calls. The narrow question set is not sent on `/analyze`.

Production live Jev remains behind `MEDIA_LENS_MODE=live` and `MEDIA_LENS_ENABLE_LIVE=true`, which this change does not set. Live URL and live pasted text stay off.

## What “active” would mean later

Active means a human-approved path where a typed answer can change an evidence-linked UI state. It does not mean Jev writes the graph’s claim support, a score, or a rank.

| Proposed answer | Could become active only if | Must stay shadow or hold |
| --- | --- | --- |
| Quotation vs authorial recommendation | The UI shows the existing quoted/authorial phrase and a reviewer can see the span id | Setting role to `quoted` from the model |
| Loaded language or false dilemma at candidate strength | The state id matches an allowed phrase and strength stays the code threshold | Model-chosen “observed” |
| `important_context_missing` / `should_abstain` | They remove a signal instead of adding one | Using them to invent missing facts |
| Claim `supported` / `contradicted` / `mixed` | Never from Jev alone | Always `hold_for_human` |
| Source independence | Two source ids already in provenance, strength candidate, no outlet name as a judgment | Any rank or “unsafe source” label |
| CoS `route` | A person accepts a reversible in-repo step that does not need Bryant’s approval | Merge, deploy, spend, credentials, live flags, irreversible writes |

## Gates before any active use

1. Independent QA is seated. This contract decides future UI and abstention behavior even though the default path is unchanged.
2. Bryant Thornton approves the question-set version in writing. The model cannot supply that approval.
3. Holdout stays untouched. Records that share an article id and span id stay in one split, and the span-abstain gate does not run on a mixed calibration/holdout set. Any threshold change is a new contract version, fit only on a calibration split that is not the holdout, and still not described as real-world accuracy.
4. Provenance test stays green: article id, source id, and span id on every answer; no full text in the log.
5. Cross-span batching stays off unless a response field carries the span id. The current TypeSafe body does not.
6. Kill switch, 160-call cap, 8 s attempt timeout, and 15 s analysis timeout stay in force on any path that can reach the network.
7. `claim_support_applied` and `role_write_authorized` stay false until a separate reviewed change. That change is not this one.
8. No live flag, Caddy change, or credential lands in the same change as the first active mapping.

## Rollback

Shadow rollback is unsetting `MEDIA_LENS_JEV_SHADOW`. `analyze()` does not read the flag. `server.js` schedules shadow only when `config.jevShadow.enabled` is true, and only after the production JSON is sent.

Rollback is to stop that schedule, not to edit fusion thresholds in place. Partial Jev results must still abstain the way `analyze.js` already does on cap and timeout.

## Not in this rollout

- Closing Issue #118.
- Enabling classifier.dev, live URL, or live pasted text.
- Treating fixture F1 as a launch metric.
- Seating Jev as the approver for spend or deploy.
