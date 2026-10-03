# DIGEST: t1779u Media Lens #118 Slice B residual

Outcome: the kill-file NAME_MAX gap is closed by code. The 15 Python-host failures now run hermetically on hosts without the extractor. The three target suites go from 56/73 to 74/74 on this Windows host. Issue #118 stays OPEN. Live URL stays OFF. NOT LIVE.

- Branch: `cos/t1779u-ml-118-slice-b`, pushed as PR #180 (https://github.com/Bthornton1994/Manipulation-score/pull/180). PR head when this line was written (t1783u): `b94d506a9279922406a3b5c2a4b52d76ef7d1198`. The t1783u residual commit is on `cos/t1783u-ml-180-codex-p2`, a fast-forward of `b94d506`, and may replace it as the PR head.
- Base: `6f65e554e49c5bcbe203050ead56c61c874b2caf`
- Evidence tip (code + tests + this checklist): `3c43762690a1f544e5bf900ac30770ee226c8f08`. Its sole parent is the base `6f65e55…`.
- Final tip: `b94d506a9279922406a3b5c2a4b52d76ef7d1198`, the docs-only commit that adds STATUS.md and finishes this file. Its sole parent is the evidence tip `3c43762…`. PR #180 lists 2 commits (`3c43762`, `b94d506`), which matches this topology. A squash preview of the PR is a single commit on the base and is not the review tip.
- Gate matrix: [STATUS.md](STATUS.md)
- Runtime: `claude-opus-5-5`, permission mode auto. No bypass, no CloudAgent, Fable not used.

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

### Checklist status at the end

All verified rows still hold. Row 5 (Linux `ENAMETOOLONG`) stays Inferred: it was not run here, and the new segment rule makes the result the same on both OSes. Row 7 held: `createServer` already threaded `extractImpl`, so `server.js` is unchanged. Row 10 is verified by code inspection only: this host cannot run the real extractor, so the "CI uses the real extractor" path was not run here.

## Files changed

| File | Change |
| --- | --- |
| `media-lens/worker/config.js` | `isKillSwitchAsserted` asserts, without a stat, when any path segment (split on `/` and `\`) is over 255 characters. Comment states the Windows `ENOENT` gap. |
| `media-lens/worker/prepare.js` | `prepareFromPastedText` accepts optional `detectImpl` (default `detectTextLanguage`). |
| `media-lens/worker/jev-pin-verify.js` | `runJevPinVerify` passes optional `options.extractImpl` to `loadSyntheticFixtureCases`, which passes it to `prepareFromHtml`. |
| `tests/helpers/python-extractor-host.js` | New. `pythonExtractorDown()` (cached promise; true only for `python_version` or `spawn_failed`), `hermeticExtract`, `hermeticDetect`, `extractSeam()`, `detectSeam()`. |
| `tests/media-lens-ops-controls.test.js` | New regression: a 256-char segment (`/` and `\`) is asserted when stat would say `ENOENT` or throw if called (0 stat calls); a 255-char segment with `ENOENT` is not asserted. |
| `tests/media-lens-jev-pin-verify.test.js` | `...(await extractSeam())` in the 9 tests that failed with `no_synthetic_spans`. |
| `tests/media-lens-security-hardening.test.js` | `...(await extractSeam())` on the H1 `createServer`; `...(await detectSeam())` on the 5 `prepareFromPastedText` calls in H2, H2 timeout, N1 x2, N2. |
| `docs/audit/t1779u-ml-118-slice-b/DIGEST.md`, `STATUS.md` | New. |

`server.js` is unchanged. Live-URL gating, rate limits, and #172/#175 behavior are untouched.

## Behavior changed

- Production: the kill-switch segment rule only. Exact `MEDIA_LENS_KILL_SWITCH=true`, `TRUE`/`1`/`yes` not asserting, normal `ENOENT` not asserting, and other stat errors failing closed are all unchanged.
- Seams: `detectImpl` and pin-verify `extractImpl` are off by default. When omitted, the code path is the same as before.
- Stubs: `hermeticExtract` returns the Python success shape. `text` holds only the visible `h1`-`h3`, `p`, `blockquote`, `li`, and `figcaption` text of the html argument, `detected_language: 'en'`, and `html_lang` read from `<html lang>`. `extractor_version` is the pinned `TRAFILATURA_VERSION` because the schema accepts only that value. `language_detector_version` is `test-hermetic-no-python`. `hermeticDetect` returns `{ status: 'ok', detected_language: 'en', language_detector_version: 'test-hermetic-no-python' }`.

## Tests (Windows host, Git Bash, Node v24.19.0, `node --test --test-force-exit`)

| Check | Base `6f65e55` | Evidence tip | Label |
| --- | --- | --- | --- |
| `media-lens-jev-pin-verify` + `media-lens-security-hardening` + `media-lens-ops-controls` | 73 tests, 56 pass, 17 fail | 74 tests, 74 pass, 0 fail (one new test) | PASS |
| `media-lens-source-lf` | 3/3 | 3/3 | PASS |
| Mutation: remove the segment rule | n/a | the new test plus both 5000-x real-stat tests fail (3/3) | PASS (the regression catches the gap) |
| Adjacent: `trafilatura`, `canary-drill`, `jev-production-controls`, `live-gate`, `fetch-limits`, `classifier-dev-adapter`, `source-lf` | 176 tests, 131 pass, 45 fail | 176 tests, 131 pass, 45 fail. Same failing test names as a clean detached base worktree | No regression. The 45 are pre-existing Python-host failures outside this brief and were left alone. |
| `effectiveLiveFlags(loadConfig({}))` | all false | `{"killSwitch":false,"liveEnabled":false,"liveUrlEnabled":false,"classifierDevEnabled":false}` | PASS |
| Full `npm test` | NOT RUN | NOT RUN | Hangs on this host. Linux CI is the suite authority. |
| Linux CI | UNKNOWN | Not run on this commit alone; CI ran on the PR head | PASS at final tip `b94d506`: CI run 37071779735 SUCCESS, required checks `test (20)` and `test (22)` passed (`deploy` skipped). The t1783u residual commit re-triggers CI when pushed. |

The security assertions the brief lists are unchanged and now run on this host. An out-of-taxonomy choice is never an observation and `jev.failures > 0`. The per-analysis timeout gives `engine_unavailable`. `jevCallTimeoutMs` is honored. `oversized_input` keeps `consent_at` and `user_asserted_public`. No Jev calls happen after the timeout. Pin-verify fails closed on 401/422/429/529, malformed JSON, missing answers, `jev-9.9.9`, and `jev-latest`, and it records a mock success. Pin-verify spans still come from the fixture file (`Main Street|road closure|repaving`). All network was 127.0.0.1 mocks.

## Confirmations

- LIVE_URL untouched. No `MEDIA_LENS_ENABLE_LIVE` or `MEDIA_LENS_ENABLE_LIVE_URL` set outside the existing in-test configs.
- #118 not closed. Commits say `Refs #118`.
- PRs #168, #171, #172, #175, #179 and other branches or worktrees untouched. A temporary detached worktree at the base was created to compare failure sets and then removed.
- No spend, no TypeSafe call, no pip install. The t1779u writer did not push or open a PR; the branch was pushed afterwards as PR #180.

t1783u residual (Codex P2 review of PR #180): this file now records PR #180, the commit chain, and CI for `b94d506`; `tests/helpers/python-extractor-host.js` also treats `extractor_unavailable` (Python 3.12+ without the pinned Trafilatura stack) as a down extractor, with a regression test in `tests/media-lens-trafilatura.test.js`; `media-lens/README.md` separates an ordinary missing kill file (`ENOENT`, not asserted) from a path with a segment over 255 characters (asserted without a `stat` call). Issue #118 stays OPEN. Live URL stays OFF.
