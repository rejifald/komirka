# ADR 0007 — Cross-install branded-type identity and library-author consumption

- **Status:** Accepted (2026-07-09; design phase — no code yet)
- **Date:** 2026-07-09
- **Deciders:** project author
- **Constitution touchpoints:** P1 (the descriptor is inert data, detected by the structural
  `$tessera` brand field, never `instanceof` — the dual-package hazard), P4 (BYO Standard
  Schema; revalidate-on-fallback is the always-on floor), P6 (bundle-frugal, zero runtime
  dependencies — a duplicated copy is bundle weight, and the peer-dep is the dedup lever), P7 /
  P14 / P21 (fail-closed exposure; a secret must not launder across the escape boundary), P11
  (content-addressed identity with a frozen field list — the load-bearing cross-install
  guarantee), P12 (`pick()` runtime-restricts; the `Scope` brand only `pick()` produces, and
  `Snapshot` is deliberately not assignable to it), P17 (honest claims — the peer-dep is
  ergonomics, not the guarantee, and the escape states its costs in the same breath)
- **Related docs:** [`guides/library-authors`](../../site/content/docs/guides/library-authors.mdx)
  ("The shape of the pattern", "Type your API against a picked scope", "Release checklist", and
  the new "Consumers who don't use tessellum" escape),
  [`concepts/identity`](../../site/content/docs/concepts/identity.mdx) (the runtime story, plus
  the new "Branded-type identity across installs" and peer-dependency sections),
  [`reference/api`](../../site/content/docs/reference/api.mdx) (§Identity; `pick` / `Scope`),
  [`reference/errors`](../../site/content/docs/reference/errors.mdx) (`DescriptorMismatchError`),
  [`reference/decisions`](../../site/content/docs/reference/decisions.mdx) §10 (this pointer),
  [`principles.md`](../../principles.md) P1 / P11 / P12; resolves issue #31
- **Builds on:**
  - [ADR 0001](./0001-tessera-inheritance.md) — identity is content-addressed and identity-bearing
    relations reference their base by identity; this ADR pins the *type-level* companion to that
    runtime identity.
  - [ADR 0002](./0002-secret-value-representation.md) — `Secret<T>` is **assignable to `T`** with
    no reveal ceremony for coercion, and its guards are runtime Proxy traps. D3's escape rides
    directly on that: a secret crosses a plain-object boundary as `Secret<T>` with no `.reveal()`.
  - [ADR 0003](./0003-client-read-api-and-bake-staleness.md) — the baked client shim is typed
    `Scope<...>` via an erased `import type`, so "library code accepts it unchanged" while the
    shim imports nothing at runtime (measured ~0.4 KB gzip). That "unchanged" acceptance must
    hold even when the library resolved its `Scope` from its *own* copy of tessellum — so the
    structural brand D2 settles governs the client path too, not only runtime `pick()`.

> Engineering decision record, kept apart from the published design site (which presents the
> library "as if it existed"). Records *why* and what it costs, not the final reference prose.

---

## Context

The identity machinery — content-addressed `identityOf`, the three-way `unwrap()` contract,
`DescriptorMismatchError`, `unify` — exists *because* the same logical tessera routinely exists
as more than one physical object in a real dependency tree: the dual-package hazard (a package
loaded as both CJS and ESM), diamond installs (`@acme/mailer@2` in the app, `@acme/mailer@1`
still bundled by a transitive dep), and ordinary cross-package DI (the object a library reads
with is not the object the app bound). `concepts/identity` documents all three, and the runtime
resolution is thorough.

Issue #31 flags two gaps that the runtime story alone does not close, both in the
library-author adoption surface (`guides/library-authors`):

1. **Peer-dependency guidance is absent.** The whole design anticipates tessellum being
   installed more than once, yet the release checklist never tells a library author to declare
   tessellum a `peerDependency`. A plain `dependency` actively *manufactures* the dual-package
   hazard the design merely tolerates: every consumer bundles the library's own private copy.

2. **The branded-type identity is assumed but unproven, and it forces tessellum on every
   consumer.** A library types its API `Scope<ConfigOf<typeof tesserae>>`; that `Scope` brand is
   asserted to "carry across" duplicate installs, but nothing proved it — and typing against
   `Scope` at all means a consumer who has never heard of tessellum cannot adopt the library
   without adopting tessellum wholesale (against the principles §7 "adoptable by teams that have
   never heard of StitchAPI" claim).

### The spike

A throwaway spike (`scratchpad/spike31/`, referenced by path, not committed) settled the
mechanics empirically. `bash run.sh` prints PASS/FAIL per assertion; all pass.

**Runtime** (`driver.mjs`, Node, no deps): two **byte-identical copies** of a mini identity core
(`lib-a/`, `lib-b/`) stand in for two installs — genuinely separate module instances, separate
`class` realms. Proven:

- **(a)** the structural `$tessera` brand (a plain string-keyed field) is detected across copies;
  `instanceof` returns **false** across copies — the concrete demonstration of *why* P1 forbids
  it, and `bind()` from copy A accepts a copy-B-constructed tessera.
- **(b)** equal content-addressed identity ⇒ `bind(copyA)` then `unwrap(copyB)` resolves
  **interchangeably** (different object refs, different validator-fn objects, one value).
- **(c)** a hash-fallback read **re-validates with the caller's schema**: bind a value copy A's
  looser schema accepts (`8`, valid `0..10`); read it through copy B's stricter schema (`0..5`)
  and it throws `ValidationError`, not a silent `8`. Validation cannot downgrade across copies
  (the P4 floor). A value valid under both still reads through either copy.
- **(d)** a drifted descriptor (default `3 → 5`, an identity edit) under the same key ⇒
  `DescriptorMismatchError`.
- **(e)** with the hash **forced to a constant collision** in both copies, structural inequality
  still refuses a false unify (mismatch, not a bogus hit) while a true structural copy still
  hits — proving the hash is only an index and structural equality is authoritative (P11).

**Type-level** (`types/`, `tsc --strict`, TypeScript 5.9.3) — the part #31 called unproven. Two
byte-identical `.ts` "installs" differing only in how each brands `Scope`. `main.ts` is
self-checking: each `@ts-expect-error` is an assertion (tsc flags an *unused* one), so a clean
compile means every expectation held; `evidence.ts` re-runs the same lines without suppressions
to print the raw diagnostics. Proven:

- A **`unique symbol`** (nominal) `Scope` brand **loses identity across installs**: a
  `Scope<Cfg>` from install A is *not* assignable to install B's `Scope<Cfg>` parameter —
  `error TS2345 … Property '[SCOPE_BRAND]' is missing`. Each install declares its own
  `unique symbol`, so the two brands are different types. The naive assumption is *false*.
- A **structural, well-known string-keyed** brand **survives**: the cross-install assignment
  compiles clean, **and** `Snapshot` is still not assignable to `Scope` —
  `Property '["~tessellumScope"]' is missing in type 'Snapshot<Cfg>'` — so P12's least-privilege
  gate is preserved. A cross-install `pick()` output is likewise accepted.

The type-level result is the crux: **cross-install branded-type identity is real only if the
`Scope`/`ConfigOf` brand is structural, not nominal.** It also settles ADR 0003's client path:
the baked shim's scope is typed via an erased `import type`, and a library's `Scope<...>`
signature accepts it across installs *only* under the structural brand — the same reason the
zero-runtime-dep shim interoperates with library code that carries its own tessellum copy.

---

## Decision drivers

- **P11 / P1 — the runtime guarantee is content-addressed identity, and it already works across
  installs.** The type brand is a compile-time convenience layered on top; it must not be sold as
  the load-bearing mechanism, and it must not *weaken* the runtime guarantee.
- **P17 — honest claims.** A `peerDependency` reduces duplication; it does not *prevent* it
  (pnpm's isolated store, incompatible version ranges, CJS/ESM dual-load, and monorepos all
  produce duplicate copies with peer-deps declared). Calling the peer-dep "required for identity"
  would advertise a guarantee it does not deliver. The guarantee is identity + revalidation.
- **P12 — the `Scope` brand is mistake-prevention, not a sandbox.** `guides/library-authors`
  ("Least privilege, not a sandbox") already states hostile in-process code can read `process.env`
  directly. So the brand needs to stop the *accidental* "hand over the whole `Snapshot`", not
  resist a determined forger — which frees the representation choice toward the structural brand.
- **P6 — a duplicated copy is bundle weight.** Even where identity papers over correctness, a
  second physical copy is dead weight in the consumer's bundle. The peer-dep earns its place on
  frugality grounds alone.
- **Adoption reach (principles §7).** A library must be able to serve a consumer who does not use
  tessellum, or the "adoptable by teams that have never heard of it" claim is hollow.
- **P7 / P14 / P21 — no laundering through the escape.** Any plain-object escape must not become
  a channel that strips a secret of its protection silently.

---

## Considered options

### Axis 1 — peer-dependency stance

- **A1. Recommend the peer-dep; identity is the floor *(chosen — D1)*.** Declare tessellum a
  `peerDependency` for deduplication and to avoid bundling a second copy; state plainly that
  correctness across duplicate copies comes from content-addressed identity + revalidate-on-fallback.
- **A2. Mandatory peer-dep, framed as required for identity *(rejected)*.** Over-claims: peer-deps
  cannot guarantee a single copy, and the design deliberately does not depend on one. Framing it
  as the correctness mechanism is exactly the honest-claims violation P17 forbids, and it would
  make the (defective) nominal-brand story look viable.
- **A3. Plain dependency / silence *(rejected)*.** Manufactures the dual-package hazard for every
  consumer and ships a redundant copy into every bundle (P6).

### Axis 2 — cross-install `Scope`/`ConfigOf` brand representation

- **B1. Structural, well-known string-keyed phantom brand *(chosen — D2)*.** Survives duplicate
  installs (spike), keeps `Snapshot` un-assignable to `Scope` (spike, P12), and keeps ADR 0003's
  baked shim acceptable to a library's `Scope<...>` signature across installs. Honest cost:
  forgeable by deliberately writing the brand key — acceptable because the brand is
  mistake-prevention, not a sandbox.
- **B2. Nominal `unique symbol` brand *(rejected)*.** More forgery-resistant, but the spike proves
  it loses identity across installs, which would (i) force a single deduped type copy, reviving the
  fragility #31 raises, and (ii) break ADR 0003's client path — a baked shim typed by the app's
  install would be rejected by a library's own-install `Scope<...>` in the diamond case. P12 does
  not claim forgery resistance, so B2 buys nothing tessellum advertises while breaking two things
  it needs.

### Axis 3 — serving consumers who don't use tessellum

- **C1. Plain-object accessor + optional tessellum adapter *(chosen — D3)*.** The library's core
  entry takes ordinary resolved values; a thin, optional-peer adapter bridges for tessellum users.
- **C2. Structural reader interface (`ConfigReader<C> { unwrap(h): … }`) *(rejected as the
  escape)*.** Removes only the *nominal* `Scope` type: the consumer must still bind through
  tessellum to produce anything with `unwrap`, so it does not free a "never heard of it" consumer,
  and it silently admits a raw `Snapshot` (weakening P12). Recorded here because it is the natural
  wrong turn; it is not the escape #31 asks for.
- **C3. No escape — always `Scope<...>` *(rejected)*.** Strongest guarantees, but leaves the
  adoption-friction gap #31 raised.

---

## Decision

Adopt **A1 + B1 + C1**, as sub-decisions **D1–D3**, with **D4** recording the secret-crossing
guardrail on D3's boundary.

### D1 — A library declares tessellum a `peerDependency`; content-addressed identity is the floor

Library authors declare `tessellum` in `peerDependencies` (with a matching `devDependency` for
their own build/test), **not** as a plain `dependency`. The release checklist and the identity
page say so, and say *why*: a peer-dep lets the consumer's package manager dedupe to one copy and
keeps a second copy out of the consumer's bundle (P6).

The guidance states the boundary in the same breath (P17): **a peer-dep reduces duplication; it
does not prevent it.** pnpm's isolated store, incompatible version ranges across the graph,
CJS/ESM dual-load, and monorepo layouts all still produce duplicate copies. When they do,
correctness is held by the runtime, not the manifest: content-addressed identity resolves genuine
duplicates interchangeably (spike (b)), a hash-fallback read re-validates with the caller's own
schema so validation never silently downgrades (spike (c), the P4 floor), and a *real* drift
surfaces as `DescriptorMismatchError` with a paste-able `unify` (spike (d)). The peer-dep is the
ergonomic default; identity is the guarantee.

```jsonc
// @acme/mailer package.json
{
  "peerDependencies": { "tessellum": "^1.0.0" },
  "devDependencies":  { "tessellum": "^1.0.0" }
}
```

### D2 — The `Scope` / `ConfigOf` brand is **structural** (string-keyed), never a `unique symbol`

The brand that `pick()` produces and that gates library signatures is a well-known, string-keyed
phantom property carrying the tesserae-set type — **not** a `unique symbol`. This is the only
representation under which branded-type identity survives duplicate installs (spike: nominal
fails cross-install, structural passes) while still keeping the root `Snapshot` un-assignable to
`Scope` (P12, spike). It also governs ADR 0003's client path: the baked shim is typed
`Scope<...>` through an erased `import type`, and a library's `Scope<...>` signature accepts that
shim's scope across installs only because the brand is structural — a `unique symbol` would make
the app-install shim and a library's own-install `Scope` disagree in the diamond case.

The honest cost (P17): a structural brand is **forgeable** — code can write the brand key by
hand. This is acceptable and already consistent with the stated posture: P12's brand is
least-privilege *mistake-prevention*, and `guides/library-authors` already says in as many words
that it is "not a sandbox" (hostile in-process code reads `process.env` directly regardless). The
brand's job is to stop a caller *accidentally* handing over their whole `Snapshot`; a structural
brand does that (a `Snapshot` lacks the key) and no more is claimed.

The type brand is explicitly the junior partner: the load-bearing cross-install guarantee is the
**runtime** content-addressed identity (P11) plus the runtime `pick()` scope table (P12). The type
is a compile-time convenience that happens to compose across installs *because* it is structural.

### D3 — Default to `Scope<...>`; document a plain-object accessor + optional adapter escape

The recommended surface for a tessellum-native library is unchanged: type every config-consuming
entry point `Scope<ConfigOf<typeof yourTesserae>>`, parameter required. For a library that must
serve consumers who do not use tessellum, document an **escape**: expose a core factory over plain
resolved values, and ship the tessellum bridge as a **separate, optional-peer entry point**.

```ts
// @acme/mailer — core entry: needs NOTHING from tessellum at runtime
export function createMailer(cfg: MailerConfig) { /* … */ }

// public values cross as bare values; secret values cross as Secret<T> (ADR 0002)
export interface MailerConfig {
  fromAddress: string;         // public → bare
  retryCount: number;          // public → bare
  smtpUrl: Secret<string> | string;   // secret → Secret<T> (assignable to string; see D4)
}
```

```ts
// @acme/mailer/tessellum — a SEPARATE entry; tessellum is an OPTIONAL peer here only
import type { Scope, ConfigOf } from "tessellum";
import { smtpUrl, fromAddress, retryCount, mailerTesserae } from "./tesserae";
import { createMailer } from "./index";

export const mailerFromScope = (s: Scope<ConfigOf<typeof mailerTesserae>>) =>
  createMailer({
    smtpUrl: s.unwrap(smtpUrl),         // Secret<string>, passed straight through — no reveal (D4)
    fromAddress: s.unwrap(fromAddress),
    retryCount: s.unwrap(retryCount),
  });
```

- A **non-tessellum** consumer calls `createMailer({ … })` with plain values. Zero tessellum,
  runtime or type; the `package.json` marks it `peerDependenciesMeta: { tessellum: { optional: true } }`.
- A **tessellum** consumer calls `mailerFromScope(root.pick(mailerTesserae))`.

The honest costs, stated in the guide (P17): a plain object is **not** a pinned `Snapshot` and
carries **no** lazy validation — the tessellum adapter resolves eagerly at the call, and a
hand-built object is validated only by the library's own schema, whenever the caller assembled
it. The escape trades those two properties (and the `Scope` least-privilege gate) for reach; a
library that wants them keeps the `Scope<...>` signature.

### D4 — Across the escape boundary, a secret crosses as `Secret<T>`, never silently as a bare string

This is where the plain-object escape could have become a laundering channel (P21). It does not,
because ADR 0002 made `Secret<T>` **assignable to `T`**: the adapter passes `s.unwrap(smtpUrl)`
(a `Secret<string>`) straight into a `smtpUrl: string` field with **no `.reveal()`**. The value
that flows is the runtime Proxy, whose guards are behavior, not type: it still throws on
`JSON.stringify` / `structuredClone`, redacts under `console.log` / `util.inspect`, and leaks
nothing under spread. Protection rides across the plain-object boundary intact, and — crucially —
those guards are install-independent, so a secret keeps its protection even when it crosses
between two copies of tessellum.

Two honest edges the guide names:

- The field is typed `Secret<string> | string` so a non-tessellum consumer *can* supply a bare
  string. That path has no wrapper and no protection; the guide states plainly that a consumer who
  opts out of tessellum owns the exposure of any secret they pass bare. The escape does not make
  secrets *more* exposed than a normal read — it declines to *add* protection a non-tessellum
  caller never asked for.
- `Secret<T>` needs no *structural* brand to survive the crossing (unlike `Scope`), precisely
  because it degrades gracefully to `T`: a cross-install brand mismatch just means it is read as a
  plain `T`, and the load-bearing guard is the runtime Proxy + `isSecret`, not the type. This is
  the mirror image of D2 — `Scope` must be structural because it must *not* degrade to a bare
  type; `Secret` may tolerate a nominal brand because it *must*.

---

## Consequences

**Positive**

- The #31 branded-type-identity claim is now proven, not assumed, and pinned to the one
  representation (structural brand) that makes it true — with an executable `tsc` spike that fails
  loudly if a future refactor reaches for a `unique symbol`.
- Peer-dependency guidance closes the manufactured-dual-package gap and the redundant-bundle-copy
  cost, without over-claiming: the honest floor (identity + revalidation) is stated alongside.
- The plain-object escape makes the library adoptable by consumers who never touch tessellum,
  while the optional adapter keeps the tessellum path first-class — and D4 keeps secrets protected
  across that boundary for free, on ADR 0002's existing mechanics.
- D2 secures ADR 0003's client path: "library code typed `Scope<...>` accepts the baked shim
  unchanged" now provably holds across duplicate installs too — a documented consequence of the
  structural brand, not an unexamined convenience.

**Negative / costs**

- **The structural brand is forgeable.** Accepted: P12 is mistake-prevention, not a sandbox, and
  this is now stated wherever the brand is defined. A determined forger is explicitly out of scope.
- **The escape is a second public surface** (core plain-object entry + `…/tessellum` adapter
  entry) with its own maintenance and changelog burden, and it forfeits pinning, lazy validation,
  and the `Scope` gate. Mitigation: it is documented as an *escape*, not the default; tessellum-native
  libraries stay on `Scope<...>`.
- **`Secret<string> | string` widens the secret field's type** on the escape, admitting a bare
  string. This is the deliberate reach/safety trade, called out in the guide; the `Scope` path is
  unaffected and remains fully wrapped.
- **Peer-dep ranges are a coordination cost.** A library pinning `tessellum` too tightly can force
  duplicate copies (the very hazard). Mitigation: recommend a wide `^` range and lean on identity.

**Security posture**

- No new laundering surface: D4 keeps a secret wrapped across the plain-object boundary via
  `Secret<T>`'s runtime Proxy, and a bare-string opt-out is the consumer's explicit, documented
  choice — never a silent downgrade. Exposure is fail-closed by default (P7) everywhere the
  tessellum path is used.
- The identity guarantee is unchanged and remains the authority: structural equality over the
  frozen field list decides, the hash is only an index (spike (e)), and revalidate-on-fallback
  keeps validation from downgrading across copies (spike (c)).

---

## Scope — what this ADR is *not*

- **Not a change to what counts as identity.** The frozen field list (P11), the three-way
  `unwrap()` contract, `DescriptorMismatchError`, and `unify` are unchanged. This ADR adds the
  *type-level* companion (structural `Scope` brand) and the *packaging* guidance (peer-dep,
  escape); it does not touch the content-addressed hash or its field set.
- **Not a general cross-package plugin/DI framework.** The escape is a documentation pattern for
  config consumption, not a new runtime abstraction. There is still no global `provide()`; wiring
  is chosen once, at the app's `bind()` (unchanged).
- **Not the declare-and-defer binding of #5.** A library that does not own the composition root
  and wants to *defer* binding is a separate, still-open concern; D3 is about *typing the
  consumption surface*, not about deferring the bind.
- **Not a claim that the type brand is a security boundary.** It is least-privilege
  mistake-prevention (P12). The runtime scope table (`pick()`), not the type, is what throws
  `NotInScopeError`.
