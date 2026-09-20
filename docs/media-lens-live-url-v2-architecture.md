# Media Lens Live URL v2 — architecture

Status: **design artifact only**. Not an implementation. Not a release. Not production-ready.

| Field | Value |
| --- | --- |
| Workstream | [Issue #118](https://github.com/Bthornton1994/Manipulation-score/issues/118) |
| Phase | 1 of Live URL v2 (design + implementation plan). No live-mode code in this document's PR. |
| Foundation | PR #117 fixture-only merge on `main`: squash `9cca5648c41410631b11605a538200cd28fce04a`. Pre-merge frozen head `a1e7e4a1e28fab15a3988ac794379bd85fed9141`. Do not rewrite that history. |
| Default posture | Live URL **disabled**. Live pasted-text **disabled** unless separately authorized. Fail closed. No secrets in the repository. |
| Public site | GitHub Pages remains Clarity-only. `docs/` and `media-lens/` stay off the Pages allowlist. |
| Authority order | `VISION.md` > `docs/media-lens-build-brief.md` > this document > `docs/media-lens-influence-graph-plan.md` (Phase 0). If this document and the brief disagree, stop and ask the owner. If the brief and `VISION.md` disagree, stop and ask the owner. |

This document specifies how a future live-URL path **must** work if it is ever implemented. It does not authorize enablement, deployment, public advertising, or a production-readiness claim. Issue #118 is complete only when its security, privacy, operational, integration, and release gates are evidenced **and** an owner explicitly authorizes live enablement.

---

## 1. Vision classification

Section names refer to `VISION.md`.

| Proposal | Classification | `VISION.md` section |
| --- | --- | --- |
| Design a fail-closed live URL fetch for **public** artifacts, disabled by default | Aligns with constraints | "Privacy is the default architecture"; "Scope and non-goals" (other artifacts allowed if evidence, uncertainty, consent, privacy, and human authority are preserved) |
| Keep Clarity private messages on-device; never send them to Jev, Newsjack, or a URL fetch | Aligns | "Privacy is the default architecture" |
| Connect-time destination pinning, redirect re-validation, IPv6 embedding policy | Aligns | "Misuse resistance is a product requirement" |
| Typed Jev contract with abstain / needs_review / unreviewed / unavailable; no free-form as truth | Aligns with constraints | "The responsibility we own"; "Uncertainty must be visible" |
| Keep factual verification, source perspective, coverage, omission, language, persuasion, "potential manipulation", and uncertainty as **separate concepts** | Aligns | "Evidence comes before a score"; "Analyze communication, not identity"; "The responsibility we own" (does not determine truth, intent, or character) |
| No article/outlet/person score, rank, or leaderboard | Aligns | "Evidence comes before a score"; "Misuse resistance" |
| Live pasted-text remains disabled | Aligns with constraints | "Privacy is the default architecture" (safer alternative until a separate authorization) |
| Operator-run worker holding keys; prepared public span text to TypeSafe Jev only after explicit live opt-in | Aligns with constraints | "Privacy is the default architecture" (benefit, consent, minimization, retention, safer fixture alternative) |
| Docs-only Phase 1 PR; no live enablement; no public production claims | Aligns | Draft posture; "Uncertainty must be visible" (do not overstate) |
| Hosting the worker on GitHub Pages or shipping keys in the browser | Conflicts | "Privacy is the default architecture"; keys and network must stay off the public static site |
| Collapsing concepts into a single "manipulation", "propaganda", or factuality verdict | Conflicts | "The responsibility we own"; "Analyze communication, not identity"; brief hard bans |
| Claiming real-world accuracy from fixture or adversarial tests | Conflicts | "Uncertainty must be visible" (regression is not representative validation) |

Residual tensions (not conflicts; already recorded in Phase 0):

- **T1** — `VISION.md` "Who we serve" rejects spectator scoring of public figures. Media Lens may be pointed at speeches and campaign pages. Mitigation: artifact-level output only, no person field, banned UI phrases, no score. Owner should keep confirming this reading before any public live mode.
- **T2** — acceptable-use permission to review. Public URLs are readable by design; paywalled bodies abstain. Consent checkbox records the user's assertion; it is not legal advice.
- **C1** (Phase 0, still open) — `privacy.html` Summary / How analysis works sentences are written as universal Clarity facts. Live URL that sends prepared public text to TypeSafe would make those sentences false unless they are scoped to Clarity **before** any public live claim. This Phase 1 PR does not edit `privacy.html`. Live enablement remains blocked on that owner decision plus Issue #118's other gates.

---

## 2. What v1 already is, and what v2 must add

v1 (PR #117, unreleased, fixture/local-only) already has:

- A loopback Node worker (`media-lens/worker/`) that owns keys, limits, and fusion.
- `influence-graph.v1` with Language, Claims, Coverage, and Source context kept separate.
- Jev adapter: fixture mode in CI; live HTTP client behind `MEDIA_LENS_MODE=live` + `MEDIA_LENS_ENABLE_LIVE=true` + `MEDIA_LENS_TYPESAFE_API_KEY`, pinned request model `jev-1.13.0`, typed answer validation, retries, abort-on-timeout.
- `safe-fetch.js`: http(s) only; manual redirects (max 3); DNS lookup then block loopback/private/link-local/ULA/mapped-IPv6; size and timeout caps.
- Live pasted-text rejected before any external request.
- Pages allowlist: Clarity site files only (`scripts/build-pages-site.js`).

v1 residual risks that Issue #118 treats as **release blockers** for live URL:

1. **DNS rebinding TOCTOU.** `assertHostIsPublic` resolves, then `fetch()` resolves again at connect time. A short-TTL record can answer public on the check and private/metadata on the connect. Documented in `media-lens/README.md`; not mitigated.
2. **Incomplete IPv4-in-IPv6 policy.** Mapped `::ffff:0:0/96` is classified. NAT64 `64:ff9b::/96`, SIIT `::ffff:0:0:0/96`, deprecated IPv4-compatible `::/96`, 6to4, Teredo, multicast, and several metadata IPv6 addresses are not.
3. **No connect-time pin.** The TCP/TLS stack is free to use any address `getaddrinfo` returns, including Happy Eyeballs dual-stack races.
4. **Proxy and connection reuse** are unspecified. `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`, keep-alive pools, and HTTP/2 connection coalescing can bypass a hostname check.
5. **Content-type and parser resource limits** for live HTML are weaker than the threat (compression bombs, huge DOMs, non-HTML bodies).
6. **Jev pin vs TypeSafe aliases.** Docs at `docs.typesafe.ai` (read 2026-09-19) say versioned ids such as `jev-1.13.0` are accepted and that `jev-latest` currently points at `jev-1.13.0` but **will move**. Isolated verification of the pinned id against the real API is still a gate, not a completed fact.
7. **Live URL is reachable whenever live mode starts**, with no dedicated URL kill switch distinct from "live mode used by tests against a mock Jev."

v2 architecture is the contract that closes those gaps **in later implementation PRs**, still without turning live URL on by default.

---

## 3. Goals and non-goals

### 3.1 Goals (when later implemented)

- Fetch **one** user-supplied http(s) URL of public material through a worker the user or operator runs.
- Guarantee the bytes read come from a destination that passed a **public-address policy at connect time**, not only at a prior DNS lookup.
- Extract article-like HTML into the existing preparation layer; produce `influence-graph.v1` (or a strictly additive, validated successor) without collapsing the concept namespaces in §11.
- Send Jev only **typed** questions and accept only **typed** answers. Code owns workflow, thresholds, and display.
- Fail closed on ambiguous, private, loopback, link-local, deprecated site-local (`fec0::/10`), multicast, benchmark, metadata, unparsable, or policy-unknown destinations.
- Stay disabled by default; remain abortable via kill switch; leave a rollback path that does not require rewriting git history.

### 3.2 Non-goals (this workstream and any implementation derived from it)

- Production enablement, GitHub Pages hosting of Media Lens, or public advertising of live URL.
- Live pasted-text analysis.
- Browser-side fetch of the article or of TypeSafe.
- Secrets, API keys, or `.env` files in git.
- A 0–100 article score, outlet rank, journalist rank, person label, or share card.
- Fact-checking as a product claim. `claims[].support` stays `not_checked` unless a later, separately authorized evidence path exists.
- Paywall bypass, AMP/cache mirrors, cookie jars, authenticated fetches, or "reader mode" that circumvents access control.
- Spawning Newsjack, calling Medialyst, or treating Newsjack/Jev output as product truth.
- Changing Clarity scoring, safety, methodology, or message handling.
- Autonomous crawling, link spidering, or bulk URL intake.
- Claiming sensitivity, specificity, fairness, or real-world accuracy.

---

## 4. Request and data flow

### 4.1 Actors and processes

```
User browser                 Operator/user machine              External (untrusted)           External (typed classifier)
─────────────                ─────────────────────              ──────────────────             ──────────────────────────
media-lens/index.html   -->  worker :127.0.0.1:8787
  (loopback only)              POST /analyze
                               |-- fixture: disk only -------------------------------------> (none)
                               |-- live URL (all flags): 
                               |     validate URL
                               |     resolve DNS
                               |     classify every address
                               |     PIN one public address
                               |     TCP/TLS to PINNED IP
                               |     Host/SNI = original hostname
                               |     redirects: full re-validate + re-pin
                               |     cap bytes / time / type
                               |     prepare.js (no JS exec)
                               |-- live Jev (if enabled):
                               |     typed POST /v1/systemone  ----------------------------> api.typesafe.ai
                               |     validate answers against taxonomy
                               |-- Newsjack artifacts (optional, local dir)
                               |-- fuse + validate schema
                               |-- never persist full text
<-- influence-graph.v1 JSON ---+
```

Clarity (`analyze.html`, `app.js`, `scoring.js`) is not on this diagram. Isolation tests already forbid imports either way. Live URL must not add a Clarity network path.

### 4.2 `/analyze` sequence for `mode: "url"` (normative)

1. **Kill switch** — if asserted, return `503` with `error: live_killed` and do not read the body beyond the existing rate-limit check. See §16.
2. **Feature flags** — URL fetch proceeds only when **all** of the following hold. Otherwise `400` with a specific error code, no DNS, no connect:
   - `MEDIA_LENS_MODE=live`
   - `MEDIA_LENS_ENABLE_LIVE=true` (exact string)
   - `MEDIA_LENS_ENABLE_LIVE_URL=true` (exact string; **new**, default unset/false)
   - `MEDIA_LENS_TYPESAFE_API_KEY` present (live worker still requires the key to *start*, even if this particular request will abstain on Jev failure)
   - `MEDIA_LENS_ENABLE_LIVE_PASTED` is **not** required and must not be implemented as `true` in this workstream
3. **Consent** — `user_asserted_public === true`. Else `400 consent_required`.
4. **Rate limit** — before body read (existing L6). Additional host-level limit after the URL is parsed, before DNS. See §15.
5. **Safe fetch** — §5–§9. On policy denial: `400` with a stable `error` code (`BLOCKED_HOST`, `BAD_URL`, `BAD_SCHEME`, …). On timeout / transport / too many redirects: HTTP 200 abstention graph `engine_unavailable` (existing prepare-failure policy). On oversized body: `413`.
6. **Prepare** — `prepare.js` on the fetched HTML only. No additional subresource fetch.
7. **Jev + Newsjack + fusion + schema validate-or-abstain** — existing pipeline. Invalid graphs are discarded (H1).
8. **Response** — in-memory JSON. No disk write of article text. Evidence-only export remains a client-side choice.

### 4.3 Data in motion (minimization)

| Hop | Data | Allowed? |
| --- | --- | --- |
| Browser → worker | URL string, `user_asserted_public`, `consent_at`, `kind` | Yes, loopback |
| Browser → worker | Pasted article text in live mode | **No** (disabled) |
| Browser → TypeSafe | anything | **No** |
| Worker → target origin | HTTP GET, no cookies, no `Authorization`, no userinfo | Yes, if pin passed |
| Worker → target origin | request body, WebSocket, CONNECT | **No** |
| Worker → TypeSafe | `state` with capped `span.text` + neighbor context; static questions | Yes, live Jev only |
| Worker → TypeSafe | full HTML, cookies, API keys in `state`, Clarity messages | **No** |
| Worker → disk | full article, spans, graph (default) | **No** (`privacy.full_text_persisted: false`, `retention: "none"`) |
| Worker logs | article text, query strings, `Authorization`, key values | **No** |

### 4.4 Trust boundaries

Labelled T0–T5 for the threat model in §18.

| Id | Boundary | Trust |
| --- | --- | --- |
| T0 | User's intent vs browser DOM | Page is untrusted HTML we ship; CSP limits connects to loopback worker |
| T1 | Browser ↔ worker | Loopback origin allowlist; no cookies; CORS reflects only `localhost` / `127.0.0.1` |
| T2 | Worker ↔ DNS resolver | DNS is **untrusted**. Answers may lie, rebind, or dual-home public+private |
| T3 | Worker ↔ TCP/TLS peer | Peer is **untrusted**. Pin IP; verify cert against hostname; cap resources |
| T4 | Prepared text ↔ Jev | Article text is **data**, never instructions. Answers are **untrusted** until schema-checked |
| T5 | Fusion ↔ user | Graph is the only UI truth. No hidden aggregate. Abstention is first-class |

---

## 5. URL validation and DNS resolution

### 5.1 Parse

1. Reject non-strings, empty strings, and strings with leading/trailing C0 control characters.
2. Parse with the WHATWG `URL` constructor. On throw: `BAD_URL`.
3. After parse, **reject userinfo** (`username` or `password` non-empty): `BAD_URL`. Userinfo is an SSRF and credential-leak primitive (`http://foo@127.0.0.1/`, `http://127.0.0.1#@public.example/`).
4. Scheme must be `http:` or `https:`. Else `BAD_SCHEME`. `javascript:`, `file:`, `data:`, `blob:`, `gopher:`, `ws:`, `wss:`, `ftp:`, `unix:` are denied before DNS.
5. Reject `#` fragment as a fetch input difference: fragments are not sent, but the stored artifact URL should be the pre-fragment form.
6. Reject URLs whose host is empty.

### 5.2 Host syntax (strict)

After WHATWG parse, `hostname` must match **exactly one** of:

- **DNS name:** IDNA ASCII form matching `^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` plus the special-use reject list below. Require at least one dot (no single-label hosts except those already denied as `localhost`).
- **IPv4:** four decimal octets `0-255` with no leading zeros (`127.0.0.1` yes; `0177.0.0.1`, `127.1`, `2130706433`, `0x7f.0.0.1` no).
- **IPv6:** WHATWG bracketed form whose unbracketed value canonicalizes under RFC 5952 **and** then passes §6 classification.

Anything else — including mixed hex/octal/decimal IPv4, fewer than four IPv4 octets, integer hosts, zone IDs (`fe80::1%eth0`), and unbracketed IPv6 in the host field — is `BAD_URL` / `BLOCKED_HOST` (fail closed). Do not rely on the stack to "helpfully" canonicalize exotic forms into loopback.

**Special-use and metadata hostnames (deny, no DNS required):** `localhost`, `localhost.localdomain`, `*.localhost` (RFC 6761), `*.local` (mDNS), `metadata.google.internal`, `metadata.internal`, `instance-data`, and any hostname that is exactly an IPv4/IPv6 literal already classified as blocked.

### 5.3 DNS resolution

- Resolver: `dns.promises.lookup(hostname, { all: true, verbatim: true })` as the **policy** view of what a subsequent connect *could* use, plus explicit `resolve4` / `resolve6` when implementing pinning tests so A and AAAA are both visible.
- Empty answer: `DNS_ERROR` (fail closed).
- Lookup throw: `DNS_ERROR`.
- **If any address in the answer set is blocked or unclassifiable, deny the host** (`BLOCKED_HOST`). Do not "skip" the private record and connect to a sibling public record. Dual-homed public+private DNS is a classic rebinding/SSRF pattern.
- Do not follow CNAME to a second policy check that ignores the final A/AAAA set; classify **leaf addresses only**.
- Do not cache DNS across analyses in v2. A process-wide cache recreates TOCTOU.

DNS is not trusted to stay still. Pinning (§6–§7) is what makes a later connect safe.

---

## 6. Address classification (normative dispositions)

Every resolved or literal address is classified as `allow_public` or `block`. Unparsable is `block`. These dispositions must have fixtures (see the implementation plan).

### 6.1 IPv4

| Range / form | Disposition | Notes |
| --- | --- | --- |
| Unparsable | block | Fail closed |
| Exotic forms (octal, hex, decimal host, 127.1) | block at URL parse | Never reach connect |
| `0.0.0.0/8` | block | This network |
| `10.0.0.0/8` | block | RFC 1918 |
| `100.64.0.0/10` | block | CGNAT; also some cloud metadata-adjacent addressing |
| `127.0.0.0/8` | block | Loopback |
| `169.254.0.0/16` | block | Link-local; includes `169.254.169.254` and `169.254.170.2` |
| `172.16.0.0/12` | block | RFC 1918 |
| `192.168.0.0/16` | block | RFC 1918 |
| `192.0.0.0/24` | block | IETF protocol assignments |
| `198.18.0.0/15` | block | Benchmarking |
| `224.0.0.0/4` | block | Multicast |
| `240.0.0.0/4` | block | Reserved |
| `255.255.255.255` | block | Broadcast |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | **allow_public** (classifier only) | TEST-NET. Not an SSRF interior target. Not a real article host. Tests use these as public stand-ins. Live TCP to them should fail harmlessly. |
| Other globally routed unicast | allow_public | Still subject to hostname and scheme policy |

### 6.2 IPv6 and IPv4-embedded forms

Extract an embedded IPv4 when the prefix is a **known embedding**. Apply the IPv4 table to that IPv4. If the embedding prefix is unknown, **block** (fail closed), except globally routed native IPv6 unicast that is not in a block range below.

| Form | Prefix / test | Disposition |
| --- | --- | --- |
| Unspecified | `::` | block |
| Loopback | `::1` | block |
| Link-local | `fe80::/10` | block |
| Deprecated site-local | `fec0::/10` (RFC 3879) | **block**. Not ULA and not `fe80::/10`. Fail closed before connect. |
| Unique local | `fc00::/7` | block |
| Multicast | `ff00::/8` | block |
| Documentation | `2001:db8::/32` | block |
| Discard | `100::/64` | block |
| IPv4-mapped | `::ffff:0:0/96` (e.g. `::ffff:127.0.0.1`, `::ffff:7f00:1`, expanded `0:0:0:0:0:ffff:7f00:1`) | extract IPv4 → IPv4 policy |
| SIIT IPv4-translated | `::ffff:0:0:0/96` (e.g. `::ffff:0:7f00:1`, `::ffff:0:127.0.0.1`) | extract IPv4 → IPv4 policy |
| NAT64 well-known | `64:ff9b::/96` (RFC 6052) | extract IPv4 → IPv4 policy. **This is the only NAT64 form that may be `allow_public`**, and only when that IPv4 is `allow_public`. |
| NAT64 extra prefixes | RFC 8215 local-use `64:ff9b:1::/48`; remainder of `64:ff9b::/32` | **block**. No extra-prefix allowlist env is implemented; fail closed. |
| Residual last-32 of a blocked IPv4 | bits 96–127 decode to an IPv4 whose first octet is not 0 **and** that IPv4 is blocked by the IPv4 table (private, loopback, metadata, CGNAT, multicast, reserved, …), sparse or with non-zero bits 64–95 | **block** as extra NAT64. Distinct from well-known `64:ff9b::/96`, mapped, SIIT, and ISATAP. |
| Residual last-32 of a public IPv4 | bits 96–127 decode to an IPv4 that is `allow_public` (for example Cloudflare `2606:4700:10::6814:179a` → `104.20.23.154`) | **allow_public** as native unicast. Not extra NAT64. First-octet-0 last-32 stays native. |
| ISATAP | IID `0000:5efe:IPv4` or `0200:5efe:IPv4` (RFC 5214), any unicast prefix | **block** (tunnel embedding; do not allow even if the embedded IPv4 is public) |
| IPv4-compatible (deprecated) | `::/96` excluding `::` and `::1` (e.g. `::7f00:1`, `::127.0.0.1`) | extract IPv4 → IPv4 policy |
| 6to4 | `2002::/16` | extract IPv4 from bits 16–47 → IPv4 policy |
| Retired 6bone | `3ffe::/16` (RFC 2471 / RFC 3701) | **block**. Not native unicast. Fail closed before connect. |
| Teredo | `2001:0::/32` | **block** (tunnel obfuscation; do not attempt to decode client IPv4 in v2) |
| AWS link-local metadata | `fd00:ec2::254` | block (ULA already blocked; name it in tests anyway) |
| Native global unicast otherwise | | allow_public |

Canonicalization: run every IPv6 literal through the same WHATWG `http://[addr]/` hostname path used in v1 R1, then classify the canonical form. Unparsable mapped values fail closed.

NAT64 / ISATAP worked examples (classifier only; live URL remains disabled):

| Id | Address | Disposition |
| --- | --- | --- |
| `nat64-wk-public` | `64:ff9b::cb00:7107` (`203.0.113.7`) | **allow_public** (well-known prefix, public IPv4) |
| `nat64-wk-loopback` | `64:ff9b::7f00:1` | block |
| `nat64-wk-imds` | `64:ff9b::a9fe:a9fe` | block |
| `nat64-local-public` | `64:ff9b:1:cb00:71:700::` | block (extra prefix) |
| `nat64-unknown-32` | `64:ff9b:2::1` | block |
| `nat64-extra-sparse-loopback` | `2001:470:1::7f00:1` | block |
| `nat64-extra-sparse-public` | `2001:470:1::cb00:7107` | **allow_public** (native unicast; last-32 public IPv4) |
| `nat64-extra-nonzero-64-95-loopback` | `2001:67c:27e4:64:ff:9b:7f00:1` | block |
| `nat64-extra-nonzero-64-95-imds` | `2606:4700:4700:1:2:3:a9fe:a9fe` | block |
| `nat64-extra-nonzero-64-95-rfc1918-10` | `2001:470:1:2:3:4:a00:1` | block |
| `nat64-extra-nonzero-64-95-rfc1918-192` | `2a00:1450:4001:80e:1:2:c0a8:101` | block |
| `nat64-extra-nonzero-64-95-public` | `2001:67c:27e4:64:ff:9b:cb00:7107` | **allow_public** (native unicast; last-32 public IPv4) |
| `cloudflare-aaaa-public-last32` | `2606:4700:10::6814:179a` (`104.20.23.154`) | **allow_public** (native unicast; not extra NAT64) |
| `isatap-loopback` | `2001:470:1:2:0:5efe:7f00:1` | block |
| `isatap-public` | `2001:470:1:2:0:5efe:cb00:7107` | block |
| `isatap-ulbit-imds` | `2001:470:1:2:200:5efe:a9fe:a9fe` | block |
| `v6-site-local` | `fec0::1` | block (RFC 3879 site-local) |
| `v6-site-local-end` | `feff::1` | block |
| `v6-6bone` | `3ffe::1` | block (retired 6bone) |
| `v6-6bone-end` | `3ffe:ffff::1` | block |

A residual last-32 whose decoded IPv4 is blocked by the IPv4 table is **block** as extra NAT64. A residual last-32 whose decoded IPv4 is public is native unicast `allow_public` (Cloudflare-style AAAA, including public TEST-NET last-32). Well-known `64:ff9b::/96` remains the only **NAT64** form that may be `allow_public`. Native unicast whose last 32 bits decode to an IPv4 in `0.0.0.0/8` (first octet 0) stays native (for example `2001:4860:4860::8888`). Deprecated site-local `fec0::/10` and retired 6bone `3ffe::/16` are **block** even when the last 32 bits look like a public IPv4. ISATAP, mapped, and SIIT are unchanged.

### 6.3 Ambiguous and dual-stack

- Mixed A (public) + AAAA (ULA/link-local/site-local/6bone): **block the host**.
- Mixed A (public) + AAAA (Cloudflare-style public last-32 native unicast): **allow**. Pin one public address. Not `BLOCKED_HOST` for address policy.
- Mixed A (private) + AAAA (global): **block the host**.
- Happy Eyeballs must not be allowed to pick a second address after policy. Pin **one** `allow_public` address chosen from an answer set that is **entirely** `allow_public`.
- Address family preference when both v4 and v6 are public: prefer IPv6, then IPv4. Document the choice in `engine` metadata (`pinned_family`) without logging the IP by default.

---

## 7. Connection establishment and connect-time destination pinning

This section is the DNS-rebinding mitigation required by Issue #118.

### 7.1 Invariant

> The TCP/TLS socket for an article fetch MUST be connected to an IP address that has already been classified `allow_public` for this hop. The stack MUST NOT perform a second DNS lookup for that hop. TLS SNI and certificate identity MUST use the original hostname, never the pinned IP.

If pinning cannot be implemented on the Node version in CI, live URL must remain disabled. Pinning is not an optional flag once URL fetch is on.

### 7.2 Algorithm (per hop)

1. Validate URL (§5).
2. If hostname is an IP literal: classify it; if block, stop; if allow, pin that literal.
3. If hostname is a DNS name: resolve (§5.3); classify every address; if any block/unknown, stop; pin one remaining `allow_public` address.
4. Open the transport:
   - **Node implementation (zero new dependencies):** `http.request` / `https.request` with a custom `lookup` function that returns only `{ address: pinnedIp, family }` and never calls `dns`. Alternatively `createConnection` to `net.connect({ host: pinnedIp, port })` / `tls.connect({ host: pinnedIp, port, servername: originalHostname })`.
   - `https`: `servername` = original hostname (SNI). `checkServerIdentity` = `tls.checkServerIdentity(originalHostname, cert)`. A mismatch is `TLS_ERROR` (fail closed). Do not set `rejectUnauthorized: false`.
   - HTTP `Host` header = original hostname, plus non-default port if present.
5. After `connect`, read `socket.remoteAddress` and `socket.remotePort`. If `remoteAddress` (normalized) ≠ pin, **abort** (`PIN_MISMATCH`). This catches unexpected NAT, dual-stack remap, and proxy injection.
6. Do not send cookies, `Authorization`, or stored credentials. Do not enable a cookie jar.
7. Method: `GET` only. No redirect-to-POST.
8. Timeouts: existing `urlFetchTimeoutMs` (default 8s) covers DNS + connect + headers + body. A separate connect timeout of 3s is recommended so a blackholed pin fails fast.

### 7.3 Why `fetch(url)` is insufficient

Undici/Node `fetch` will resolve the hostname again unless a custom dispatcher forces `lookup`. v1's `fetchImpl(currentUrl, { redirect: 'manual' })` is exactly the TOCTOU. v2's article client must not call global `fetch` on a user hostname.

Jev calls to `api.typesafe.ai` and evaluation-only classifier.dev `POST /v1/classify` are a **different** trust path (T4): they use a configured base URL, not user input. Live paths that actually call the network still use **connect-time destination pinning** (resolve DNS once, classify every address, pin one allowed IP, abort `PIN_MISMATCH` / `BLOCKED_HOST` on mismatch) and **do not follow redirects**. `MEDIA_LENS_TYPESAFE_BASE_URL` is an operator/test override; loopback HTTP is for mocks. classifier.dev production origin remains `https://classifier.dev` only (`/v1/classify`, model allowlist `jev-1.13.0`). This is not a production-readiness claim. Live URL remains disabled by default.

### 7.4 Connection reuse

- Default: **no keep-alive reuse across analyses**.
- Within a redirect chain, each hop is a new pin tuple `(scheme, hostname, pinnedIp, port)`. Do not reuse a socket from hop N on hop N+1.
- HTTP/2 connection coalescing across hostnames is forbidden. Prefer HTTP/1.1 for v2 article fetch to keep pin semantics obvious.
- TLS session tickets keyed only by pin tuple, never by "any host on this IP" (avoid coalescing `a.example` and `b.example` on the same CDN IP with a cert that happens to match).

### 7.5 Rebinding after pin

Once TCP is established to the pinned IP, DNS changes cannot retarget that socket. That is the control. Remaining residual: the pinned **public** IP may still be an attacker-controlled VPS that then serves HTML. That is in-scope as **malicious content**, not SSRF, and is handled by preparation hygiene, injection abstention, and Jev typed-output validation.

---

## 8. Redirect handling

Follow redirects **manually**. Never set `redirect: 'follow'`.

| Rule | Policy |
| --- | --- |
| Status codes | `301`, `302`, `303`, `307`, `308` only. Other 3xx: `FETCH_ERROR`. |
| `Location` missing or empty | `FETCH_ERROR` |
| Multiple `Location` headers | fail closed (`FETCH_ERROR`) |
| Relative `Location` | resolve against the **current hop URL** (not the original user URL only) |
| Protocol-relative `//host/path` | resolve scheme from current hop, then full validation |
| Max hops | 3 (existing `urlFetchMaxRedirects`). Exceeded: `TOO_MANY_REDIRECTS` → abstention graph |
| Each hop | full §5–§7 (scheme, userinfo, host syntax, DNS, classify all addresses, pin, connect-time check). If `MEDIA_LENS_URL_ALLOWLIST` is non-empty, the hop hostname must also match that exact-hostname canary list **before** pin/connect |
| `https` → `http` | **fail closed** (`REDIRECT_DOWNGRADE`). Strip of TLS is a class of attack, not a convenience |
| `http` → `https` | allowed if the new hop passes policy |
| Cross-host | allowed if the new host independently passes public-address policy **and** (when configured) the canary hostname allowlist. Off-list hops fail closed as `live_url_not_allowlisted` and must not return HTTP 200 from the hop |
| Cross-port | allowed if destination address still `allow_public` |
| Credentials | never forward. None were sent on hop 1 |
| Method | remain GET |
| HTML `<meta http-equiv="refresh">`, JS `location=`, `Refresh` header | **ignored**. Not HTTP redirects |
| `307/308` with body | article fetch has no body |

Redirect to a blocked address must fail as `BLOCKED_HOST` **before** connect, including when `Location` is an IP literal, mapped IPv6, NAT64 form, or metadata hostname.

Relative `Location` on the same allowlisted host remains allowed. A redirect from an allowlisted host to a different hostname that is not on `MEDIA_LENS_URL_ALLOWLIST` (for example `allowed.example` → `other.example`) is fail-closed. Empty allowlist remains "policy only" (public IPs); this check does not apply until the operator sets the canary list.

---

## 9. Proxy behavior

| Mechanism | v2 policy |
| --- | --- |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `http_proxy`, … | **Ignored by default.** Undici and some Node builds honor these and would send the user URL to an arbitrary forward proxy, defeating pinning. |
| Explicit operator proxy | Only if a future env such as `MEDIA_LENS_FETCH_PROXY` is designed, reviewed, and tested. Out of scope until then. If unset, the article client must use a code path that **does not** read the process proxy env. |
| SOCKS | Forbidden |
| `NO_PROXY` | Irrelevant if proxies are ignored |
| Reverse proxy in front of the worker | Operator concern. Worker still binds `127.0.0.1` by default. Binding `0.0.0.0` is an owner decision and an abuse amplifier; not part of v2 enablement |
| Worker as open proxy | Forbidden. The worker fetches **one** GET of an article URL for `/analyze`. It does not relay arbitrary methods, WebSockets, or CONNECT |

Implementation note: Node `fetch` may use environment proxies. The pinned client in §7 should be `http`/`https` with `lookup` override, `agent` constructed with `keepAlive: false`, and no `globalAgent` that has `process.env.HTTP_PROXY` applied. Tests must set `HTTP_PROXY` to a loopback sink and prove article fetch does **not** connect there.

---

## 10. Content extraction

### 10.1 Response gates (before `prepare.js`)

1. Status must be `200` for the final hop. Other 2xx: fail closed in v2 (`FETCH_ERROR`) except we may later allow `203`/`204` as abstention. `401`/`403`/`404`/`410`/`451` → abstention `engine_unavailable` or a dedicated `not_retrievable` reason (prefer adding `not_retrievable` in a schema-additive PR rather than overloading `engine_unavailable`).
2. `Content-Type` allowlist: `text/html`, `application/xhtml+xml`, and those types with a charset parameter. Missing content-type: treat as HTML only if the body starts with a doctype/`<html` sniff **and** is within the byte cap; otherwise fail closed.
3. Reject `application/json`, `text/csv`, `image/*`, `audio/*`, `video/*`, `application/pdf`, `application/octet-stream`, `text/xml` that is not XHTML, `multipart/*`, `text/event-stream`.
4. `Content-Encoding`: allow `identity`, `gzip`, `deflate`, `br` only with a **decoded** byte cap equal to `urlFetchMaxBytes` (2 MiB) and a compressed cap at the same budget (reject expansion bombs). Decode incrementally; abort when decoded bytes exceed the cap.
5. No following `Link` prefetch, no images, no stylesheets, no scripts, no iframes, no `srcset`.

### 10.2 Preparation (reuse `prepare.js`)

Existing behavior remains the contract:

- Strip `script`, `style`, `template`, comments, hidden nodes.
- Prefer `<article>` or the largest text-bearing block.
- Parse metadata (`og:title`, canonical, JSON-LD dates) with `JSON.parse` only — never `eval`.
- Paywall markers → graph-level `paywall` abstention. No cookie retry, no AMP, no cached Google/archive mirrors.
- Span roles assigned deterministically; Jev may only move `authorial` to `uncertain` on disagreement, never to `quoted`.
- Prompt-injection patterns remain data: they never enter question instructions.

Additional live-HTML limits (to implement in the security/fetch PR or a dedicated parser-limit PR):

| Limit | Initial value | On exceed |
| --- | --- | --- |
| Raw fetch bytes | 2 MiB | `TOO_LARGE` |
| Decoded bytes | 2 MiB | `TOO_LARGE` |
| Prepared text chars | 60_000 | abstention `oversized_input` |
| Spans | 200 | abstention `oversized_input` |
| Tokenizer tokens / DOM nodes | 50_000 | `oversized_input` |
| Max tag nesting | 64 | `oversized_input` |
| Entity expansion | reject recursive/nested entity bombs; HTML named entities only | fail closed |

English-only remains the v1 language scope (`en` or `und`). Unsupported language is already an abstention reason in the schema.

### 10.3 What extraction is not

Extraction is **not** factual verification, not source ownership research, and not a full DOM browser. It does not execute JavaScript, so client-rendered exclusive bodies look like paywalls or insufficient text — that is abstention, not a bypass target.

---

## 11. Concept separation (must not collapse)

These eight concepts must not collapse. They remain distinct product namespaces. Fusion, schema, UI, and any later Jev questions MUST NOT fold them into one score, one badge, or one sentence that treats one as proof of another.

1. Factual verification
2. Source perspective/ownership
3. Coverage differences
4. Omission
5. Emotional/coercive language
6. Propaganda/persuasion signals
7. Potential manipulation
8. Uncertainty and abstention

The word "propaganda" is banned in user-facing `ui_phrase` and `message` fields (existing invariant 7). This design document uses it only as the name of a **forbidden collapse**.

| Concept id | Meaning | Where it may appear | Where it must not appear |
| --- | --- | --- | --- |
| `factual_verification` | Whether a checkable claim is supported, contradicted, mixed, unclear, or not checked against evidence | `claims[].support` + `support_evidence[]` | Language observations; source_context; coverage frames; any "true/false news" label |
| `source_perspective_ownership` | Publisher metadata, byline as metadata, ownership/ratings if ever licensed | `source_context` only (`shown_separately: true`) | Fusion inputs to language signals; claims.support; person-level inference |
| `coverage_differences` | Different headline/lede **wording** across same-story cluster members | `coverage.frames[]` with `basis` `headline_wording` / `lede_wording` / `fixture` | Bias labels; "this outlet omitted the truth"; language taxonomy |
| `omission` | A detail present in one same-story account and absent in another; **candidate only** | `observations[]` with `signal: selective_context_candidate`, `strength: candidate`, dimension `coverage` | Jev-only answers; `factual_verification`; "they hid the truth" |
| `emotional_coercive_language` | Span-tied loaded, fear, urgency, identity, scapegoating, anecdote-generalization language | Language observations for that taxonomy subset | Proof of intent; proof of factual falsehood; outlet character |
| `propaganda_persuasion_signals` | Persuasion-adjacent **language** patterns (bandwagon, false dilemma, vague authority, certainty beyond evidence, adversarial framing). **Not** a "propaganda" product field | Those taxonomy ids as language observations | Any field named propaganda; aggregate persuasion score; person/outlet propaganda label |
| `potential_manipulation` | A human interpretation the software **does not emit** | Nowhere in the graph. No field, no UI phrase, no engine output | Entire product surface. Users may think it; Media Lens must not |
| `uncertainty_abstention` | Explicit non-claim when evidence, models, timestamps, or retrieval are insufficient | `abstentions[]`, `review_status`, `coverage.confidence`, `timestamp_precision: none` | Silent omission of a result the user might read as a clean bill of health |

**Collapse bans (testable):**

1. No function may accept two or more concept ids and return a single verdict enum.
2. No Jev question may ask "is this manipulative", "is this propaganda", "is this fake", or "how biased is this outlet".
3. `selective_context_candidate` remains `strength: "candidate"` and is never produced from a Jev answer alone (existing fusion rule).
4. `claims[].support` in this workstream remains `not_checked` unless evidence is supplied by a fixture or a later authorized path. Fusion must not set `supported` / `contradicted` from Jev.
5. `source_context.third_party_ratings` remains `[]` until a licensed source and a vision decision exist.
6. Forbidden graph keys still include score/rank/leaderboard/manipulat/trust/credib/reliab (existing invariant 7). Do not add `potential_manipulation` or `propaganda_score` as "honest" fields.
7. UI sections remain four: Language, Claims, Coverage, Source context. Do not add a fifth "Manipulation" or "Propaganda" panel.

Mapping from UI dimensions to concepts:

```
Language  --> emotional_coercive_language ∪ propaganda_persuasion_signals (as separate taxonomy ids, not fused)
Claims    --> factual_verification (default not_checked)
Coverage  --> coverage_differences ∪ omission (candidate) ∪ provenance/freshness
Source    --> source_perspective_ownership
Everywhere --> uncertainty_abstention
Never     --> potential_manipulation as an emitted field
```

---

## 12. Jev input/output contract

Jev is TypeSafe's System One model. Live docs (`https://docs.typesafe.ai`, read 2026-09-19) are the integration reference. Code still owns policy.

### 12.1 Pin

- Request `model: "jev-1.13.0"` (already `worker/adapters/jev.js` and `config.js`).
- Record `engine.jev.model_requested`, `model_reported`, `model_match`.
- If `model_reported !== "jev-1.13.0"`: `model_mismatch` abstention; every Jev-sourced observation `needs_review` (existing).
- Do **not** silently send `jev-latest` or `jev-preview`. TypeSafe documents that aliases move. If the real API rejects the versioned id, that is an Issue #118 verification failure, not a cue to unpin.
- Isolated verification of the real pin is a later phase (implementation plan). This design does not claim it has been done.

### 12.2 Input

Per span, one request, questions evaluated independently in parallel (TypeSafe contract):

```
state = {
  artifact: { kind, title },
  span: { id, role, text },          // text capped at 1200 chars
  context: { before, after }         // each capped at 400 chars
}
questions = influence-questions.v1   // static file; sha256 committed
```

Normative rules:

- Article text appears only in `state.span.text` and neighbor context. It MUST NOT be interpolated into `questions.*.instructions` or `criteria`.
- Question set is versioned: `media-lens/worker/jev/questions.v1.json` + `questions.v1.sha256`. Changing questions is a product change, not a silent live tweak.
- Do not add questions that implement a forbidden concept collapse (§11).
- Current v1 questions: `influence_signal` (choice over taxonomy + `none`) and `is_quoted_or_attributed` (noul). Live URL v2 keeps that set unless a later schema PR adds a **non-collapsing** question (for example a noul `is_checkable_claim` that only gates claim *candidate extraction*, never `support`).
- Credentials: `Authorization: Bearer` only in the worker. Never in browser JS, never in `/health`, never in logs.

### 12.3 Output — typed only

TypeSafe answers are `choice` | `noul` | `score` objects. Media Lens may consume:

| Field | Use |
| --- | --- |
| `influence_signal.choice` | Must be a taxonomy id or `none`. Else span failure |
| `influence_signal.probabilities` | Thresholds in fusion; values must be finite and in `[0,1]`; keys must be in the taxonomy ∪ `{none}` |
| `influence_signal.confidence` | Optional; if present, unit interval. Low confidence → candidate or abstain, never a stronger UI phrase |
| `is_quoted_or_attributed.noul` | May move role `authorial` → `uncertain` only |

**Forbidden as truth:** any free-form string, `rationale`, `explanation`, `reasoning`, extra JSON keys, markdown, or tool-call payload, even if a future API adds them. Unknown keys are ignored. Unknown types are span failures.

### 12.4 Span outcomes (code-owned)

Every span maps to exactly one of:

| Status | When | Graph effect |
| --- | --- | --- |
| `answered` | Valid typed answers, model match | Fusion may emit observations under §11 rules |
| `abstain` | Choice `none`, or below candidate threshold | No observation from Jev for that span |
| `needs_review` | Model mismatch, engine disagreement on quote role, prompt-injection pattern, borderline confidence policy | Observation if any is `needs_review` or omitted; abstention recorded |
| `unreviewed` | Jev failure rate ≥ 20% of calls | Strip Jev language observations; dimension-scoped `engine_failure` |
| `unavailable` | Timeout, HTTP 4xx/5xx after retries, transport error, kill switch, disabled, abort | Span `engine_failure` or graph `engine_unavailable`; **never invent a label** |

Retries: existing 4 attempts, exponential backoff, abort when the per-analysis signal fires (N2). Retry `429` and `5xx`/`529`. Do not retry `401`/`422`.

Jev is **not** an authority on intent, truth, outlet quality, people, or "manipulation." Typed output guarantees the interface, not correctness. Domain performance is unverified until a representative study exists; none is claimed here.

---

## 13. Article and claim representation

Live URL reuses `influence-graph.v1`. A v2 schema bump is **not** required to start fetch hardening. If a field is missing (for example `not_retrievable`, `pinned_family`), add it in a dedicated schema PR with validator + tests, additive and fail-closed.

### 13.1 Artifact

`artifact.input_mode: "url"` for this path. `url` is the user-supplied URL (userinfo stripped, fragment dropped). `canonical_url` comes from HTML/HTTP if present and is **metadata**, not an implicit second fetch. v2 must **not** automatically fetch `canonical_url` or `og:url` (open-redirect / SSRF via attacker HTML). If a later phase wants canonicalization fetch, it is a new hop under §5–§8 and a separate flag.

`text_sha256` hashes prepared text. `paywall_detected` forces abstention. `authorization.user_asserted_public` must be true.

### 13.2 Spans

Character offsets into prepared text. Roles: headline, subhead, authorial, quoted, attributed_paraphrase, caption, byline_meta, boilerplate, uncertain. Quoted spans never present as authorial language.

### 13.3 Claims

Candidates from deterministic triggers (numerals, dates, "according to", …). `support: "not_checked"` in this workstream. Non-`not_checked` requires `support_evidence[]` (schema invariant 3). Jev must not set support.

### 13.4 Coverage and source context

Unchanged from v1: Newsjack artifacts optional; freshness `fresh*` requires corroboration; source context shown separately with the literal note that it is not a manipulation judgment.

---

## 14. Evidence and provenance

Every language or coverage observation is either span-localized or an unlocalized **candidate**. Engine evidence records `{ engine, question_id, top_probability, answers_ref }`.

Provenance block (`engine`) already records pipeline version, Jev model pin/hash/call counts, Newsjack mode, fusion thresholds, timestamps.

Live URL v2 should add (schema-additive, later PR):

- `engine.fetch`: `{ hops, final_scheme, pinned_family, content_type, byte_length, redirect_downgrade_blocked }` with **no raw IP, no full URL query**.
- `privacy.external_processing` already records TypeSafe when Jev live calls occurred. Fetching the user URL is not "external processing by a vendor"; it is contacting the origin the user named. Disclose it in the UI notice: "The local worker will request this URL."

Export: `toEvidenceOnlyExport()` remains the persistence story. Default retention none.

Regression tests prove software consistency. They are **not** provenance that a live article was "verified."

---

## 15. Privacy, consent, and retention

### 15.1 Defaults

- No accounts.
- No Media Lens history.
- No full-text persistence.
- `privacy.retention: "none"`.
- Clarity messages never enter this worker.

### 15.2 Consent for live URL (when later enabled)

UI (existing page, not advertised on Pages) must, before submit:

1. State that Media Lens is for public material the user may analyze.
2. State that the worker will **make an HTTP request to the URL**.
3. State that prepared public span text may be sent to TypeSafe Jev when live Jev is on.
4. State that private messages belong in Clarity.
5. Require the per-session checkbox; send `user_asserted_public: true` and a well-formed `consent_at`.

Worker rejects missing consent. Live pasted-text remains disabled so a private message cannot be "accidentally" shipped as live URL-adjacent paste.

### 15.3 TypeSafe retention

TypeSafe public docs (2026-09-19) state Jev is not trained on customer requests; zero data retention is described as an **enterprise** option. Media Lens must **not** claim ZDR or TypeSafe-side deletion unless a contract says so. Disclose: "Prepared public spans may be processed by TypeSafe according to TypeSafe's own policy." Owner updates `privacy.html` only after C1 is resolved and Issue #118 privacy gate is approved.

### 15.4 Fetching a URL is not "the user's data to TypeSafe"

Two disclosures, kept separate:

- Origin contact: IP of the worker (usually the user's machine) becomes visible to the destination and its CDN.
- Jev: capped span text.

Do not imply that the destination site "analyzes" the user, or that TypeSafe fetches the URL.

---

## 16. Rate limits and abuse controls

Existing (keep):

- 512 KiB request body
- 10 analyses / minute / worker, checked before body read
- 200 spans, 60k prepared chars
- 8s Jev call, 30s analysis, 8s URL fetch, 2 MiB URL bytes, 3 redirects

Add before live URL enablement:

| Control | Initial contract |
| --- | --- |
| Per-destination-host analyses | 3 / minute / worker (eTLD+1 of the **user URL**, not of redirects — redirect storms still count as one analysis but hop-limited) |
| Concurrent URL fetches | 1 per worker (simplifies pin/reuse reasoning) |
| Bind address | Default `127.0.0.1`. Document that `0.0.0.0` makes the worker a network service and is out of scope for enablement |
| Fixture id | Already constrained to `^[a-z0-9-]+$` and known files (M1) |
| URL allowlist | Optional canary-only `MEDIA_LENS_URL_ALLOWLIST` (exact hostnames). Empty means "policy only" (public IPs). Canary should set an allowlist. When set, **every redirect hop** is re-validated against the list, not only the initial user URL |
| Bulk intake | No array of URLs. One URL per `/analyze` |

Abuse cases (product, not only network): automated scoring of named journalists, brigading, leaderboards. Acceptable-use already forbids these. Design does not add a public API on Pages that would make bulk abuse easy.

---

## 17. Logging and redaction

Default logs are **operational**, not content.

**Never log:** TypeSafe key, `Authorization`, cookie headers, article body, span text, prepared text, query string, userinfo, full URL with path+query (path can contain tokens), Clarity messages.

**May log (JSON line, no PII beyond what loopback already implies):** timestamp, `graph_id`, mode, `input_mode`, error code, hop count, scheme, eTLD+1 hostname, `pinned_family`, duration_ms, byte_length, jev calls/failures, `model_match`, kill-switch state, rate-limit hits.

**Debug (`MEDIA_LENS_DEBUG_NETWORK=true`):** may log classifier decision (`block_loopback`, `block_nat64_private`, …) and **not** interior RFC1918 literals by default (avoids leaking the operator LAN layout into shared logs). Owner-only local debugging may enable `MEDIA_LENS_DEBUG_PINNED_IP=true`; still never log bodies.

`/health` remains presence-booleans only (`publicConfig`).

Invalid graphs: existing `console.error` of validator errors must not dump span text. Implementation PRs should redact `errors` that embed sample strings from the graph.

---

## 18. Feature flags and kill switch

Fail closed. Unknown or misspelled values do not enable anything. Only the exact string `true` turns a flag on (existing pattern).

| Variable | Default | Effect |
| --- | --- | --- |
| `MEDIA_LENS_MODE` | `fixture` | `live` only if exact `live` |
| `MEDIA_LENS_ENABLE_LIVE` | unset | Required for worker to **start** in live mode |
| `MEDIA_LENS_ENABLE_LIVE_URL` | unset | Required **in addition** for `payload.mode === "url"` |
| `MEDIA_LENS_ENABLE_LIVE_PASTED` | unset | Must remain non-operative; pasted live stays rejected |
| `MEDIA_LENS_TYPESAFE_API_KEY` | unset | Required to start live mode; never logged |
| `MEDIA_LENS_TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | Test override |
| `MEDIA_LENS_KILL_SWITCH` | unset | If `true`, live URL fetch and live Jev calls fail closed immediately (worker may still serve fixture if mode is fixture; if mode is live, `/analyze` returns `503 live_killed`) |
| `MEDIA_LENS_KILL_SWITCH_FILE` | unset | If set and the file exists, same as kill switch (ops can `touch` a file without restarting env injection). A missing file does not assert. Permission, IO, and other `stat` errors fail-closed as asserted. |

`createServer()` already calls `assertLiveModeIsReady`. URL fetch must re-check kill switch and `ENABLE_LIVE_URL` inside `preparePayload`, not only at process start, so a flipped env/file can stop the next request after a documented reload strategy. File-based kill should be read per request or watched; at minimum per request `access()` is acceptable for v2.

There is no remote kill-switch SaaS. GitHub Pages cannot enable the worker.

---

## 19. Deployment topology

```
                    ┌─────────────────────────────────────────┐
                    │ GitHub Pages (production Clarity site)  │
                    │ allowlist: html/js/css/fonts/vendor     │
                    │ excluded: docs/, media-lens/, tests/    │
                    └─────────────────────────────────────────┘

fixture (CI + local default)
    worker MODE=fixture, no outbound article fetch, no Jev network

staging (operator machine / isolated env)
    live flags may be turned on for tests
    TypeSafe key from a secret store, not git
    mock or real Jev
    not linked from manipulationscore.com

canary (owner-operated, tiny)
    ENABLE_LIVE_URL=true, URL allowlist, kill switch rehearsed
    not a public product surface
    success criteria are safety/ops, not accuracy

production live URL
    not authorized by Issue #118 until every acceptance gate
    plus explicit owner enablement
    still would not ship the worker on Pages
```

The worker remains host-agnostic (`analyze()` is a pure pipeline). Moving it to a future server function is **out of scope** and would need a new privacy, tenant, and abuse review. This architecture does not pick Vercel/Cloudflare/Fly.

---

## 20. Rollback and incident response

### 20.1 Rollback (no history rewrite)

1. Set `MEDIA_LENS_KILL_SWITCH=true` or `touch` the kill file. Confirm `/analyze` URL returns `503` or fixture-only behavior.
2. Unset `MEDIA_LENS_ENABLE_LIVE_URL` and/or `MEDIA_LENS_ENABLE_LIVE`. Restart worker.
3. Revert the **implementation PR** on `main` with a forward fix or `git revert` of that PR's merge. Do not rebase or force-push PR #117 / `9cca564`.
4. Rotate `MEDIA_LENS_TYPESAFE_API_KEY` if logs or a proxy might have seen it.
5. Pages: if a mistaken allowlist change published `media-lens/` or `docs/`, revert `scripts/build-pages-site.js` and redeploy; treat as an incident even if the worker was not hosted there.

### 20.2 Incident classes

| Class | Immediate action |
| --- | --- |
| Suspected SSRF (metadata/LAN reached) | Kill switch; preserve redacted logs; do not paste bodies into tickets |
| Key leak | Rotate key; kill live; scan git history for the value (should be none) |
| Schema-invalid graphs reaching clients | Already validate-or-abstain; if bypassed, kill live Jev |
| Abuse (bulk scoring people) | Rate limit / bind localhost; acceptable-use enforcement is human |
| TypeSafe outage | Jev `unavailable` abstention; product stays up in degraded form |

Public communications must not claim that Media Lens "detected an attack" against a named outlet or person. Stick to operational facts.

### 20.3 Canary abort

If pinning tests fail, if any adversarial fixture fails, if `model_match` is false on the pinned id, or if Pages allowlist drifts, canary stops. That is not a production incident because production live URL is off.

Operator rehearsal steps, kill-file expectations, and the evidence template are in `docs/media-lens-canary-drill-v1.md` (Issue #118 E). That packet is **DRILL_PACKET_ONLY**: not production-ready, does not authorize live enablement, and does **not** grant `READY_FOR_CANARY`.

---

## 21. Threat model

### 21.1 Assets

- Operator TypeSafe API key
- User/operator loopback worker as a foothold into LAN / cloud metadata / Kubernetes
- Prepared article text (public but still not for indiscriminate logging)
- Product integrity: no person-level manipulation verdicts, no fake fact-checks
- Clarity private messages (must remain unreachable)
- Reputation and legal risk from over-claiming

### 21.2 Attacker goals

1. Turn `/analyze` into an SSRF oracle against `169.254.169.254`, `fd00:ec2::254`, RFC1918, link-local, or NAT64-mapped interiors.
2. DNS-rebind past a check-then-fetch gap.
3. Bounce through redirects, exotic IP literals, IPv6 embeddings, or proxies to the same interiors.
4. Use the worker as an open HTTP proxy (arbitrary method/host).
5. Compression/HTML bombs for DoS.
6. Prompt-inject Jev into emitting banned labels or setting `claims.support`.
7. Exfiltrate the API key via logs, `/health`, browser JS, or error messages.
8. Feed Clarity private text into live Jev (social-engineer the paste box — mitigated by live paste disable).
9. Ship a "manipulation score" of a journalist/outlet from graph fields that were never supposed to exist.
10. Trick Pages into publishing `media-lens/` or keys.

### 21.3 Abuse cases (product)

- Paste a rival's profile URL and screenshot Media Lens as "proof they are manipulative."
- Bulk-submit a newsroom roster.
- Treat `not_checked` claims as "unverified therefore false."
- Treat source_context metadata as a reliability rating.
- Treat omission candidates as demonstrated bad faith.

Mitigations: concept separation, banned phrases, no score, consent copy, acceptable-use, no public live surface in this phase.

### 21.4 Control mapping

| Attack | Control |
| --- | --- |
| SSRF / rebinding | Strict URL parse, classify all addresses, fail closed on mixed, connect-time pin, remoteAddress check, no `fetch(hostname)` |
| Redirect trampoline | Manual hops, full re-pin, https→http denied |
| Exotic IP / IPv6 embed | §6 table + fixtures |
| Env proxy | Ignore proxy env; test with `HTTP_PROXY` sink |
| DoS | Caps, parser limits, rate limits, concurrent fetch = 1 |
| Injection | Typed answers, static questions, fusion drop to candidate, validate-or-abstain |
| Key leak | gitignore `.env`, no-secrets tests, publicConfig, redaction |
| Concept collapse | §11 bans + schema forbidden keys |
| Pages leak | allowlist script + `tests/pages-artifact-boundary.test.js` |

### 21.5 Residual risk (accepted until enablement review)

- A public pinned IP can still serve hostile HTML (content risk, not SSRF).
- Operator who binds `0.0.0.0` and enables live URL exposes a networked fetcher.
- TypeSafe server-side retention is not under this repo's control.
- IDN homographs can fool **users**; they are not treated as SSRF if DNS is public.
- Fixture/adversarial tests are not a pentest substitute. Independent security review remains a gate.
- Custom NAT64 `/96` of an IPv4 in `0.0.0.0/8` (last 32 bits with first octet 0) remains indistinguishable from native last-hextet unicast and stays native. Native unicast whose last 32 bits decode to a **public** IPv4 is `allow_public` (Cloudflare AAAA false-positive fix). Last-32 embeddings of a **blocked** IPv4 remain fail-closed extra NAT64.

---

## 22. GitHub Pages allowlist (this PR)

`scripts/build-pages-site.js` copies only `PAGES_ROOT_FILES` and `PAGES_ROOT_DIRS` (`fonts`, `vendor`). `PAGES_FORBIDDEN_NAMES` includes `docs` and `media-lens`.

Therefore `docs/media-lens-live-url-v2-architecture.md` and `docs/media-lens-live-url-v2-implementation-plan.md` are **not** in the Pages artifact. CI uses this script rather than a repo-wide rsync. `tests/pages-artifact-boundary.test.js` must keep failing if `docs` is removed from the forbidden list or if these files appear in a built `_site`.

This Phase 1 PR must not add those files to `PAGES_ROOT_FILES`.

---

## 23. Open owner decisions (do not silently resolve)

1. **C1** privacy wording vs any future public live claim.
2. **T1** public-figure campaign/speech analysis without person scoring.
3. Whether canary uses a hostname allowlist.
4. Whether `canonical_url` may ever be fetched as a second hop.
5. Whether a later schema adds `not_retrievable` vs overloading `engine_unavailable`.
6. Hosting the worker anywhere other than loopback.
7. Live pasted-text (separate authorization; default remains disabled).
8. Independent security reviewer identity and scope.
9. TypeSafe contractual retention/ZDR if public live Jev is ever offered as a hosted service (not this issue's default architecture).

---

## 24. What this document does not do

- It does not enable live URL or live pasted-text.
- It does not change `safe-fetch.js`, worker flags, or UI.
- It does not declare Issue #118 done.
- It does not claim Jev-1.13.0 was verified against the production API in this phase.
- It does not authorize merge-to-production of live mode, a Pages change, or methodology accuracy claims.
)
