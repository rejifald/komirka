# ADR 0008 — Env-varying public values for build-once-promote-many SPAs

- **Status:** Accepted (2026-07-09; design phase — no code yet)
- **Date:** 2026-07-09
- **Deciders:** project author
- **Constitution touchpoints:** P5 (browser-first; sources are declared data refs, impls injected
  at bind), P6 (bundle-frugal — no new core surface without a case), P7 (fail-closed exposure;
  the browser entry ships **no secret-capable sources at all** — a structural guarantee, and the
  load-bearing one here), **P13 (bake is the only client delivery channel — narrowed by this ADR;
  see D5)**, P14 (bake never resolves secret values), P16 (config not state — a runtime-injected
  document is read once at boot and pinned, never watched), P17 (honest claims — both paths state
  their costs in the same breath)
- **Related docs:** [`guides/browser`](../../site/content/docs/guides/browser.mdx)
  ("Build once, promote many"), [`bake/overview`](../../site/content/docs/bake/overview.mdx),
  [`reference/decisions`](../../site/content/docs/reference/decisions.mdx) §2 (this question),
  §10 (this pointer), [`principles.md`](../../principles.md) P13 / §4 leak-vector table;
  resolves issue #28
- **Builds on:**
  - [ADR 0003](./0003-client-read-api-and-bake-staleness.md) — bake emits schema-free per-tessera
    *handles* and `StaleBakeError` is a **build-time** `bake --check` guarantee. D2 leans on that:
    a runtime-injected value is never baked, so it has no baked handle and no identity hash to
    skew — it cannot interact with `StaleBakeError` at all.
  - [ADR 0001](./0001-tessera-inheritance.md) — which named the "env-varying public link" as
    *inherited, not solved here*. This ADR is where it is solved.

> Engineering decision record, kept apart from the published design site. Records *why* and
> what it costs, not the final reference prose.

---

## Context

Bake inlines **public literal values** into the client artifact at build time. For secrets that
is a feature: bake never resolves secret values (P14), which is exactly what preserves
build-once-deploy-many on the server side. But *public* values are frozen at bake time, and a
team that builds **one immutable artifact and promotes it** staging → prod needs `API_BASE_URL`
to differ per environment **without a rebuild**.

`reference/decisions` §2 calls this "the predicted number-one GitHub issue," and
`guides/browser` has been carrying an explicit "Open decision: build once, promote many" section
that offers two honest-but-unsatisfying answers and then says a runtime-injected JSON mode "is
under consideration but not designed. It is an open decision, not a promised feature." That
sentence is what #28 asks us to delete — by deciding, not by hedging.

No spike was needed: this is a **shape and policy** question, not a mechanics one. The recipe
already composes from pieces the contract ships today — a `provider` source ref plus the async
pin (`await bind(entries).snapshot()`), which is exactly the async door ADR 0004/0005 specified.
What was undecided is *which* shape we bless, whether it becomes core surface, and how it
interacts with bake's identity hash and the exposure model.

### The constitutional snag

**P13 says "Bake is the only client delivery channel. Client-targeted code receives config
exclusively via the bake-generated module."** Taken literally, blessing *any* runtime-injected
document contradicts it. Yet the constitution's own §4 leak-vector table already contains the
row *"Window-injected config spoofing (XSS ordering) → Injected browser config is an untrusted
input boundary: revalidated on read, never used for secret-tier values."* The threat model
already contemplates injected browser config; P13's absolute phrasing had simply never been
reconciled with it. This ADR reconciles them (D5) rather than letting the spec contradict itself
— which is precisely the silent drift this project exists to prevent.

---

## Decision drivers

- **P7 is the guarantee that makes any of this safe.** The browser entry ships no secret-capable
  sources *by construction*, so a secret tessera pointed at a fetched document is an
  `ExposureError`, not a policy check. The document can never become a secret side-channel.
- **P6 — no new core surface without a case.** The recipe composes from existing primitives. A
  blessed core browser source is a permanent API commitment, and one that superficially *looks*
  secret-capable, which is the last thing the browser entry should look like.
- **P17 — honest claims.** Rebuild-per-environment is genuinely the simplest correct answer for
  most teams. Saying so is more useful than pretending the runtime mode is free: it adds a
  network read on the boot path and an untrusted input boundary.
- **The audience.** Teams with the strictest promotion pipelines — bit-identical artifacts — are
  disproportionately the teams that would adopt a library like this. "Rebuild per env" alone
  reads as a non-answer to them.
- **P16 — config, not state.** Whatever we bless must be read **once at boot and pinned**, never
  watched or polled. The async pin gives exactly that.

---

## Considered options

- **A. Do nothing; document rebuild-per-environment.** Cheapest and honest (`tessellum bake` once
  per environment in the CI matrix; only public values resolve, so no secrets in the pipeline).
  Cost: you give up bit-identical artifacts, and it angers precisely the teams most likely to care.
- **B. Bless exactly one runtime-injected JSON mode.** A small public per-environment document
  (conventionally `/config.json`), fetched once at boot through an async provider entry and pinned.
- **C. HTML injection.** The server templates the same JSON into a script tag: saves a request,
  couples you to a serving layer.
- **D. Promote B into core as a first-class browser source** *(rejected for v0.1)*. Best
  ergonomics, but a permanent API commitment (P6) and a browser source that looks secret-capable.

**Chosen: A + B + C together, as a documented decision space** — with B specified as a *userland
recipe*, not core surface, and C as a variant of B. The failure mode of picking exactly one is
that either the simple teams get ceremony they don't need (B-only) or the strict-promotion teams
get a non-answer (A-only). The decision is not "which path exists" but "which path is *default*,
which is *blessed*, and what each costs."

---

## Decision

### D1 — Rebuild-per-environment is the documented **default**

`tessellum bake` runs once per environment in the promote step. Only public values are resolved,
so no secrets are needed in the pipeline. The cost, stated plainly: the artifact is no longer
bit-identical across environments. For teams that can rebuild, this remains the simplest correct
answer and needs no new machinery.

### D2 — Exactly **one** runtime-injected mode is blessed, as a userland recipe

A small **public** JSON document, conventionally `/config.json`, is deployed next to the artifact
per environment. The client fetches it **once at boot** through an async provider entry and pins;
every read after boot is synchronous.

```ts
const apiBase = tessera({
  key: "API_BASE_URL",
  schema: z.string().url(),
  exposure: "public",                                  // public or the bind is an ExposureError
  sources: [{ provider: "runtime-config" }, { env: "API_BASE_URL" }],
});

// browser boot: runtimeConfigProvider fetches /config.json once; reads are sync forever after
const cfg = await bind({ apiBase: provider(apiBase, runtimeConfigProvider) }).snapshot();
```

Four properties are normative:

1. **Values still validate.** The document's values go through the same tessera schemas at boot —
   one aggregated `MissingConfigError` if the deploy served a bad document.
2. **Secrets are structurally impossible.** The browser entry ships no secret-capable sources
   (P7), so a `exposure: "secret"` tessera pointed at the document fails with `ExposureError`.
   This is construction, not policy: the document cannot become a secret channel.
3. **It is an untrusted input boundary.** The document is revalidated on read and never used for
   secret-tier values — the existing §4 leak-vector rule for injected browser config, now with a
   sanctioned mechanism attached to it.
4. **It never touches bake's identity hash.** Runtime-injected tesserae are *not* in the bake
   `client` target: they are never inlined, carry no baked handle, and therefore can never raise
   `StaleBakeError`. `StaleBakeError` remains exactly what ADR 0003 made it — a build-time
   `bake --check` gate over **baked** handles. The two mechanisms do not overlap, and this ADR
   does not extend the identity hash to runtime-arriving values.

**Bake emits a JSON Schema for the document.** Because the tesserae routed to `runtime-config`
are declared and public, bake can emit a JSON Schema describing the expected document, so the
*deploy* pipeline validates `/config.json` **before serving it** rather than discovering the
error in a browser at boot. This is the one new bake output this ADR adds, and it emits names and
types only — never values (P14).

### D3 — HTML script-tag injection is a documented **variant** of D2

The server templates the same JSON into a script tag; the provider reads it from the DOM instead
of fetching. It saves a request and couples you to a serving layer. Same schemas, same
`ExposureError` guard, same "untrusted input boundary, revalidated on read" rule. It is a variant,
not a second mode: one document shape, two transports.

### D4 — No first-class core browser source in v0.1

D2 stays a **userland recipe** composed from existing contract pieces (a `provider` source ref +
the async pin). Core grows no new browser source. Revisit only if the §12 proof-gate demo
demands it. Rationale: P6, and the refusal to ship a browser source whose shape invites the
assumption that it can carry secrets.

### D5 — **P13 is narrowed** (the constitutional reconciliation)

P13's "client-targeted code receives config *exclusively* via the bake-generated module" is
amended to say what it actually protects:

> Bake is the only channel that **inlines** client config. Build-constant client-targeted values
> reach the browser exclusively via the bake-generated module. The one sanctioned alternative is a
> **runtime-injected public document** (this ADR): bound through a declared source at the
> composition root, never inlined, always an untrusted input boundary revalidated on read, and
> structurally incapable of carrying secrets because the browser entry ships no secret-capable
> sources (P7).

This is a *narrowing to what was always meant*, not a weakening: nothing about attestation,
deny-by-default client targets, or the secret-name bake gate changes. A runtime-injected document
carries only public values that a schema validates on arrival.

---

## Consequences

**Positive**

- The predicted #1 issue has a recorded answer, and `guides/browser` no longer says "under
  consideration, not a promised feature." Both audiences are served: rebuild-per-env for teams
  that can rebuild, a blessed runtime mode for bit-identical promotion pipelines.
- Zero new core API surface (D4). The recipe is the async door that already exists.
- The exposure guarantee stays *structural*, not procedural: P7 makes a secret in `/config.json`
  unrepresentable, so blessing the mode costs nothing in the secret model.
- The `StaleBakeError` boundary gets sharper, not fuzzier: baked values are hash-checked at build
  time; runtime-injected values are schema-checked at boot. Neither mechanism reaches into the other.
- The spec stops contradicting itself: P13's absolute phrasing is reconciled with the leak-vector
  row that already assumed injected browser config exists.

**Negative / costs**

- **The runtime mode reintroduces a network read on the boot path** — the exact thing the baked
  path exists to avoid — and an availability dependency at boot. Stated in the guide, not buried.
- **Two documented paths is more doc surface**, and a reader must choose. Mitigated by naming D1
  the default and D2 the escape, with the trade-off in one line each.
- **The document is an untrusted input boundary.** An attacker who can serve `/config.json` can
  serve a *valid-but-wrong* `API_BASE_URL`. Schemas constrain shape, not intent. This is the same
  trust you already place in whoever serves your JS bundle — said out loud, per P17.
- **A new bake output** (the JSON Schema for the document) is one more artifact to keep correct.

**Security posture**

- No new secret surface: P7 makes secret-tier values in the document structurally impossible
  (`ExposureError`), so D2/D3 cannot become a laundering channel. Bake still never resolves a
  secret value (P14), and the emitted JSON Schema carries names and types only.
- Injected config remains an untrusted input boundary, revalidated on read — the existing §4 rule,
  now with a sanctioned mechanism rather than an unspecified one.

---

## Scope — what this ADR is *not*

- **Not a watch/subscribe channel.** The document is read **once at boot** and pinned (P16). No
  polling, no refetch, no live browser config. A value that must change while the tab is open is
  state, not config.
- **Not a secret delivery mechanism.** Ever. P7/P14 are untouched.
- **Not an extension of the identity hash.** Runtime-injected values are not baked and are not
  identity-hashed; `StaleBakeError` keeps its ADR-0003 meaning exactly.
- **Not a core browser source** in v0.1 (D4) — that promotion is deferred, not rejected forever.
- **Not a new bind entry point — but it does impose one constraint on an existing one.** The recipe
  needs an async-capable `bind` reachable from a *browser* build. `reference/api` currently
  describes `tessellum/async` as "async-capable (providers); re-exports node combinators," and
  `env`/`file` live in `tessellum/node`, which imports `node:process`/`node:fs` — bundling that for
  a browser fails at build (P5). For this recipe to be browser-safe, that re-export must be
  **data-only** (combinators are pure JSON wiring data; capability enters only at the bind entry
  point, which is already the stated rule), or the browser async door needs its own subpath.
  Recorded here as a constraint this ADR *imposes* on the async entry's implementation — named
  rather than assumed, because a browser build that transitively pulls `node:fs` would fail the
  flagship browser story (P17).
