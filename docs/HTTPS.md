# HTTPS enforcement

Public Beta requires every `http://` request to redirect to `https://manipulationscore.com/`.

## GitHub Pages

1. Open repository **Settings → Pages**.
2. Confirm custom domain `manipulationscore.com`.
3. Enable **Enforce HTTPS**.
4. Verify with: `curl -sI http://manipulationscore.com/ | head -5` — expect `301`, `302`, `307`, or `308` to HTTPS.

If apex HTTP still returns `200`, use Cloudflare (or similar) in front of GitHub Pages for redirect and response headers (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
