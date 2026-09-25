# Media Lens frontend deployment

This is the deployment shape for the limited Jev-only Media Lens preview. It
keeps the browser page and the worker on the same origin, so the browser does
not need a broad cross-origin permission and the TypeSafe key stays on the
worker host.

Updated 2026-09-25. The release that follows PR #143 is **not frontend-only**.
It changes worker code (PR #146 `live_fixture_disabled`, PR #145 timeout call
accounting, PR #149 fail-closed budget record), and it is the first deploy
whose article preparation needs the pinned Trafilatura virtualenv. The worker
must be restarted. Use the release procedure below. Issue #118 stays open.

## Route

The public preview route is:

`https://ml-jev.manipulationscore.com/media-lens/`

The host root (`/`) is not a UI route and returns 404. The UI route is
separate from Clarity and remains excluded from the GitHub Pages artifact.

## Files and proxy boundary

`/opt/media-lens/app` on `ml-jev` is a checkout of this repository at an
exact commit. Use [`media-lens/deploy/Caddyfile`](../media-lens/deploy/Caddyfile)
as the site configuration. It serves only:

- `media-lens/index.html`
- `media-lens/media-lens.js`
- `media-lens/media-lens.css`
- the shared `fonts.css`, `styles.css`, `icon.svg`, and `fonts/` assets

`/health` and `/analyze` proxy to the worker at `127.0.0.1:8787`. Every other
path returns 404. No worker source, fixtures, tests, repository
documentation, or credentials are served. Issue #118 records that the host's
Caddy site merged these routes into an existing site that also keeps the ACME
email, security headers, and an access log.

Article preparation needs Python 3.12 or newer and the pinned Trafilatura
virtualenv on the worker `PATH`. numpy 2.5.3 does not install on an older
interpreter. This procedure does not install the virtualenv and does not run
`install.sh` on the host. When an operator installs it, `install.sh` refuses
a `python3` older than 3.12. See `media-lens/worker/trafilatura/DEPS.md`.
Without it, every URL analysis abstains with an extraction failure.

The page resolves its API base from the current origin on the live host. In a
local browser preview (`localhost`, `127.0.0.1`, `[::1]`, or `file:`) it uses
`http://127.0.0.1:8787` and fixture mode.

## What `/health` exposes

`/health` is public. Caddy proxies it with no authentication, so anyone can
read it. It returns `publicConfig()` from `media-lens/worker/config.js`:

- mode, the configured live flags, and the current kill-switch state
- whether a kill file and a URL allowlist are configured (not the hostnames)
- every numeric limit (analyses per minute, live URL rates, Jev call cap,
  timeouts, fetch caps)
- the Jev model id and whether a key is present (never the key)
- whether Newsjack artifacts are configured
- classifier.dev settings and host
- the ESTIMATED budget rate, warn and stop thresholds, and the budget file path
- the alert recipient email address, which is already published in
  `media-lens/README.md` and Issue #118, whether an alert credential is
  configured, and the transport label

It does not return key values, credential contents, allowlist hostnames, or
the month's spend. On ml-jev, `alert.credentialConfigured: true` does not mean
alerts work: delivery from that host failed and the owner waived email alerts
(Issue #118, 2026-09-21 PT).

## Release procedure

Run these on `ml-jev` as an operator with sudo. Never print
`/etc/media-lens/worker.env` or credential files. Post the evidence to Issue
#118 without secrets, article text, or credentialed URLs.

### Before

1. Record the running state.

   ```sh
   git -C /opt/media-lens/app rev-parse HEAD        # PREVIOUS_SHA, write it down
   git -C /opt/media-lens/app status --porcelain    # must print nothing
   sudo md5sum /etc/media-lens/worker.env           # hash only
   curl -fsS https://ml-jev.manipulationscore.com/health
   ```

2. Confirm which checkout the worker runs from.

   ```sh
   systemctl cat media-lens-worker | grep -E '^(ExecStart|WorkingDirectory|User|EnvironmentFile)='
   ```

   `ExecStart` or `WorkingDirectory` must point into `/opt/media-lens/app`.
   If the worker runs from another path, stop. Checking out a new commit would
   change the UI but not the running worker.

3. Confirm Python 3.12 or newer and the pinned Trafilatura are on the worker
   `PATH`. This prints only `PATH`, not the rest of the worker environment.

   ```sh
   PID=$(systemctl show -p MainPID --value media-lens-worker)
   WORKER_USER=$(systemctl show -p User --value media-lens-worker); WORKER_USER=${WORKER_USER:-root}
   WORKER_PATH=$(sudo cat "/proc/$PID/environ" | tr '\0' '\n' | sed -n 's/^PATH=//p')
   sudo -u "$WORKER_USER" env PATH="$WORKER_PATH" python3 -c 'import sys, trafilatura, py3langid; print(sys.version.split()[0], trafilatura.__version__)'
   ```

   Expect Python 3.12 or newer and Trafilatura `2.2.0`. If this fails, stop.
   Installing the virtualenv (`media-lens/worker/trafilatura/install.sh
   /opt/media-lens/trafilatura-venv`) and adding its `bin` to the unit `PATH`
   is a host change. Record it on Issue #118 before continuing.

4. Check the ESTIMATED budget file. Its path is `typesafeBudget.storeFile` in
   `/health` (default `/var/lib/media-lens/typesafe-budget.json`).

   ```sh
   BUDGET=/var/lib/media-lens/typesafe-budget.json
   sudo -u "$WORKER_USER" test -w "$(dirname "$BUDGET")" && echo dir-writable
   sudo -u "$WORKER_USER" test -r "$BUDGET" -a -w "$BUDGET" && echo file-readable-writable
   sudo cat "$BUDGET"                                  # counts only
   sudo -u "$WORKER_USER" node -e '
   const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
   const ok = Object.keys(r).sort().join(",") === "calls,estimatedTokens,month,version,warnEmitted" &&
     r.version === 1 && /^\d{4}-\d{2}$/.test(r.month) &&
     Number.isInteger(r.calls) && r.calls >= 0 &&
     Number.isInteger(r.estimatedTokens) && r.estimatedTokens >= 0 &&
     typeof r.warnEmitted === "boolean";
   console.log(ok ? "budget-record-valid" : "budget-record-INVALID");' "$BUDGET"
   sudo ls -l "$BUDGET.lock" 2>/dev/null && echo LOCK-PRESENT
   ```

   - The directory must be writable by the worker user. The lock file, the
     temporary file, and the atomic rename all happen there.
   - A missing file is acceptable when the directory is writable. The worker
     creates it on the first recorded call.
   - If the file exists it must be readable and writable by the worker user and
     print `budget-record-valid`. This check mirrors
     `sanitizeBudgetStoreRecord` in `media-lens/worker/typesafe-budget-store.js`.
     After this release an unreadable or invalid record makes the worker refuse
     all live Jev with "The TypeSafe ESTIMATED budget record could not be read,
     so no live Jev analysis was performed." until it restarts with a valid
     file. A readable but unwritable file is worse: new calls stay in memory
     and the next read replaces them with the older count, so spend is
     undercounted. Do not hand-edit counts. Stop and record it on Issue #118.
   - `typesafe-budget.json.lock` should not exist while no analysis is
     running. A stale lock makes every budget write spin for about 7.6 s (200
     attempts) with the worker's event loop blocked, then give up and keep the
     calls in memory only. Remove a stale lock only while the worker is stopped
     (between `systemctl stop` and `systemctl start` in the deploy step), and
     record that you did.

5. No Caddy change is needed. `media-lens/deploy/Caddyfile` is unchanged since
   the deployed frontend commit `1d3f379`.

### Deploy

```sh
git -C /opt/media-lens/app fetch origin
git -C /opt/media-lens/app checkout --detach MERGED_SHA
git -C /opt/media-lens/app rev-parse HEAD        # must equal MERGED_SHA
sudo systemctl restart media-lens-worker
systemctl is-active media-lens-worker            # active
sudo md5sum /etc/media-lens/worker.env           # must equal the hash recorded before
```

Caddy serves the UI files from the checkout, so the new UI is live as soon as
the checkout changes. Restart the worker right away so the UI and worker
match.

### Verify

1. Health flags:

   ```sh
   curl -fsS https://ml-jev.manipulationscore.com/health
   ```

   Expect `"mode":"live"`, `"liveEnabled":true`, `"liveUrlEnabled":true`,
   `"killSwitch":false`, `"urlAllowlistConfigured":true`,
   `classifierDev.enabled` and `classifierDev.effectiveEnabled` false,
   `newsjack.artifactsConfigured` false, `jev.modelRequested` `jev-1.13.0`
   with `hasApiKey` true, `limits.maxAnalysesPerMinute` 5,
   `limits.perAnalysisTimeoutMs` 15000, and `typesafeBudget` warn 20 and
   stop 30.

2. UI returns 200:

   ```sh
   curl -sS -o /dev/null -w '%{http_code}\n' https://ml-jev.manipulationscore.com/media-lens/
   ```

3. The browser script has no key or Node environment access. This must print
   `0`:

   ```sh
   curl -fsS https://ml-jev.manipulationscore.com/media-lens/media-lens.js \
     | grep -c -E 'process\.env|TYPESAFE_API_KEY|Authorization|api\.typesafe\.ai|sk-[A-Za-z0-9]{16,}'
   ```

4. Paths that exist in the checkout, or must never be served, return 404.
   Every line must start with `404`:

   ```sh
   for p in /media-lens/worker/server.js /media-lens/worker/config.js /media-lens/README.md \
     /media-lens/fixtures/expected/synthetic-01-quoted-vs-authorial.graph.json \
     /media-lens/fixtures/articles/synthetic-01-quoted-vs-authorial.html \
     /docs/media-lens-ops-runbook-v2.md /tests/media-lens-ui.test.js \
     /.git/HEAD /.env /package.json; do
     printf '%s %s\n' "$(curl -sS -o /dev/null -w '%{http_code}' "https://ml-jev.manipulationscore.com$p")" "$p"
   done
   ```

   This replaces the earlier `/worker/server.js` probe. No file exists at that
   path under `/opt/media-lens/app`, so its 404 showed nothing about the
   boundary.

5. A fixture request on the live worker is rejected with no provider call:

   ```sh
   curl -sS -i -X POST https://ml-jev.manipulationscore.com/analyze \
     -H 'content-type: application/json' \
     --data '{"user_asserted_public":true,"mode":"fixture","fixture_id":"synthetic-01-quoted-vs-authorial"}'
   ```

   Expect HTTP 400 with `"error":"live_fixture_disabled"`. The worker writes
   no audit line for this rejection. Confirm there was no provider call:

   ```sh
   sudo journalctl -u media-lens-worker --since '-2 min' -o cat | grep '"event":"analyze_complete"'
   sudo cat "$BUDGET"
   ```

   Expect no `analyze_complete` line from this request and the same `calls`
   value as before. The probe uses one of the five analyses allowed per
   minute.

6. In a browser with the network panel open, load
   `https://ml-jev.manipulationscore.com/media-lens/`:
   - The URL entry comes first. There is no fixture story explorer or fixture
     catalog. The Coverage context section says coverage comparison is not
     live. The static sample card is labeled as a made-up example.
   - Load `https://ml-jev.manipulationscore.com/media-lens/#story=synthetic-02-syndicated-cluster`.
     Nothing opens, and there is no request to `/media-lens/fixtures/`.
   - The service status shows ready. Pasted text and classifier.dev are not
     offered.
   - Optional, owner's call: one analysis of an allowlisted URL confirms
     Trafilatura extraction on the host. It spends Jev calls. The 2026-09-21
     smoke on `https://en.wikipedia.org/wiki/Yes` used 133 calls, about $0.27
     at the ESTIMATED rate.

7. Kill switch. If `/health` shows `"killSwitchFileConfigured":true`:

   ```sh
   KILL=$(sudo sed -n 's/^MEDIA_LENS_KILL_SWITCH_FILE=//p' /etc/media-lens/worker.env)   # prints the path only
   sudo touch "$KILL"
   curl -sS -i -X POST https://ml-jev.manipulationscore.com/analyze \
     -H 'content-type: application/json' \
     --data '{"user_asserted_public":true,"mode":"url","url":"https://en.wikipedia.org/wiki/Yes"}'
   curl -fsS https://ml-jev.manipulationscore.com/health | grep -o '"killSwitch":[a-z]*'
   sudo rm "$KILL"
   curl -fsS https://ml-jev.manipulationscore.com/health | grep -o '"killSwitch":[a-z]*'
   ```

   Expect `503` with `"error":"live_killed"` (returned before the body is
   read, so nothing is fetched), then `"killSwitch":true`, then
   `"killSwitch":false` after clearing. If no kill file is configured, the
   only switch is `MEDIA_LENS_KILL_SWITCH=true` in `worker.env` plus a
   restart. That changes the env hash, so record the new hash.

### Rollback

```sh
git -C /opt/media-lens/app checkout --detach PREVIOUS_SHA
sudo systemctl restart media-lens-worker
sudo md5sum /etc/media-lens/worker.env           # unchanged
curl -fsS https://ml-jev.manipulationscore.com/health
```

Caddy is unchanged, so there is nothing to roll back there. A commit from
before PR #146 accepts `mode: "fixture"` on a live worker and runs live Jev on
fixture articles without the allowlist. A commit from before PR #149 restarts
the month's count at zero when the budget file is unreadable. If you roll back
past either, assert the kill switch until a fixed commit is deployed again.

## Other deploys triggered by merging to main

Merging to `main` also starts two deploys. Neither one is an ml-jev deploy:
neither updates `/opt/media-lens/app` or restarts the worker.

- The `deploy` job in `.github/workflows/ci.yml` publishes the Clarity site to
  GitHub Pages through the allowlist in `scripts/build-pages-site.js`.
  `media-lens/`, `docs/`, and `tests/` are excluded. This release changes
  trust pages (privacy, limitations, acceptable use, methodology, changelog),
  so those change on manipulationscore.com when that job finishes.
- Vercel runs an automatic production build of the repository (project
  `manipulation-score`). That integration is configured in Vercel, not in
  this repository.

This procedure does not change live flags, the URL allowlist, `worker.env`,
credentials, or the Caddy site. Issue #118 stays open.
