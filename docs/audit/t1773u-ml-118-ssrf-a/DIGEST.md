# DIGEST: t1773u Media Lens #118 Slice A residual

Outcome: SSRF mutation tests now run their mutants on CRLF (Windows) checkouts. Test and docs only. Issue #118 stays OPEN. Live URL stays OFF. NOT LIVE.

- Base: `578e3fc3035c061bd33a67a7ae6095b96dccd969`
- Evidence tip (code + tests): `5617a239f5c362b7b409f6afe7810f67052370cb`
- Final branch tip: recorded in the PR body (docs-only commits follow the evidence tip)
- Draft PR: PR_URL_PENDING
- Gate matrix and remaining slices: [STATUS.md](STATUS.md)

## Model and runtime

UltraCode was not enabled for this session, so the work ran directly on `claude-opus-5-5` (Opus 5.5) in permission mode auto. Fable was not used. No CloudAgent.

## t1725u assumptions

| # | Assumption | Label | Evidence |
| --- | --- | --- | --- |
| 1 | Slice A (connect-time pin, address normalization, fail-closed, per-hop redirects, limits, adversarial tests) is on main at `578e3fc` | Verified | `pinned-http.js` connects to `pin.address` with a pin-only lookup and `keepAlive: false`; `safe-fetch.js` `pinHost` per hop, `DEFAULT_MAX_REDIRECTS = 3`, `positiveLimit` caps; `address-policy.js` mapped/SIIT/NAT64/extra-NAT64/ISATAP branches. SSRF suites 72/80 at base on Windows; all 8 failures were `mutator must change the source`. |
| 2 | LIVE_URL is OFF by default and needs exact `"true"` plus `liveEnabled` | Verified | `loadConfig({})` gives `liveEnabled: false`, `liveUrlEnabled: false`; `MEDIA_LENS_ENABLE_LIVE_URL: 'TRUE'` gives `false`; `config.js:325` requires `!killSwitch && liveEnabled && === 'true'`. |
| 3 | Windows mutation failures are CRLF, not logic | Verified | `core.autocrlf=true`; `git ls-files --eol` shows `i/lf w/crlf` for worker sources; failing asserts were `mutator must change the source` / `must change the fetch stack`; all pass after LF normalization with no worker change. Also found in `media-lens-rfc5737-documentation.test.js` (same loader), so it is included. |
| 4 | `openssl` ENOENT is operator PATH, not a product gap | Verified | `/mingw64/bin/openssl` on Git Bash PATH; PowerShell `Get-Command openssl` finds nothing. Real-socket TLS suite 7/7 from Git Bash. TLS policy untouched. |
| 5 | Jev pin-verify plumbing exists; live pin-verify not re-run | Verified (plumbing), Unknown (historical pass) | `jev-pin-verify.js`, `MODEL_REQUESTED = 'jev-1.13.0'`. `8008054` and `4c7adf7` exist and are ancestors of main, but their commit subjects (#134 privacy doc; RFC 5737 block) do not themselves evidence `PIN_VERIFY_PASS` or `model_match`, and reports are not stored in `docs/`. Gate 1 stays OPEN. |
| 6 | Owner privacy/consent/retention approvals and production host provisioning are not granted | Verified (absence) | No approval artifact in repo; Issue #118 lists them as unmet gates. Nothing invented. |

## Files changed

| File | Change |
| --- | --- |
| `tests/helpers/read-source-lf.js` | New. `normalizeLf()` and `readSourceLf()`. |
| `tests/media-lens-source-lf.test.js` | New. Regression check that a CRLF copy matches the LF M1 anchor only after normalization. |
| `tests/media-lens-ssrf-mutation.test.js` | Worker source reads use `readSourceLf`. |
| `tests/media-lens-nat64-extra-native-unicast.test.js` | Worker source reads use `readSourceLf`. |
| `tests/media-lens-rfc5737-documentation.test.js` | Worker source reads use `readSourceLf`. |
| `docs/audit/t1773u-ml-118-ssrf-a/STATUS.md`, `DIGEST.md` | New. |

No changes to `address-policy.js`, `safe-fetch.js`, `pinned-http.js`, or any other worker file.

## Tests (Windows host, Git Bash, Node v24.19.0, `node --test --test-force-exit`)

| Suite | Base `578e3fc` | Evidence tip |
| --- | --- | --- |
| `media-lens-ssrf-pin` | pass | 15/15 PASS |
| `media-lens-allowlist-redirect` | pass | 10/10 PASS |
| `media-lens-site-local-6bone` | pass | 11/11 PASS |
| `media-lens-nat64-isatap` | pass | 10/10 PASS |
| `media-lens-nat64-extra-native-unicast` | 2 fail (CRLF) | 10/10 PASS |
| `media-lens-ssrf-mutation` | 6 fail (CRLF) | 17/17 PASS |
| `media-lens-ssrf-real-socket` | pass | 7/7 PASS |
| `media-lens-rfc5737-documentation` | 1 fail (CRLF) | 5/5 PASS |
| `media-lens-source-lf` (new) | n/a | 3/3 PASS |
| Combined | 72/80 + 4/5 | 88/88 PASS |
| Adjacent: fetch-limits, canary-drill, live-gate, ops-controls, security-hardening, provider-pin, live-url-privacy-policy, jev-pin-verify | 119/136, 17 fail | 119/136, same 17 fail (pre-existing, untouched files) |

Full `npm test` was NOT RUN (known to hang on this host; out of scope).

## Gate matrix summary

CLOSED (code): 2 pinning and redirects, 3 address dispositions, 4 SSRF and rebinding adversarial tests, 5 limits. OPEN: 1 TypeSafe pin verification at an exact commit, 6 privacy/consent/retention (OWNER ONLY), 7 independent security and QA review, 8 canary/rollback/owner authorization, 9 public claims. Details in [STATUS.md](STATUS.md).

## Next

- Next engineering slice: B residuals, starting with the pre-existing Windows-host failures in `media-lens-security-hardening`, `media-lens-ops-controls`, and `media-lens-jev-pin-verify` (separate scoped PR). Rate-budget drafts #172 and #175 stay separate.
- Owner-only blockers: privacy/consent/retention approval (C), independent security review (D), named production host plus canary/rollback authorization (E), public claims (F), and a fresh pinned Jev verification run authorized for spend (gate 1).

## Untouched

PR #117 head `a1e7e4a1` (merged) and Cursor drafts #165, #167, #168, #171, #172, #175 were not modified, merged, or undrafted. No flags enabled, no credentials, no spend.
