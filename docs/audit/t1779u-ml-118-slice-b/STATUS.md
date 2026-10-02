# Issue #118 gate status: Slice B residual (t1779u)

Issue: https://github.com/Bthornton1994/Manipulation-score/issues/118 (stays OPEN; this slice closes nothing)

| Field | Value |
| --- | --- |
| Base (main) | `6f65e554e49c5bcbe203050ead56c61c874b2caf` (#178) |
| Evidence tip (code + tests) | `3c43762690a1f544e5bf900ac30770ee226c8f08` |
| Branch | `cos/t1779u-ml-118-slice-b` (local only, not pushed, no PR) |
| Behavior change | Kill-file path segment rule only. All other changes are default-off test seams. |
| Live URL | OFF. `loadConfig({})` gives `liveEnabled: false`, `liveUrlEnabled: false`. NOT LIVE. |
| Measured on | Windows 11 host, Node v24.19.0, Git Bash |

The docs commit that adds this file sits on top of the evidence tip and changes no code.

## Slice B result

1. Kill-file NAME_MAX gap: closed by code. `isKillSwitchAsserted` in `media-lens/worker/config.js` now treats a kill-file path with any segment over 255 characters as asserted, without calling `stat`. On this Windows host, `statSync` of a missing over-long segment throws `ENOENT`, which the old code read as "no kill file", so live paths stayed enabled. Linux reports `ENAMETOOLONG` and already failed closed. Normal `ENOENT` is still not a kill. `MEDIA_LENS_KILL_SWITCH` still needs the exact string `true`.
2. The 15 Python failures are a host precondition, made hermetic in tests. This is not a live-URL fix. `python3` on this host is the WindowsApps stub, so the extractor returns `python_version`, preparation yields no spans or language `und`, and analysis abstains before Jev. Production still calls local Trafilatura and py3langid with `python3`. A missing detector is never promoted to English in production. The tests pass stubs only when the extractor cannot start; CI runs the real extractor.

## Acceptance gate matrix (Issue #118)

CLOSED means the code and regression tests exist and pass. It does not approve live enablement. Every OPEN or OWNER gate blocks enablement.

| # | Gate | Status | Note |
| --- | --- | --- | --- |
| 1 | TypeSafe integration verified against the pinned version | OPEN | No spend this slice. Pin-verify tests ran only against 127.0.0.1 mocks. A fresh live pin-verify at an exact commit is still needed. |
| 2 | Connect-time IP pinning and redirect validation | CLOSED (code) | From #178. Unchanged. |
| 3 | Address dispositions (IPv4, IPv6, mapped, NAT64, SIIT, IPv4-compatible) | CLOSED (code) | From #178. Unchanged. |
| 4 | SSRF and DNS-rebinding adversarial tests | CLOSED (code) | From #178. Unchanged. |
| 5 | Resource, timeout, retry, and cancellation limits | CLOSED (code) | From #178. Unchanged. The timeout and abort assertions in `media-lens-security-hardening` now run on this host. |
| 6 | Privacy, consent, and retention decisions | OWNER | No owner approval exists. Not created here. |
| 7 | Independent security and QA review | OPEN | This slice is not the independent security review. |
| 8 | Canary, rollback, named host, owner authorization | OWNER | Not authorized. |
| 9 | Public claims describe the enabled scope | OPEN | Blocked until enablement. Live URL must not be advertised. |

## Not in scope and untouched

- PRs #168, #171, #172, #175, #179 and every other branch or worktree: not modified.
- No push, PR, merge, deploy, or flag change. No feeds, credentials, TypeSafe calls, package installs, or public claims.
