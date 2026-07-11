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

### D2 — The blessed escape is a **synchronously-injected** public document

The deploy environment writes a small **public** JSON document into the page **before the app
boots** — a server-rendered `<script>window.__APP_CONFIG__ = { … }</script>` (or an equivalent
pre-boot global). Because the values are present synchronously at boot, the app reads them and
binds them through a **synchronous, browser-safe** entry — no `await`, no provider, no
`tessellum/async`, and nothing from `tessellum/node`:

```ts
const apiBase = tessera({
  key: "API_BASE_URL",
  schema: z.string().url(),
  exposure: "public",                 // public, or wiring it is refused (property 2)
  sources: [{ env: "API_BASE_URL" }], // the declared ref; the injected value overrides it at the root
});

// browser boot — synchronous; the server injected window.__APP_CONFIG__ before this script ran
import { bind, literal } from "tessellum";
const injected = window.__APP_CONFIG__ ?? {};
const cfg = bind({ apiBase: literal(apiBase, injected.API_BASE_URL) }); // validated at bind, sync
```

This is the decisive property: **the production browser bundle never needs `tessellum/async` or
any Node import.** The value is already on the page; reading it is synchronous; wiring it is the
same `literal()` combinator tests use, through the universal core entry.

Four properties are normative:

1. **Values still validate.** The injected value runs the tessera's schema at bind — one
   aggregated `MissingConfigError` if the deploy injected a bad document.
2. **Secrets cannot ride the document.** A secret wired from the injected value via `literal()`
   is `SecretLiteralError` (a literal on a secret is refused outside tests); and on the fetch
   fallback (D3) the browser entry ships no secret-capable source, so that route is
   `ExposureError`. Either way the document is structurally incapable of carrying a secret (P7) —
   construction, not policy.
3. **It is an untrusted input boundary.** Injected browser config is revalidated on read and never
   used for secret-tier values — the existing §4 leak-vector rule, now with a sanctioned mechanism.
4. **It never touches bake's identity hash.** These values are not in the bake `client` target:
   never inlined, no baked handle, so they can never raise `StaleBakeError`. `StaleBakeError`
   stays exactly what ADR 0003 made it — a build-time gate over **baked** handles. This ADR does
   not extend the identity hash to runtime-arriving values.

**Bake emits a JSON Schema for the document**, so the deploy pipeline validates it **before
serving** rather than discovering the error in a browser at boot. Names and types only, never
values (P14).

The read-and-wire step uses `literal()` today (the combinator tests already use). A dedicated
synchronous "injected" source (`{ injected: "API_BASE_URL" }` reading a configured global) would
read more cleanly, but it is new core surface and is deferred (D4).

### D3 — Async fetch is the fallback for pure-static hosting — and the *only* path that needs `tessellum/async` in the browser

When nothing can inject before boot — a purely static SPA with no serving layer — the escape is
to **fetch** `/config.json` at boot through an async provider entry and pin:

```ts
import { provider } from "tessellum";
import { bind } from "tessellum/async"; // the async door — needed ONLY on this fallback path
const cfg = await bind({ apiBase: provider(apiBase, runtimeConfigProvider) }).snapshot();
```

Same four properties as D2 (the secret guard here is `ExposureError`, since a browser provider is
a source the browser entry does not supply for secrets). This is the **one** path that requires
`tessellum/async` to be reachable from a browser build (see Scope). It is deliberately **secondary
and opt-in**: the default is rebuild-per-env (D1), the blessed escape is synchronous injection
(D2), and this exists only for the static-hosting corner that can neither rebuild nor inject.

### D4 — No first-class core browser source in v0.1

Both D2 and D3 stay **userland recipes** composed from existing contract pieces (`literal()`, or a
`provider` + the async pin). Core grows no new browser source — including the cleaner synchronous
"injected" source D2 gestures at. Revisit only if the §12 proof-gate demo demands it. Rationale:
P6, and the refusal to ship a browser source whose shape invites the assumption it can carry
secrets.

### D5 — **P13 is narrowed** (the constitutional reconciliation)

P13's "client-targeted code receives config *exclusively* via the bake-generated module" is
amended to say what it actually protects:

> Bake is the only channel that **inlines** client config. Build-constant client-targeted values
> reach the browser exclusively via the bake-generated module. The one sanctioned alternative is a
> **runtime-injected public document** (this ADR): bound at the composition root, never inlined,
> always an untrusted input boundary revalidated on read, and structurally incapable of carrying
> secrets (P7 — a runtime literal on a secret is `SecretLiteralError`, and the browser ships no
> secret-capable source for the fetch path).

This is a *narrowing to what was always meant*, not a weakening: nothing about attestation,
deny-by-default client targets, or the secret-name bake gate changes. A runtime-injected document
carries only public values that a schema validates on arrival.

---

## Consequences

**Positive**

- The predicted #1 issue has a recorded answer, and `guides/browser` no longer says "under
  consideration, not a promised feature." Both audiences are served: rebuild-per-env for teams
  that can rebuild, a blessed runtime mode for bit-identical promotion pipelines.
- **Zero new core API surface, and the production browser bundle stays sync-only** (D2): no
  `tessellum/async`, no Node import on the default runtime path. The async door is a fallback for
  static hosting (D3), not the blessed path — so the P5 browser-safety edge is off the critical
  path (see Scope).
- The exposure guarantee stays *structural*, not procedural: a secret can't ride the document
  (`SecretLiteralError` on the sync path, `ExposureError` on the fetch path), so blessing the mode
  costs nothing in the secret model.
- The `StaleBakeError` boundary gets sharper, not fuzzier: baked values are hash-checked at build
  time; runtime-injected values are schema-checked at boot. Neither mechanism reaches into the other.
- The spec stops contradicting itself: P13's absolute phrasing is reconciled with the leak-vector
  row that already assumed injected browser config exists.

**Negative / costs**

- **Synchronous injection couples you to a serving layer** that can write the document into the
  page before boot. A purely static SPA cannot do that and must fall back to D3 (fetch) or to
  rebuild-per-env (D1). Stated in the guide, not buried.
- **The fetch fallback (D3) reintroduces a network read on the boot path** — the exact thing the
  baked path avoids — and pulls `tessellum/async` into that build. Which is why it is the fallback,
  not the default.
- **Two documented paths is more doc surface**, and a reader must choose. Mitigated by naming D1
  the default, D2 the blessed escape, and D3 the static-hosting fallback — each with its cost in a line.
- **The document is an untrusted input boundary.** An attacker who can serve the document can serve
  a *valid-but-wrong* `API_BASE_URL`. Schemas constrain shape, not intent — the same trust you
  already place in whoever serves your JS bundle, said out loud (P17).
- **A new bake output** (the JSON Schema for the document) is one more artifact to keep correct.

**Security posture**

- No new secret surface: a secret cannot ride the document (`SecretLiteralError` on the sync path,
  `ExposureError` on the fetch path), so neither D2 nor D3 can become a laundering channel. Bake
  still never resolves a secret value (P14), and the emitted JSON Schema carries names and types only.
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
- **Not dependent on `tessellum/async` in the browser — except on the D3 fallback.** The blessed
  path (D2) is synchronous and uses only the core entry, so it pulls no async machinery and no Node
  import. The async fetch fallback (D3) *does* need `tessellum/async` reachable from a browser
  build, and `reference/api` describes that entry as "re-exports node combinators," while `env`/
  `file` live in `tessellum/node` (which imports `node:process`/`node:fs`, failing a browser build,
  P5). So for D3 to be browser-safe, that re-export must be **data-only** (combinators are pure JSON
  wiring data; capability enters only at the bind entry point — already the stated rule) or the
  browser async door needs its own subpath. This is now a **fallback-only** constraint, not a
  blocker on the default path — named rather than assumed (P17), and to be resolved if/when the D3
  fetch fallback is implemented.
