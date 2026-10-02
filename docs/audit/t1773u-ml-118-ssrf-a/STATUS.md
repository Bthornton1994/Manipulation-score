# Issue #118 gate status: Slice A (t1773u)

Issue: https://github.com/Bthornton1994/Manipulation-score/issues/118 (stays OPEN; this slice closes nothing)

| Field | Value |
| --- | --- |
| Base (main) | `578e3fc3035c061bd33a67a7ae6095b96dccd969` |
| Evidence tip (code + tests) | `5617a239f5c362b7b409f6afe7810f67052370cb` |
| Branch | `cos/t1773u-ml-118-ssrf-a` (draft PR, KEEP_DRAFT) |
| Behavior change | None. Test helpers, one new test file, and these docs only. |
| Live URL | OFF. `loadConfig({})` gives `liveEnabled: false`, `liveUrlEnabled: false`. NOT LIVE. |
| Measured on | Windows 11 host, Node v24.19.0, Git Bash, `core.autocrlf=true` |

The docs commit that adds this file sits on top of the evidence tip and changes no code. The final branch tip is recorded in the PR body.

## What this slice fixed

On a Windows checkout with `core.autocrlf=true`, worker sources such as `media-lens/worker/address-policy.js` are written with CRLF (`git ls-files --eol` shows `i/lf w/crlf`). The SSRF mutation tests read those files and apply multi-line, LF-only anchors. The anchors never matched, so 9 mutation tests failed with `mutator must change the source` on Windows only. Worker behavior was correct; the tests could not run their mutants.

Fix: `tests/helpers/read-source-lf.js` exposes `readSourceLf()`, which replaces `\r\n` with `\n`. The three mutation suites read worker sources through it. The mutated copies are written as LF, which Node imports the same way. `tests/media-lens-source-lf.test.js` is the regression check: it writes a CRLF copy of `pinned-http.js`, shows the raw text does not match the M1 anchor, and shows the normalized text does.

## Acceptance gate matrix (Issue #118)

CLOSED means the code and regression tests exist on main and pass at the evidence tip. It does not mean live enablement is approved. Every OPEN gate blocks enablement.

| # | Gate | Status | Evidence |
| --- | --- | --- | --- |
| 1 | TypeSafe integration verified against the pinned version | OPEN | Pin plumbing exists: `media-lens/worker/jev-pin-verify.js`, `MODEL_REQUESTED = 'jev-1.13.0'` in `media-lens/worker/adapters/jev.js`, `workflow_dispatch`-only `.github/workflows/jev-pin-verify.yml`. No live pin-verify ran in this slice (no spend). The brief cites a historical `PIN_VERIFY_PASS` at `8008054` and canary `model_match` at `4c7adf7`. Both commits exist and are ancestors of main, but their subjects are a privacy doc (#134) and the RFC 5737 change. The repo does not store pin-verify reports under `docs/` by design, so this slice cannot confirm those results. A fresh run at an exact commit is needed. |
| 2 | Connect-time IP pinning and redirect validation implemented and regression-tested | CLOSED (code) | `pinned-http.js` connects to `pin.address` with a lookup that returns only the pin and never calls DNS; `safe-fetch.js` calls `pinHost` once per redirect hop. Tests: `media-lens-ssrf-pin` (15/15), `media-lens-allowlist-redirect` (10/10), `media-lens-ssrf-real-socket` M1/M6/M7/M10 (7/7), `media-lens-ssrf-mutation` M1/M10 (17/17). |
| 3 | Explicit tested disposition for IPv4, IPv6, mapped, canonicalized, NAT64, SIIT, IPv4-compatible | CLOSED (code) | `address-policy.js` mapped, SIIT, NAT64 well-known/local/unknown, extra-NAT64 residual, ISATAP, `fec0::/10`, `3ffe::/16`, RFC 5737. Tests: `media-lens-nat64-isatap` (10/10), `media-lens-nat64-extra-native-unicast` (10/10), `media-lens-site-local-6bone` (11/11), `media-lens-rfc5737-documentation` (5/5), IPv4 and IPv6 policy tables in `media-lens-ssrf-pin`. |
| 4 | SSRF and DNS-rebinding adversarial tests pass | CLOSED (code) | DNS rebinding, mixed public/private DNS, redirects to private/mapped/NAT64, `HTTP_PROXY` ignored, `PIN_MISMATCH`, `keepAlive: false`: `media-lens-ssrf-pin.test.js`. Windows host: 88/88 across the nine SSRF suites after this fix (72/80 before). Linux CI result is on the PR. |
| 5 | Resource, timeout, retry, and cancellation limits tested | CLOSED (code) | `media-lens-fetch-limits.test.js` H1 to H4 (header cap, compressed-body cap, whole-chain timeout, default caps); "slow body and caller abort cancel the fetch and do not retry" in `media-lens-ssrf-pin.test.js`. |
| 6 | Privacy, consent, and retention decisions approved | OPEN, OWNER ONLY | No owner approval exists in the repo. This slice does not create one. |
| 7 | Independent security and QA review passes | OPEN, OWNER or external | No independent review is recorded. Independent QA under t1704u is still required before any merge. |
| 8 | Canary plan, rollback plan, and owner authorization | OPEN, OWNER | A canary drill packet and kill-switch drill exist (`docs/media-lens-canary-drill-v1.md`, `tests/media-lens-canary-drill.test.js`). A staging canary pass is not enablement. No named production host is provisioned and no owner authorization exists. |
| 9 | Public claims describe the enabled scope | OPEN, blocked | Blocked until enablement. Live URL must not be advertised. |

## Remaining slices

| Slice | Scope | Owner | State |
| --- | --- | --- | --- |
| A (this) | Pinning, normalization, fail-closed, redirects, limits, adversarial tests | Engineering | Code already on main at `578e3fc`. This PR makes the mutation evidence reproducible on Windows. Gates 2 to 5 CLOSED (code). |
| B | Ops control residuals (flag, audit, rate limits, kill switch, monitoring) | Engineering | Controls exist (`config.js` kill switch, `audit.js`, `rate-limit.js`, `media-lens-ops-controls.test.js`). Rate-budget fixes are in separate Cursor drafts #172 and #175; this slice does not merge or modify them. |
| C | Privacy, consent, retention | OWNER ONLY | Not started by engineering. Needs owner decisions. |
| D | Independent security review | OWNER or external reviewer | Not started. |
| E | Canary and rollback on a named production host | OWNER | Not authorized. Staging canary results do not enable anything. |
| F | Public claims | OWNER | Blocked until E completes and the owner authorizes enablement. |

## Windows-host notes (not product gaps)

- `openssl` is on the Git Bash PATH (`/mingw64/bin/openssl`) but not on the PowerShell PATH. The real-socket TLS tests and the M6/M7 mutants call `openssl` to mint a local CA, so they fail with `ENOENT` when run from PowerShell. They pass from Git Bash. This is operator environment. TLS policy is unchanged and must not be disabled to work around it.
- 17 failures in adjacent suites (`media-lens-jev-pin-verify`, `media-lens-security-hardening`, `media-lens-ops-controls`) are pre-existing: the same 136 tests, 119 pass, 17 fail, with identical test names at base `578e3fc` in a clean detached worktree. They are outside this slice's scope and are not caused by it. Some may be the same CRLF source-anchor class (for example, the `server.js` anchor in security-hardening H2); they need a separate, scoped fix.

## Untouched

- PR #117 head `a1e7e4a1e28fab15a3988ac794379bd85fed9141` (already merged): not modified.
- Cursor drafts #165, #167, #168, #171, #172, #175: not modified, merged, or undrafted.
- No flags enabled, no credentials used, no spend, no feeds, no Medialyst, no CloudAgent.
