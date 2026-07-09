# ADR 0009 — Attestation strictness for rewired deployments (`attest`)

- **Status:** Accepted (2026-07-09; design phase — no code yet)
- **Date:** 2026-07-09
- **Deciders:** project author
- **Constitution touchpoints:** P13 (bake is the channel that inlines client config; the manifest
  declares targets explicitly), P17 (honest claims — a guarantee that is off by default must say
  so), P20 (wiring is deployment reality, never contract — which is exactly why wiring needs an
  attestation trail), P21 (secret laundering ban — manifest-invisible wiring is the laundering
  path this closes)
- **Related docs:** [`concepts/binding`](../../site/content/docs/concepts/binding.mdx)
  (app-wide transforms, the wiring digest),
  [`reference/api`](../../site/content/docs/reference/api.mdx) (`BindOptions.attest`,
  `BindOptions.transform`), [`reference/errors`](../../site/content/docs/reference/errors.mdx)
  (`WiringSkewError`), [`bake/overview`](../../site/content/docs/bake/overview.mdx) (the committed
  lockfile `config.manifest.lock.json`),
  [`reference/decisions`](../../site/content/docs/reference/decisions.mdx) §9 (this question),
  §10 (this pointer); resolves issue #29
- **Sibling of:** [ADR 0010](./0010-server-bake-target-semantics.md), decided in the same round —
  its two-tier trust story (untrusted client targets vs trusted servers) is the exact axis this
  decision cuts along. Mandatory attestation attaches to the trust boundary; the trusted server
  tier opts in. Neither ADR depends on the other's mechanism, only on the shared boundary.

> Engineering decision record, kept apart from the published design site. Records *why* and
> what it costs, not the final reference prose.

---

## Context

Wiring is deployment reality, not contract (P20): `env(tessera, "NAME")`, `chain(...)`, group
prefixes, and the app-wide `transform` option all change *where a value is read from* without
forking identity. The bake manifest declares the intended wiring, and `bake` records the
effective declared→effective map in a **committed lockfile** (`config.manifest.lock.json`) along
with a **wiring digest**.

That digest is only worth something if something *checks* it. The open question (§9): should a
production bind on a bake-covered target **require** the digest check — failing closed with
`WiringSkewError` when the composition root's effective wiring diverges from the committed
attestation — or is the check opt-in via `bind(..., { attest })` with a loud dev warning?

The stakes are concrete. Mandatory is the only thing that makes **manifest-invisible wiring**
truly unable to sneak past the manifest: a composition root that quietly re-points a tessera at a
different env name, after review, after the manifest was attested. The cost of mandatory is
coupling process boot to a committed artifact — a stale or missing lockfile stops the boot.

The registry recorded a lean ("mandatory for client-covered targets only") and one hard
constraint that is not up for debate: **the mechanism must be an explicit flag, never `NODE_ENV`
sniffing.** Environment-variable-shaped feature detection is exactly the ambient, implicit
behavior this library refuses everywhere else.

No spike: this is a default-posture and flag-shape decision, not a mechanics question. The digest
and lockfile already exist in the contract.

---

## Decision drivers

- **Put the hard guarantee where the trust boundary actually is.** Client artifacts are delivered
  to untrusted machines and are the target of the deny-by-default attestation, the secret-name
  bake gate, and the leak scan. A server's composition root is code the operator already owns,
  reviews, and deploys.
- **Coupling boot to a committed artifact is a real availability cost.** A server that will not
  start because a lockfile is stale is an outage. A *client build* that fails on the same
  divergence is a red CI job — the right place for that failure to land.
- **P17 — a guarantee that is off by default must say so, loudly.** If servers are opt-in, the
  docs must say the check is off unless asked for, and dev must warn.
- **No `NODE_ENV` sniffing (hard constraint).** Behavior must not change because of an ambient
  string. The client mandate must therefore key off something structural — *bake coverage* — not
  off "are we in production."
- **P21 — laundering.** Manifest-invisible wiring is a path for routing a secret onto a
  public-exposure name. `WiringExposureError` catches the exposure class; the digest catches the
  *divergence* class.

---

## Considered options

- **A. Mandatory everywhere** *(rejected)*. Every bake-covered target, client and server, fails
  closed on divergence. Strongest, and the only posture under which manifest-invisible wiring
  cannot sneak past the manifest anywhere. Rejected because it couples every server boot to a
  committed artifact: a stale lockfile becomes an outage, and servers are the tier that most often
  legitimately rewires per deployment (P20's whole point).
- **B. Mandatory for client-covered targets only; servers opt in via an explicit flag** *(chosen)*.
- **C. Opt-in everywhere** *(rejected)*. Lowest friction, but ships a core security guarantee in
  the off position. The deny-by-default client attestation would be undermined by a wiring layer
  that is checked only when asked — the manifest would attest to a wiring the running artifact
  need not honor. That is an overclaim (P17) in the one place the library sells safety hardest.

---

## Decision

Adopt **B**, as **D1–D4**.

### D1 — Client-covered targets: the digest check is **mandatory and always on**

Any bind that resolves a tessera belonging to a bake `client` target verifies the committed
lockfile's wiring digest against the composition root's effective wiring. Divergence is
`WiringSkewError`, **fail-closed, and not overridable** — there is no `attest: false` escape for a
client-covered target.

Crucially, this is keyed off **bake coverage**, a structural fact recorded in the artifact and the
lockfile — *not* off "is this production." So there is no `NODE_ENV` sniffing anywhere: the check
is simply always on wherever a client target is covered, in dev and in prod alike. In dev,
`bake --watch` regenerates the digest as you edit, so the check is satisfied by the normal loop
rather than by an exemption.

### D2 — Server targets: opt-in via an explicit `attest` bind option

```ts
bind(serverTesserae, { attest: true });   // verify the committed wiring digest; WiringSkewError on divergence
```

`attest?: boolean`, default **`false`** for server targets. It is a plain, explicit flag. It never
consults `NODE_ENV`, and the flag does not govern the client mandate (D1) — passing `attest: false`
alongside a client-covered tessera does not disable anything.

Operators who want the strict posture set `attest: true` at their composition root; operators who
promote one binary across environments with legitimately differing wiring leave it off and lean on
`tessellum bake --check` in CI instead.

### D3 — A loud dev warning when a bake-covered server target binds without `attest`

If a bind resolves tesserae covered by a bake `server` target and `attest` is not set, dev mode
emits a named warning naming the risk and the one-line fix. It is a **dev-mode** warning (the same
dev-only branch ADR 0003 uses for the client hash check) and is stripped from production builds —
a warning that fires on every prod boot is a warning nobody reads.

### D4 — The honest boundary, stated in the docs

Because servers are opt-in, **manifest-invisible wiring on a server is possible by default**. The
docs say exactly that, in the same breath as the guarantee (P17). The mitigations are named:
`tessellum bake --check` in a zero-credential CI job catches divergence before deploy, the dev
warning catches it locally, and `attest: true` closes it at boot for operators who want boot
coupled to the attestation.

---

## Consequences

**Positive**

- The hard, unoverridable guarantee sits exactly at the trust boundary: the artifact delivered to
  untrusted machines cannot honor a wiring the manifest never attested.
- No `NODE_ENV` sniffing anywhere — the mandate keys off bake coverage, a structural fact.
- Server boot is not coupled to a committed lockfile unless the operator asks for it, so a stale
  lockfile is a red CI job rather than an outage.
- `attest` is one boolean with one meaning; there is no strictness ladder to misconfigure.

**Negative / costs**

- **Manifest-invisible server wiring is possible by default.** This is the real cost of B over A,
  and it is written into the docs rather than hidden. `bake --check` + the dev warning are the
  mitigations; neither is a boot-time guarantee.
- **Two postures to explain.** A reader must learn that client is mandatory and server is opt-in.
  Mitigated by tying it to the trust boundary, which is the same line ADR 0010 draws.
- **`attest: true` couples that server's boot to the committed artifact** — the cost of A, now
  opt-in and chosen deliberately.

**Security posture**

- The deny-by-default client attestation is now actually load-bearing: a client-covered target's
  effective wiring must match the committed digest, always, with no flag to turn it off.
- The laundering path P21 bans is closed on the client tier by construction and on the server tier
  by `bake --check` plus opt-in boot enforcement. `WiringExposureError` still independently refuses
  a secret routed onto a public-exposure name, regardless of `attest`.

---

## Scope — what this ADR is *not*

- **Not a change to what the digest covers.** It covers declared→effective wiring including
  bind-site `transform` restatements, exactly as before.
- **Not `NODE_ENV`-dependent, ever.** No posture in this ADR reads an ambient environment string
  to decide whether to enforce.
- **Not a replacement for `bake --check`.** CI drift-gating remains the primary control; `attest`
  is the boot-time backstop for operators who want it.
- **Not a strictness ladder.** `attest` is a boolean. If a "warn-only" server mode is ever wanted,
  it is a new, separately-argued option — not an overload of this one.
