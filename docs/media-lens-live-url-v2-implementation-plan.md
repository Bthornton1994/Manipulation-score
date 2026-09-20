# Media Lens Live URL v2 — implementation plan

Status: **plan only**. Companion to `docs/media-lens-live-url-v2-architecture.md`. Does not authorize live enablement, production claims, or secrets in git.

| Field | Value |
| --- | --- |
| Workstream | [Issue #118](https://github.com/Bthornton1994/Manipulation-score/issues/118) |
| Phase 0 foundation | PR #117 merged to `main` at `9cca5648c41410631b11605a538200cd28fce04a` (frozen pre-merge head `a1e7e4a1e28fab15a3988ac794379bd85fed9141`). Do not amend, rebase, or rewrite that history. |
| This document | Phase 1: design + plan. Code changes for live fetch belong in **later** PRs listed below. |
| Pages | `docs/` remains excluded from the GitHub Pages allowlist. |

Where this plan and the architecture disagree, the architecture wins. Where either disagrees with `VISION.md` or `docs/media-lens-build-brief.md`, stop and ask the owner.

---

## 1. How to use this plan

Work Issue #118 as a sequence of **small PRs**, each fail-closed, each leaving live URL **disabled by default**. Do not bundle security fetch, Jev pin verification, product UI, and public privacy copy in one PR.

Definition of done for **Issue #118** is not "tests pass." It is: every acceptance gate below evidenced at an **exact commit**, plus explicit owner authorization for live enablement. Until that authorization, Media Lens v1 remains fixture/local-only and unreleased.

Live pasted-text stays disabled unless a **separate** owner authorization exists. This plan never implements `MEDIA_LENS_ENABLE_LIVE_PASTED=true` behavior.

---

## 2. PR boundaries (hard)

| Allowed in a PR | Not allowed in the same PR |
| --- | --- |
| Address classification + pinning + adversarial SSRF tests | Product UI copy that advertises live URL as available |
| Parser/content-type limits | Pages allowlist expansion |
| Kill switch / audit redaction | Public `privacy.html` / `methodology.html` rewrite (blocked on C1 + gates) |
| Isolated Jev pin verification notes and optional non-default CI job | Turning default `MEDIA_LENS_MODE` to `live` |
| Schema-additive fields with validator tests | Fusion that sets `claims.support` from Jev |
| Fixture HTML for adversarial network tests | Real API keys, `.env`, recorded secrets |

Additional rules:

- **Security fetch PR ≠ UI PR.** Reviewers must be able to read `safe-fetch` / pin client diffs without a visual redesign.
- **Jev verification PR ≠ Pages/public-claim PR.**
- **Enablement PR** (if it ever exists) contains only flag defaults/docs after gates, not new fetch logic.
- Do not modify protected PR #117 history. Branch from current `main`.
- Do not claim `READY_TO_MERGE` for live mode. Draft is acceptable for implementation PRs until the owner says otherwise; **this Phase 1 PR stays draft**.

---

## 3. Mapping to Issue #118 required work

Issue #118 numbered items → plan phases / PRs.

| #118 item | Phase | PR slice (name) | Notes |
| --- | --- | --- | --- |
| 1. Verify pinned TypeSafe `jev-1.13.0` in an isolated test environment | 4 | `jev-pin-verify` | Not CI-default. No accuracy claim. |
| 2. Connect-time destination pinning | 2 | `fetch-pin` | Replaces check-then-`fetch(hostname)` |
| 3. NAT64, SIIT, IPv4-compatible `::/96`, mapped/canonical forms | 2 | `fetch-classify` then `fetch-pin` | Explicit disposition table in architecture §6 |
| 4. Fail-closed malformed / ambiguous / private / loopback / link-local / multicast / benchmark / metadata | 2 | `fetch-classify` | Includes mixed public+private DNS |
| 5. Redirect-by-redirect validation and re-resolution | 2 | `fetch-pin` | Plus https→http deny |
| 6. Request limits, timeout, retry cancel, response size, content-type, parser limits | 3 | `fetch-limits` | Some timeouts already exist; close gaps |
| 7. Adversarial tests (DNS rebind, redirects, IPv6, numeric IP, proxy, reuse) | 2–3 | tests in those PRs | Fixture catalog in §6 |
| 8. Feature flag, audit events, rate limits, kill switch, monitoring, incident response | 5 | `ops-controls` | Architecture §§15–20 |
| 9. Independent security review before any live enablement | 7 | out-of-repo review | Gate, not a code PR |
| 10. Public documentation only after live mode passed release gates | 9 | `public-docs` | Blocked on C1 and owner |

---

## 4. Phased order

### Phase 1 — Design (this PR)

**Deliverables:** this file and `docs/media-lens-live-url-v2-architecture.md`. Tests only to lock Pages exclusion and "no production-ready claim / no secrets in these docs."

**Exit:** draft PR against `main`, linked to Issue #118. No live-mode behavior change.

### Phase 2 — Address policy + pinning (implementation, still disabled)

Split if the diff is large:

1. **`fetch-classify` PR** — extend `safe-fetch.js` classification to architecture §6 (NAT64, SIIT, `::/96`, 6to4, Teredo block, multicast, metadata IPv6, strict IPv4 literals). No connect-time pin yet. Live URL still off. Tests: table-driven addresses.
2. **`fetch-pin` PR** — pinned HTTP(S) client (§7), `remoteAddress` check, manual redirects with re-pin, ignore `HTTP_PROXY`, no keep-alive reuse, `https`→`http` deny. Introduce `MEDIA_LENS_ENABLE_LIVE_URL` (default unset) so existing live-mode **fixture** tests against mock Jev keep working without opening URL fetch. Adversarial DNS-rebind tests: mock lookup that would return a different IP on a second call; prove the client never performs that second call.

**Exit:** all new tests green on Node 20 (CI) and Node 22 locally if available. `MEDIA_LENS_ENABLE_LIVE_URL` still not set in CI. README residual-risk paragraph replaced with "pinning implemented; live URL still disabled; not production-ready."

### Phase 3 — Content gates and resource limits

**`fetch-limits` PR:** content-type allowlist, incremental decode cap, tokenizer/nesting limits, concurrent fetch = 1, per-eTLD+1 rate limit, connection-reuse tests, proxy-env sink test if not already in Phase 2.

**Exit:** hostile HTML/gzip fixtures do not exceed caps; non-HTML types abstain or 400 as specified.

### Phase 4 — Isolated Jev `jev-1.13.0` verification

**`jev-pin-verify`:** a script or optional workflow that:

- Runs only when `MEDIA_LENS_JEV_VERIFY=true` and a key is supplied via the runner secret store (never committed).
- Sends `model: "jev-1.13.0"` with a **synthetic, non-sensitive** state (the existing fixture span texts are invented; do not send scraped news).
- Asserts `response.model === "jev-1.13.0"`.
- Asserts answers match the typed shape; extra keys ignored; out-of-taxonomy would be rejected by the adapter (can also POST a mock).
- Records the commit SHA, timestamp, and pass/fail in a **local** or CI artifact, not in `docs/` as an accuracy claim.
- If the API rejects the versioned id: **fail the gate**. Do not fall back to `jev-latest`.

CI default remains fixture-only (`tests/media-lens-jev-adapter.test.js` mock server).

**Exit:** a recorded verification at an exact commit that the pinned id is accepted and echoed. Still not a quality study.

### Phase 5 — Ops: flags, kill switch, audit, rates

**`ops-controls` PR:** `MEDIA_LENS_KILL_SWITCH` / kill file, per-request re-check, JSON audit lines with redaction tests, `/health` still secret-free, incident section in `media-lens/README.md` pointing at architecture §20 (do not paste secrets). Canary allowlist env.

**Exit:** tests flip kill switch and prove URL fetch and live Jev do not run. Redaction tests fail if span text or `sk-` keys appear in a captured log helper.

### Phase 6 — Privacy / consent (owner-gated)

Not started until C1 is answered.

- If owner chooses **(a)** scope `privacy.html` sentences to Clarity: draft copy in a **separate** PR, still without enablement.
- If owner chooses **(b)** keep v1 local-only forever until a later issue: stop live URL work after Phase 5–7 evidence and leave flags off.

Consent UI already exists on `media-lens/index.html` (not on Pages). Live URL disclosure must name origin fetch vs Jev as two events when URL is actually enabled (Phase 9 or enablement PR). Do not update public legal pages in the fetch PRs.

### Phase 7 — Independent security review

Out of repo. Reviewer receives: architecture, this plan, Phase 2–5 diffs, adversarial fixture list, exact commit SHA. Scope: SSRF, rebinding, redirects, IPv6 embeddings, proxy, pinning, key handling, concept-collapse / prompt injection.

**Exit:** written review. Open findings → fix PRs → re-review of those diffs. This issue does not close on "we asked someone."

### Phase 8 — Canary, rollback drill, owner authorization packet

Operator-run worker. Not Pages.

Canary packet (written, committed as ops notes under `docs/` only if they contain **no** secrets and **no** production claims):

- Commit SHA
- Flag set used
- Allowlist hosts
- Kill-switch drill evidence (command + HTTP status)
- Pin logs showing `PIN_MISMATCH` test injected in staging
- Jev `model_match` on pin verify
- Statement: **not production-ready**

Rollback: architecture §20. Practice `touch` kill file.

### Phase 9 — Public documentation and possible enablement

Only after gates in §5. Separate PR. May update `privacy.html`, `methodology.html`, `limitations.html`, `changelog.html` to describe **exactly** the enabled scope. Must not claim fact-checking, outlet safety, or representative accuracy.

Enablement (if the owner authorizes it) is a distinct, minimal change: documented flags for operator-run workers. Default in the repository remains fixture unless the owner explicitly asks to change defaults — **this plan recommends defaults stay off even after a successful canary.**

---

## 5. Acceptance gates (Issue #118) — evidence required

Live URL may be considered for **production review** only when all of the following are demonstrated at an exact commit. This Phase 1 PR satisfies none of them except "a design exists."

| Gate | Evidence |
| --- | --- |
| TypeSafe integration verified against pinned `jev-1.13.0` | Phase 4 log: request model, reported model, SHA |
| Connect-time IP pinning and redirect validation implemented and regression-tested | Phase 2 tests including rebind mock and redirect-to-metadata |
| IPv4, IPv6, mapped, canonicalized, NAT64, SIIT, IPv4-compatible cases have explicit tested dispositions | Table-driven tests matching architecture §6 |
| SSRF and DNS-rebinding adversarial tests pass | §6 catalog green |
| Resource, timeout, retry, and cancellation limits tested | Existing H2/N2 plus Phase 3 |
| Privacy, consent, and retention decisions approved | Owner record for C1 + live URL disclosure |
| Independent security and QA review passes | Phase 7 written review |
| Canary plan, rollback plan, and owner authorization exist | Phase 8 packet + explicit authorization |
| Public claims accurately describe the enabled scope | Phase 9 copy review; no overclaim |

---

## 6. Test plan

### 6.1 General rules

- Runner: `node --test tests/*.test.js` (CI Node 20).
- New files: `tests/media-lens-ssrf-*.test.js` (or extend `tests/media-lens-security-hardening.test.js` if still readable).
- No real cloud-metadata calls. Use mocked `lookup` / pinned client / loopback sinks.
- Do not treat TEST-NET (`203.0.113.0/24`) as blocked; it is the public stand-in.
- Live URL default-off tests must remain green without keys.

### 6.2 Adversarial fixture catalog (minimum)

Each row: construct input, expect code, no connect to a blocked address (assert `fetchImpl` / socket factory never called with that address, or `lookup` not called a second time).

#### URL parse / exotic IPv4

| Id | Input | Expect |
| --- | --- | --- |
| `ipv4-octal` | `http://0177.0.0.1/` | `BAD_URL` or `BLOCKED_HOST` before connect |
| `ipv4-hex` | `http://0x7f.0.0.1/` | same |
| `ipv4-decimal` | `http://2130706433/` | same |
| `ipv4-short` | `http://127.1/` | same |
| `ipv4-userinfo` | `http://127.0.0.1#@203.0.113.7/` and `http://foo@127.0.0.1/` | reject userinfo / blocked host (cover parser tricks) |
| `scheme-file` | `file:///etc/passwd` | `BAD_SCHEME`, fetch not called |
| `scheme-gopher` | `gopher://203.0.113.7/` | `BAD_SCHEME` |

#### IPv4 policy

| Id | Address | Expect |
| --- | --- | --- |
| `loopback` | `127.0.0.1` | block |
| `rfc1918-10` | `10.0.0.5` | block |
| `rfc1918-172` | `172.16.1.1` | block |
| `rfc1918-192` | `192.168.1.1` | block |
| `link-local-imds` | `169.254.169.254` | block |
| `ecs-metadata` | `169.254.170.2` | block |
| `cgnat` | `100.64.0.1` | block |
| `benchmark` | `198.18.0.1` | block |
| `multicast` | `224.0.0.1` | block |
| `reserved` | `240.0.0.1` | block |
| `this-network` | `0.0.0.0` | block |
| `test-net` | `203.0.113.7` | allow_public (classifier) |

#### IPv6 / embeddings

Deprecated site-local `fec0::/10` (RFC 3879) and retired 6bone `3ffe::/16` are **block** before connect. Empty canary allowlist still applies public-address policy only; a non-empty DNS allowlist still fail-closes these IP literals.

| Id | Address | Expect |
| --- | --- | --- |
| `v6-loopback-br` | `[::1]` | block |
| `v6-unspec` | `::` | block |
| `v6-lla` | `fe80::1` | block |
| `v6-site-local` | `fec0::1` | block |
| `v6-site-local-end` | `feff::1` | block |
| `v6-6bone` | `3ffe::1` | block |
| `v6-6bone-end` | `3ffe:ffff::1` | block |
| `v6-ula` | `fd12:3456:789a::1` | block |
| `v6-multicast` | `ff02::1` | block |
| `v6-doc` | `2001:db8::1` | block |
| `mapped-dotted` | `::ffff:127.0.0.1` | block (IPv4 policy) |
| `mapped-hex` | `::ffff:7f00:1` | block |
| `mapped-expanded` | `0:0:0:0:0:ffff:7f00:1` | block |
| `mapped-imds-hex` | `::ffff:a9fe:a9fe` | block |
| `mapped-public` | `::ffff:203.0.113.7` | allow_public |
| `siit-loopback` | `::ffff:0:7f00:1` | block |
| `siit-imds` | `::ffff:0:a9fe:a9fe` | block |
| `nat64-wk-loopback` | `64:ff9b::7f00:1` | block |
| `nat64-wk-imds` | `64:ff9b::a9fe:a9fe` | block |
| `nat64-wk-public` | `64:ff9b::cb00:7107` (`203.0.113.7`) | allow_public |
| `nat64-local-public` | `64:ff9b:1:cb00:71:700::` | block (extra prefix) |
| `nat64-extra-sparse-loopback` | `2001:470:1::7f00:1` | block |
| `nat64-extra-sparse-public` | `2001:470:1::cb00:7107` | allow_public (native unicast) |
| `nat64-extra-nonzero-64-95-loopback` | `2001:67c:27e4:64:ff:9b:7f00:1` | block |
| `nat64-extra-nonzero-64-95-imds` | `2606:4700:4700:1:2:3:a9fe:a9fe` | block |
| `nat64-extra-nonzero-64-95-rfc1918-10` | `2001:470:1:2:3:4:a00:1` | block |
| `nat64-extra-nonzero-64-95-rfc1918-192` | `2a00:1450:4001:80e:1:2:c0a8:101` | block |
| `nat64-extra-nonzero-64-95-public` | `2001:67c:27e4:64:ff:9b:cb00:7107` | allow_public (native unicast) |
| `cloudflare-aaaa-public-last32` | `2606:4700:10::6814:179a` | allow_public (native unicast) |
| `isatap-loopback` | `2001:470:1:2:0:5efe:7f00:1` | block |
| `isatap-rfc1918-dotted` | `2001:470:1:2:0:5efe:10.0.0.1` | block |
| `isatap-public` | `2001:470:1:2:0:5efe:cb00:7107` | block |
| `compat-96-loopback` | `::7f00:1` | block |
| `compat-96-dotted` | `::127.0.0.1` | block |
| `6to4-loopback` | `2002:7f00:0001::` | block |
| `teredo` | `2001:0:53aa:64c::` (any `2001:0::/32`) | block |
| `aws-v6-imds` | `fd00:ec2::254` | block |
| `unparsable-mapped` | `::ffff:not-valid` | block |

#### DNS / rebinding / dual-stack

| Id | Mock lookup sequence | Expect |
| --- | --- | --- |
| `rebind-ttl` | first call `203.0.113.7`, second call `127.0.0.1` | pin client never issues second lookup; connect only to first pin **or**, if policy requires single-shot all-addresses, only one lookup occurs |
| `mixed-public-private-a` | `[203.0.113.7, 10.0.0.1]` | `BLOCKED_HOST`, no connect |
| `mixed-aaaa-ula` | A `203.0.113.7`, AAAA `fd00::1` | `BLOCKED_HOST` |
| `mixed-aaaa-site-local` | A `203.0.113.7`, AAAA `fec0::1` | `BLOCKED_HOST` |
| `mixed-aaaa-6bone` | A `203.0.113.7`, AAAA `3ffe::1` | `BLOCKED_HOST` |
| `mixed-aaaa-cloudflare-public-last32` | A `93.184.216.34`, AAAA `2606:4700:10::6814:179a` | pin succeeds; not `BLOCKED_HOST` |
| `empty-dns` | `[]` | `DNS_ERROR` |
| `localhost-name` | `localhost` | `BLOCKED_HOST` no lookup required |
| `mdns` | `printer.local` | `BLOCKED_HOST` |
| `metadata-google` | `metadata.google.internal` | `BLOCKED_HOST` |

For `rebind-ttl`, the **normative** architecture is: one lookup, classify all, pin one IP, `lookup` override returns only that IP. A second DNS answer must be irrelevant. The test should wrap DNS and fail if it is called twice for the hop.

#### Redirects

| Id | Scenario | Expect |
| --- | --- | --- |
| `redir-imds` | `203.0.113.7` → `http://169.254.169.254/` | `BLOCKED_HOST` before second connect |
| `redir-v6-loopback` | → `http://[::1]/` | `BLOCKED_HOST` |
| `redir-site-local` | → `http://[fec0::1]/` | `BLOCKED_HOST` before second connect |
| `redir-6bone` | → `http://[3ffe::1]/` | `BLOCKED_HOST` before second connect |
| `redir-nat64-private` | → `http://[64:ff9b::7f00:1]/` | `BLOCKED_HOST` |
| `redir-nat64-extra` | → `http://[2001:470:1::7f00:1]/` | `BLOCKED_HOST` before second connect |
| `redir-nat64-extra-nonzero-64-95` | → `http://[2001:67c:27e4:64:ff:9b:7f00:1]/` | `BLOCKED_HOST` before second connect; lookups=0 |
| `redir-isatap` | → `http://[2001:470:1:2:0:5efe:7f00:1]/` | `BLOCKED_HOST` before second connect |
| `redir-mapped-hex` | → `http://[::ffff:7f00:1]/` | `BLOCKED_HOST` |
| `redir-downgrade` | `https://203.0.113.7/` → `http://203.0.113.8/` | `REDIRECT_DOWNGRADE` |
| `redir-relative` | `Location: /next` then still public | followed with re-pin of same host |
| `redir-allowlist-relative` | allowlisted host, `Location: /next` | followed; hop host remains allowlisted |
| `redir-off-allowlist` | allowlisted initial → `http://other.example/` | `live_url_not_allowlisted` before second connect; hop must not return 200 |
| `redir-protocol-relative` | `Location: //127.0.0.1/x` | `BLOCKED_HOST` |
| `redir-missing-location` | 302 no header | `FETCH_ERROR` |
| `redir-loop` | 4 hops | `TOO_MANY_REDIRECTS` |
| `redir-multi-location` | two Location headers | fail closed |

#### Proxy / reuse

| Id | Scenario | Expect |
| --- | --- | --- |
| `env-http-proxy` | `HTTP_PROXY=http://127.0.0.1:9` | article client does not connect to `:9` |
| `reuse-cross-host` | two analyses different hosts | no shared socket |
| `reuse-redirect` | hop1 host A, hop2 host B | new pin, no reused TLS session across hostnames |

#### Content / limits

| Id | Scenario | Expect |
| --- | --- | --- |
| `type-json` | `Content-Type: application/json` | reject / abstain, not prepared as article |
| `gzip-bomb` | tiny gzip expanding past 2 MiB | `TOO_LARGE` |
| `html-nest` | nesting > 64 | `oversized_input` |
| `timeout` | hang without abort | `TIMEOUT` within bound (existing H2) |
| `cancel-jev` | analysis timeout | no further Jev HTTP (existing N2) |

### 6.3 Jev verification plan (Phase 4)

1. Isolated env (developer machine or a **non-default** CI job with secrets).
2. Synthetic spans from `media-lens/fixtures/articles/` only.
3. Assert pin: requested and reported `jev-1.13.0` (TypeSafe models page, 2026-09-19: versioned ids are accepted; `jev-latest` currently aliases `jev-1.13.0` and can move — we still send the versioned id).
4. Adapter rejects out-of-taxonomy (existing H1) — keep that test; do not weaken it.
5. Optionally compare live answers to fixture answers as a **diagnostic diff**, stored off-repo or as a non-claiming CI artifact. Do not update golden graphs from a single live run without a human review, and never describe agreement as accuracy.
6. Token budget: confirm request size for max span (1200+400+400 + question JSON) stays under documented 32k state budget.
7. Failure injection: `401`, `422`, `429`, `529`, malformed JSON, missing `answers`, `model: "jev-9.9.9"`.

### 6.4 Privacy / consent tests (keep + extend)

Existing: `tests/media-lens-privacy.test.js`, isolation, no-secrets, live pasted-text 400.

Extend when URL flags land:

- Live URL without `MEDIA_LENS_ENABLE_LIVE_URL=true` → 400, no DNS.
- Kill switch → 503, no DNS.
- Logs helper never contains span text or keys.
- Pages build still excludes `docs/` and `media-lens/`.

### 6.5 Ops / canary tests

- Rate limit still 429 before 413 (L6).
- Per-host limit once implemented.
- Kill file: create temp file, request, unlink.
- `/health` JSON has no `secrets` object and no bearer strings.
- Canary/kill-switch **drill packet** (`docs/media-lens-canary-drill-v1.md`, Issue #118 E) stays docs-only: operator-run flag set, hop-scoped allowlist, kill-file `503 live_killed` / `verify_kill_switch`, rollback, evidence template. Fixture tests lock the checklist. The packet does not authorize live enablement and does **not** grant `READY_FOR_CANARY`.

### 6.6 Concept-separation tests

Add (can be a small Phase 1.5 or with any fusion change):

- Graph fixtures cannot contain keys matching `potential_manipulation` or `propaganda_score`.
- Fusion unit test: Jev choice cannot write `claims.support`.
- UI test: still exactly the four section headings; banned phrases include `propaganda` in user-facing strings.

### 6.7 Clarity regression

Every Media Lens PR runs the full `tests/*.test.js` glob so Clarity scoring/safety/privacy tests remain the gate.

---

## 7. Implementation notes for later authors

### 7.1 Pin client (zero new npm dependencies)

Prefer `node:https` / `node:http` `request` with custom `lookup` returning the pin. Node 20 in CI. Do not add `undici` as a package; it is already built into Node if a dispatcher is required, but HTTP/1.1 + `lookup` is easier to audit.

Do not call `globalThis.fetch(userUrl)`.

### 7.2 Flag introduction order

Add `MEDIA_LENS_ENABLE_LIVE_URL` **before** or **in** the pin PR, default off, so even a mistaken `MODE=live` used by mock-Jev tests cannot fetch the network. Today `preparePayload` fetches whenever `mode === 'url'` and worker mode is live — that is too coarse for Issue #118.

### 7.3 Schema

Stay on `influence-graph.v1` until an additive field is necessary. Validator remains hand-written (`schema/validate.js`), no AJV dependency.

### 7.4 UI

No live-URL advertising on the public site. Local `media-lens/index.html` already warns that live URL is experimental and not production-ready. When pinning lands, update that local notice to say pinning is required and still not production-ready — in the **UI PR**, not the fetch PR, unless it is a one-line honesty fix.

### 7.5 Secrets

`.env` stays gitignored. No keys in fixtures. `tests/media-lens-no-secrets.test.js` should include the new architecture docs in the "docs may name env vars but not key values" list (Phase 1 does this).

---

## 8. Suggested PR title/body checklist (later PRs)

Each implementation PR body should include:

- Link to Issue #118
- Exact HEAD SHA after push
- "Live URL remains disabled by default. Live pasted-text remains disabled. Not production-ready."
- Test commands and pass counts
- Whether Pages allowlist is unchanged (must be)
- Which architecture sections were implemented
- What is explicitly **not** in the PR

---

## 9. Out of scope until a later issue

- Hosted multi-tenant worker
- Newsjack CLI spawn / Medialyst
- Fact-check support values other than `not_checked`
- Third-party outlet ratings
- Non-English live extraction quality
- Browser extension
- Changing Clarity
- Rewriting `VISION.md`

---

## 10. Phase 1 PR contents (this change)

| Path | Role |
| --- | --- |
| `docs/media-lens-live-url-v2-architecture.md` | Design |
| `docs/media-lens-live-url-v2-implementation-plan.md` | This plan |
| `tests/pages-artifact-boundary.test.js` | Assert new docs are not published |
| `tests/media-lens-no-secrets.test.js` | Scan new docs for key-shaped strings |
| `tests/media-lens-live-url-v2-docs.test.js` | Docs exist, name Issue #118, refuse production-ready claims, keep concept names distinct |

No changes under `media-lens/worker/` in Phase 1.
)
