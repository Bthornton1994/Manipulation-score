# Media Lens frontend deployment

This is the deployment shape for the limited Jev-only Media Lens preview. It
keeps the browser page and the worker on the same origin, so the browser does
not need a broad cross-origin permission and the TypeSafe key stays on the
worker host.

## Route

The public preview route is:

`https://ml-jev.manipulationscore.com/media-lens/`

The root of the host remains an API route and may return `{"error":"not_found"}`.
The UI route is separate from Clarity and remains excluded from the GitHub
Pages artifact.

## Files and proxy boundary

Copy the approved repository checkout to `/opt/media-lens/app` on `ml-jev`.
Use [`media-lens/deploy/Caddyfile`](../media-lens/deploy/Caddyfile) as the
site configuration. It serves only:

- `media-lens/index.html`
- `media-lens/media-lens.js`
- `media-lens/media-lens.css`
- the shared `fonts.css`, `styles.css`, `icon.svg`, and `fonts/` assets

`/health` and `/analyze` proxy to the worker at `127.0.0.1:8787`. No worker
source, fixtures, tests, repository documentation, or credentials are served.

Article preparation needs the pinned Trafilatura virtualenv on the worker
`PATH`. This deployment does not install it. Run
`media-lens/worker/trafilatura/install.sh` on the host as documented in
`media-lens/worker/trafilatura/DEPS.md` before expecting extraction to succeed.

The page resolves its API base from the current origin on the live host. In a
local browser preview it continues to use `http://127.0.0.1:8787` and fixture
mode.

## Safe deployment checks

Before switching traffic, verify:

1. Confirm the checkout SHA through the host release check, then verify
   `curl -fsS https://ml-jev.manipulationscore.com/health` still reports the
   expected Jev-only flags.
2. `curl -I https://ml-jev.manipulationscore.com/media-lens/` returns the UI.
3. `curl -fsS https://ml-jev.manipulationscore.com/media-lens/media-lens.js`
   contains no provider key or Node environment access.
4. `curl -i https://ml-jev.manipulationscore.com/worker/server.js` returns
   `404`.
5. Open the UI, confirm the service status is ready, submit only an approved
   public URL, and confirm classifier.dev and pasted-text remain off.
6. Assert the kill switch returns `503 live_killed`, then clear it and confirm
   the UI reports service availability again.

This packet does not change live flags, the URL allowlist, the Pages artifact,
or the Issue #118 release gate. It only defines how to serve the already-built
frontend against the already-authorized worker.
