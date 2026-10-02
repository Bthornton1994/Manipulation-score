# DIGEST: t1779u Media Lens #118 Slice B residual

Outcome: pending. Issue #118 stays OPEN. Live URL stays OFF. NOT LIVE.

## t1725u assumptions (written before any edit)

| # | Assumption | Label | Evidence |
| --- | --- | --- | --- |
| 1 | Base is main `6f65e554e49c5bcbe203050ead56c61c874b2caf` (#178) and the branch has no other commits | Verified | `git ls-remote origin refs/heads/main` and `git rev-parse HEAD` both print `6f65e554…`. Working tree clean apart from the untracked `_cos/` brief. |
| 2 | LIVE_URL is OFF by default | Verified | `effectiveLiveFlags(loadConfig({}))` prints `{"killSwitch":false,"liveEnabled":false,"liveUrlEnabled":false,"classifierDevEnabled":false}`. `config.js` `effectiveLiveFlags` requires exact `'true'`, `liveEnabled`, and no kill switch. |
| 3 | The three suites give 73 tests, 56 pass, 17 fail on this host | Verified | `node --test --test-force-exit` on `media-lens-jev-pin-verify`, `media-lens-security-hardening`, `media-lens-ops-controls`, Node v24.19.0, Git Bash. |
| 4 | Two failures are the kill-file path, not product enablement | Verified | Both use `join(tmpdir(), 'x'.repeat(5000))`. On this host `statSync` of that path throws `ENOENT` (also for a 256-char segment). `isKillSwitchAsserted` returns `err.code !== 'ENOENT'`, so the switch stays off. Injected `EACCES`/`ENAMETOOLONG` cases already pass. `evaluateJevVerifyGate` calls `isKillSwitchAsserted`. |
| 5 | Linux makes the same path `ENAMETOOLONG` and fail-closed | Inferred | Linux `NAME_MAX` is 255 bytes per segment; CI on main is green for these tests. Not run here. |
| 6 | The other 15 failures are the missing Python extractor | Verified | `detectTextLanguage('This is a short English sentence.')` and `extractLocalArticle('<p>hi there</p>')` both return `error_code: 'python_version'`. `which python3` is the WindowsApps stub. Real Python 3.12 at `%LOCALAPPDATA%\Programs\Python\Python312` raises `ModuleNotFoundError: No module named 'trafilatura'`. |
| 7 | `prepareFromHtml` already accepts `extractImpl`; `createServer` already threads `options.extractImpl` into `prepareFromHtml` on the fixture and URL analyze paths | Verified | `prepare.js` `prepareFromHtml({ …, extractImpl = extractLocalArticle })`; `server.js` `const extractImpl = options.extractImpl || undefined;` passed to `preparePayload`. No server change is needed. |
| 8 | `prepareFromPastedText` and `loadSyntheticFixtureCases`/`runJevPinVerify` have no extractor seam | Verified | `prepareFromPastedText` calls `detectTextLanguage(text)` directly; `loadSyntheticFixtureCases` calls `prepareFromHtml` without `extractImpl`. |
| 9 | The stub `extractImpl` must return the Python success shape | Verified | `trafilatura/extract_html.py` `base_payload` plus `status: 'ok'`, `text`, `title`, `author`, `date`, `detected_language`, `html_lang`, `extractor_version`, `language_detector_version`. `prepareFromHtml` uses `status`, `text`, `title`, `author`, `date`, `detected_language`, `html_lang`. |
| 10 | Stubs must not run where the real extractor works (CI) | Verified (design) | The helper checks `detectTextLanguage` for `python_version`/`spawn_failed` and returns `undefined` stubs otherwise, so production defaults run. |
| 11 | Gates 1, 6, 7, 8, 9 stay open and need owner action or spend | Verified (absence) | No owner approval, independent review, or fresh pin-verify report exists in the repo. Nothing in this slice changes that. |
| 12 | Full `npm test` hangs on this host | Verified (prior memory, not re-run) | Not run, per the brief. Linux CI is the suite authority. |

No assumption is used to bypass an owner gate. No packages installed, no TypeSafe call, no live flag set.
