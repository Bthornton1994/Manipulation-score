# Media Lens canary + kill-switch drill packet (v1)

Status: **DRILL_PACKET_ONLY**. Live URL remains **disabled by default**. This packet is **not production-ready**. It **does not authorize live enablement**. It **does not enable canary or live mode**. Completing the documented rehearsal does **not** grant `READY_FOR_CANARY` as a production, canary, or enablement status.

| Field | Value |
| --- | --- |
| Workstream | [Issue #118](https://github.com/Bthornton1994/Manipulation-score/issues/118) remediation E |
| Phase | Ops/docs packet for a future owner-authorized drill. Flags stay off in the repository. |
| Operator runbook | `docs/media-lens-ops-runbook-v2.md` |
| Architecture | `docs/media-lens-live-url-v2-architecture.md` §§16–20 |
| classifier.dev privacy | `docs/media-lens-classifier-dev-privacy.md` — **KEEP_EVALUATION_ONLY** (retrieved 2026-09-19 PT). Default-off. Does not authorize a classify drill. |
| Public site | GitHub Pages remains Clarity-only. `docs/` and `media-lens/` stay off the Pages allowlist. |

Issue #118 is not complete when this packet exists. Independent security review, privacy/consent decisions, public-claim review, canary **evidence from an owner-authorized rehearsal**, and explicit owner authorization are still required before any live enablement. This document supports that future rehearsal. It is not the rehearsal, and it is not a production grant.

---

## 1. What this packet is and is not

This packet records **how an operator would rehearse** staging flags, a hop-scoped canary allowlist, kill-file abort, and rollback **if** an owner later authorizes a drill on an isolated machine.

It is:

- Operator-run documentation. Defaults remain OFF in git, CI, and GitHub Pages.
- A checklist plus an evidence template (commit SHA, flags used, allowlist, HTTP statuses, timestamps; **no secrets**).
- Cross-links to remediations A–D as already merged on `main`. It does not reopen those code paths.

It is not:

- Authorization to set `MEDIA_LENS_ENABLE_LIVE`, `MEDIA_LENS_ENABLE_LIVE_URL`, or `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` in any shared or production environment. classifier.dev privacy remains **KEEP_EVALUATION_ONLY**.
- A TypeSafe key, a `.env` file, or a live network job.
- A claim that Media Lens is production-ready, accurate, or available on manipulationscore.com.
- A `READY_FOR_CANARY` grant. That phrase is not a status this packet can assign.

Do not paste API keys, article bodies, span text, or URLs with userinfo into tickets, this file, or chat.

---

## 2. Staging / canary flag set (operator-run; defaults remain OFF)

These blocks are **operator-run worker configs**. They are not GitHub Pages settings. They are not CI defaults. Misspellings and `TRUE` / `1` / `yes` do not enable anything.

Repository defaults that must stay off:

| Variable | Repository default | Exact opt-in |
| --- | --- | --- |
| `MEDIA_LENS_MODE` | `fixture` | `live` only if the exact value `live` |
| `MEDIA_LENS_ENABLE_LIVE` | unset / false | exact `true` |
| `MEDIA_LENS_ENABLE_LIVE_URL` | unset / false | exact `true`, **in addition** to live |
| `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` | unset / false | exact `true`; evaluation-only |
| `MEDIA_LENS_JEV_VERIFY` | unset / false | exact `true`; isolated pin-verify only |
| `MEDIA_LENS_CLASSIFIER_DEV_LIVE_PROBE` | unset / false | exact `true`; optional probe only |
| `MEDIA_LENS_KILL_SWITCH` | unset / false | exact `true` asserts the kill switch |
| `MEDIA_LENS_URL_ALLOWLIST` | empty | empty means public-address policy only |

`.github/workflows/ci.yml` must not set those ENABLE flags. A TypeSafe key must never appear in git.

### Staging (isolated operator machine)

Purpose: exercise live Jev against a mock or a non-production key **without** article fetch. Not a public surface.

```
MEDIA_LENS_MODE=live
MEDIA_LENS_ENABLE_LIVE=true
# MEDIA_LENS_ENABLE_LIVE_URL remains unset
# MEDIA_LENS_ENABLE_CLASSIFIER_DEV remains unset
MEDIA_LENS_TYPESAFE_API_KEY=<from a secret store, never git>
MEDIA_LENS_TYPESAFE_BASE_URL=https://api.typesafe.ai
MEDIA_LENS_HOST=127.0.0.1
MEDIA_LENS_PORT=8787
MEDIA_LENS_KILL_SWITCH_FILE=/var/lib/media-lens/KILL
MEDIA_LENS_MAX_ANALYSES_PER_MINUTE=10
```

Expected while flags are in this staging shape: fixture paste stays local; `mode: "url"` returns `400 live_url_disabled`; no DNS for user URLs; classifier.dev makes **zero provider calls**.

### Canary (owner-operated, tiny, not a public product surface)

Purpose: safety/ops rehearsal. Success is “kill switch, hop-scoped allowlist, and SSRF policy work,” not accuracy. **Do not turn these flags on unless an owner has authorized this exact drill at an exact commit.**

```
MEDIA_LENS_MODE=live
MEDIA_LENS_ENABLE_LIVE=true
MEDIA_LENS_ENABLE_LIVE_URL=true
# MEDIA_LENS_ENABLE_CLASSIFIER_DEV remains unset unless the owner
# separately authorizes an evaluation-only classify drill
MEDIA_LENS_TYPESAFE_API_KEY=<secret store>
MEDIA_LENS_HOST=127.0.0.1
MEDIA_LENS_URL_ALLOWLIST=example.com,www.example.com
MEDIA_LENS_KILL_SWITCH_FILE=/var/lib/media-lens/KILL
MEDIA_LENS_MAX_ANALYSES_PER_MINUTE=10
MEDIA_LENS_MAX_LIVE_URL_PER_MINUTE=10
MEDIA_LENS_MAX_LIVE_URL_PER_HOST_PER_MINUTE=3
MEDIA_LENS_MAX_CONCURRENT_LIVE_URL=1
```

Bind remains `127.0.0.1`. Binding `0.0.0.0` is out of scope for this packet.

This packet does **not** authorize turning these flags on in any shared environment. After any authorized drill, return the worker to repository defaults (`MEDIA_LENS_MODE=fixture`, ENABLE flags unset).

---

## 3. Allowlist hosts (hop-scoped after remediation A)

`MEDIA_LENS_URL_ALLOWLIST` is a comma-separated list of **exact hostnames** (lowercased, no scheme, no path). Empty means public-address policy only.

When the list is set, **every redirect hop** is re-checked **before** pin/connect (remediation A). Off-list hops fail closed as `400 live_url_not_allowlisted` and must not return HTTP 200 from the hop body.

| Hop | Expected |
| --- | --- |
| Initial user URL host on the list | Continue to pin/connect if public-address policy also passes |
| Same-host relative `Location` while the host remains listed | Allowed |
| Allowlisted host → different hostname not on the list (for example `example.com` → `other.example`) | `live_url_not_allowlisted`; no second connect |
| Empty allowlist | Public-address policy only; hop-scoped list check does not apply |

Canary should set an allowlist. Architecture §23 still lists “whether canary uses a hostname allowlist” as an owner decision; this packet does not silently close that decision. It records the operator procedure **if** the owner chooses a list.

Do not put IP literals, credentials, or query strings in the allowlist field recorded in evidence.

---

## 4. Kill-file drill (expect 503 `live_killed` / `verify_kill_switch`; zero provider calls)

Two equivalent controls, re-checked on each `/analyze` (kill-file `stat` each time):

1. `MEDIA_LENS_KILL_SWITCH=true` — exact string `true` only.
2. `touch` the path in `MEDIA_LENS_KILL_SWITCH_FILE` (existence, not file contents). Permission, IO, and other non-`ENOENT` `stat` errors on that path fail-closed (treat as asserted). Only a missing path is not a kill.

`TRUE`, `1`, and `yes` do not assert the kill switch.

### 4.1 Live worker `/analyze`

On an owner-authorized **live-mode** worker:

1. Confirm `GET /health` is 200, `killSwitch` is false, and the JSON has no `secrets` object and no key material.
2. `touch` the kill file. Do not restart.
3. `POST /analyze` (any body, including `mode: "url"`) must return **`503 live_killed` before the body is read**. Audit event `kill_switch`.
4. Expect **zero provider calls**: no article DNS/connect, no TypeSafe `POST /v1/systemone`, no classifier.dev `POST /v1/classify`.
5. Fixture-mode workers are different: fixture `mode: "fixture"` continues; fixture `mode: "url"` is `400 URL_MODE_REQUIRES_LIVE` even when the kill switch is on.

### 4.2 Isolated pin verify

`scripts/jev-pin-verify.js` with the kill switch asserted (env or kill file) must fail-close with reason **`verify_kill_switch`**, exit nonzero, and make **zero provider calls**, even when `MEDIA_LENS_JEV_VERIFY=true` and a key are set. It must not invoke the TypeSafe adapter.

### 4.3 classifier.dev

Kill switch wins over `MEDIA_LENS_ENABLE_CLASSIFIER_DEV=true`. Expect zero `POST /v1/classify`. `/health` `classifierDev.effectiveEnabled` is false.

### 4.4 Clear the kill file

`unlink` the kill file (or unset `MEDIA_LENS_KILL_SWITCH`). The next request is no longer killed **if** enable flags are still set. Clearing the kill file is not authorization to leave live flags on. After the drill, unset the ENABLE flags and return to `MEDIA_LENS_MODE=fixture`.

Repository tests in `tests/media-lens-canary-drill.test.js` and `tests/media-lens-ops-controls.test.js` prove these outcomes with local mocks: no live network, no keys.

---

## 5. Rollback

No history rewrite. Do not rebase or force-push PR #117 / `9cca564`.

1. Assert the kill switch (`MEDIA_LENS_KILL_SWITCH=true` or `touch` the kill file). Confirm live `/analyze` is `503 live_killed` or fixture-only, that `scripts/jev-pin-verify.js` exits nonzero with `verify_kill_switch`, and that classifier.dev makes **zero provider calls**.
2. Unset `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` to disable classifier.dev without touching Jev fixture mode. Unset `MEDIA_LENS_ENABLE_LIVE_URL` and/or `MEDIA_LENS_ENABLE_LIVE` to stop live Jev/URL. Restart the worker.
3. Forward-fix or `git revert` the implementation PR on `main` if a code defect caused the abort.
4. Rotate `MEDIA_LENS_TYPESAFE_API_KEY` if logs or a proxy might have seen it. Do not write the new value into git, tickets, or this packet.
5. If a mistaken Pages allowlist change published `media-lens/` or `docs/`, revert `scripts/build-pages-site.js` and redeploy. Treat that as an incident even if the worker was not hosted there.

See runbook §5–§6 and architecture §20 for incident classes. Public communications must stick to operational facts (HTTP status, error code, commit SHA). Do not claim Media Lens detected an attack against a named outlet or person.

---

## 6. Abort criteria (canary stops; not a production incident)

Stop the drill and roll back if any of the following occur:

- Pinning test failure, `PIN_MISMATCH`, or mixed public+private DNS
- Adversarial fixture failure (SSRF, NAT64/ISATAP, hop allowlist)
- `model_match` false on pinned `jev-1.13.0`
- Pages allowlist drift (`docs/` or `media-lens/` would publish)
- Suspected SSRF (metadata/LAN reached)
- Kill file does not yield `503 live_killed` / `verify_kill_switch`
- Any provider call after the kill switch is asserted
- Key-shaped strings in `/health`, audit lines, or tickets

Production live URL is already off, so a canary abort is **not** a production incident. It is also **not** a `READY_FOR_CANARY` grant.

---

## 7. Evidence capture template (no secrets)

Copy this block into an operator-held note. Keep it off git if it contains environment-specific hostnames you do not want in the repository. Never fill in API keys, bearer tokens, article bodies, span text, or URLs with userinfo.

```
drill_packet: docs/media-lens-canary-drill-v1.md
status: DRILL_PACKET_ONLY
not_production_ready: true
does_not_grant: READY_FOR_CANARY
issue: 118
commit_sha: <git rev-parse HEAD>
started_at: <ISO-8601 UTC>
ended_at: <ISO-8601 UTC>
operator: <name, not a secret>
environment: isolated_operator_machine | (do not write production)

flags_used:
  MEDIA_LENS_MODE: <fixture|live>
  MEDIA_LENS_ENABLE_LIVE: <unset|true>
  MEDIA_LENS_ENABLE_LIVE_URL: <unset|true>
  MEDIA_LENS_ENABLE_CLASSIFIER_DEV: <unset|true>
  MEDIA_LENS_JEV_VERIFY: <unset|true>
  MEDIA_LENS_KILL_SWITCH: <unset|true>
  # do not record MEDIA_LENS_TYPESAFE_API_KEY or any secret value

allowlist: <comma-separated exact hostnames, or empty>
kill_file_configured: <true|false>
kill_file_existed_after_touch: <true|false>

http_statuses:
  health_before: <status>
  analyze_after_touch: <status> <error code, expect 503 live_killed in live mode>
  health_after_touch: <status; killSwitch true; no secrets object>

pin_verify_reason: <expect verify_kill_switch when killed>
provider_calls:
  article_fetch: <expect 0 while killed>
  typesafe_jev: <expect 0 while killed>
  classifier_dev: <expect 0 while killed>

notes: <operational facts only>
```

Timestamps and HTTP statuses are required. Commit SHA is required. Flags used are required as names and exact values, not as a dump of `env`. Allowlist is required as hostnames only.

---

## 8. Cross-links (A–D unchanged)

| Remediation | Topic | Pointer |
| --- | --- | --- |
| A | Hop-scoped URL allowlist | `media-lens/worker/safe-fetch.js`; `tests/media-lens-allowlist-redirect.test.js` |
| B | NAT64 / ISATAP fail-closed | architecture §6; `tests/media-lens-nat64-isatap.test.js` |
| C | Connect-time pin for live Jev and classifier.dev | `media-lens/worker/provider-pinned-fetch.js` |
| D | classifier.dev default tier `fast` | `media-lens/worker/classifier-dev/contract.js` |
| E (this packet) | Canary / kill-switch drill docs | this file; runbook §11 |

Privacy/DPA SoT (does not close Issue #118): `docs/media-lens-classifier-dev-privacy.md` (**KEEP_EVALUATION_ONLY**).

This packet does not change those implementations.

---

## 9. What this does not do

- It does not set `MEDIA_LENS_ENABLE_LIVE`, `MEDIA_LENS_ENABLE_LIVE_URL`, or `MEDIA_LENS_ENABLE_CLASSIFIER_DEV` true by default.
- It does not host Media Lens on GitHub Pages.
- It does not enable live pasted-text.
- It does not claim production readiness, real-world accuracy, or that Issue #118 is done.
- It does not grant `READY_FOR_CANARY`.
- It does not replace independent security review or owner authorization.
- It does not include a TypeSafe key.

---

## 10. Fixture proof in this repository

Always-on, no live network, no keys:

- `tests/media-lens-canary-drill.test.js` — this packet’s docs lock, default-off flags, kill-file `503 live_killed`, `verify_kill_switch`, Pages/no-secrets boundary.
- `tests/media-lens-ops-controls.test.js` — kill switch, kill file, allowlist, audit redaction.
- `tests/media-lens-allowlist-redirect.test.js` — hop-scoped allowlist (remediation A).
- `tests/media-lens-jev-pin-verify.test.js` — `verify_kill_switch` with zero network.
- `tests/pages-artifact-boundary.test.js` and `tests/media-lens-no-secrets.test.js` — Pages and secret-shape locks.

Those tests are regression coverage for the checklist. They are not established real-world accuracy and not a production canary.
