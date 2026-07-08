# ADR 0001 — Zerno inheritance and derivation (value fallback and transform across descriptors)

- **Status:** Accepted (2026-07-08; design phase — no code yet)
- **Date:** 2026-07-08
- **Deciders:** project author
- **Constitution touchpoints:** P2 (descriptors round-trip as JSON), P4 (BYO Standard
  Schema / no silent downgrade), P5 (sources are external data refs, impls injected), P7
  (fail-closed exposure), P11 (content-addressed identity), P13/P14 (bake, and it never
  resolves secrets), P16 (config-not-state), P17 (honest claims), P18 (cross-zerno structure
  is a relation), P20 (wiring is deployment reality, never contract), P21 (secret laundering
  ban)
- **Related docs:** [`concepts/zerno`](../../site/content/docs/concepts/zerno.mdx),
  [`concepts/binding`](../../site/content/docs/concepts/binding.mdx),
  [`concepts/identity`](../../site/content/docs/concepts/identity.mdx),
  [`concepts/conditional`](../../site/content/docs/concepts/conditional.mdx),
  [`reference/decisions`](../../site/content/docs/reference/decisions.mdx) §2, §5–6, and the
  §10 "Wiring" resolution (mapping functions dropped pre-1.0)

> This is an engineering decision record, kept apart from the published design site (which
> presents the library "as if it existed"). It records *why* a decision was made and what it
> costs, not the final reference prose.

---

## Context

A recurring configuration shape is **specific-inheriting-from-general**: a narrow value that,
when unset, should take on a broader value rather than a hardcoded literal.

- `AUTH_LOG_LEVEL` unset → use `LOG_LEVEL`.
- `READ_TIMEOUT_MS` / `WRITE_TIMEOUT_MS` unset → use a shared `TIMEOUT_MS`.
- `CDN_ORIGIN` unset → use `API_ORIGIN`, **with `api.` rewritten to `cdn.`**.
- A per-tenant / per-service override that inherits a service-wide, then a global, base.

The request is that **a descriptor may name other descriptors as its fallback, inheriting
their resolved value — and, optionally, transform that value before adopting it.** Call the
plain case **inheritance** and the transforming case **derivation**; they are one mechanism
(derivation is inheritance with a transform step).

This ADR resolves three questions raised against the first draft:

1. **Transform.** Inheritance must be able to *modify* the inherited value, not only copy it.
2. **Location.** Does the relationship live in the **declaration** (contract) or in the
   **binding** (composition root)?
3. **Validation.** When B's value flows into A, is it validated against **A's** (current)
   declaration or **B's** (inherited) declaration?

### The term "fallback chain" is already taken — and this is a *different axis*

komirka already ships a "fallback chain," and it means something specific: the ordered
`sources` list *within a single zerno* — `[{ env }, { file }, { provider }]` — where the
first source that yields a raw value wins. The docs call this the **declared fallback
chain**, and `chain()` is the deployment-wiring spelling that replaces it. That axis answers
*"where does **this** value come from?"* across **external locations**.

Inheritance is an **orthogonal axis**: *"when this value is absent, **which other zerno's**
value takes its place, and how is it adapted?"* The two compose — a zerno resolves its own
source chain first, and only then inherits — but they must not be conflated in the
vocabulary. This ADR reserves **"inheritance/derivation"** for the zerno-to-zerno axis and
leaves **"fallback chain"** to mean the source-precedence list.

### Why today's primitives do not cover it

- **`default`** is a static JSON literal (P2), the absolute floor of one zerno's resolution.
  It cannot track another zerno's *resolved* value, and it certainly cannot transform one.
  Inlining `default: "info"` into both `LOG_LEVEL` and `AUTH_LOG_LEVEL` duplicates the floor
  and silently drifts the day someone changes one.
- **`sources`** are *external* data refs whose implementations are injected at bind (P5). A
  source names a place in the world; it does not name another descriptor, and there is no
  impl to inject for "resolve zerno A."
- **`chain()`** is deployment wiring (P20) — deliberately *not* contract, identity-free. A
  library author declaring "`AUTH_LOG_LEVEL` inherits `LOG_LEVEL`" is stating part of what
  the zerno *means*; that is contract, not a per-deployment choice.

So inheritance is genuinely new surface. The questions are *what kind* of surface, *where* it
lives, and *how* the transform and validation behave.

---

## Decision drivers

1. **P18 — cross-zerno structure is a relation, never a mutable descriptor field.**
   Requiredness-that-depends-on-another-zerno is already `variants()` / `when()` / `rule()`,
   round-tripping as `relv1|` content-addressed recursive tagged JSON.
   "Value-that-depends-on-another-zerno" is the same category.
2. **P2 / P11 — descriptors round-trip as JSON and are content-addressed.** Whatever the
   transform mechanism is, it must serialize and hash. A JavaScript function does neither —
   which is exactly why komirka already dropped mapping functions from the wiring transform
   API pre-1.0 in favor of data-only `prefix`/`rename` (decisions §10).
3. **P4 — the schema is authoritative and validation never silently downgrades.** The
   reading zerno's own schema must decide the reading zerno's type; the existing precedent is
   "re-validate with the caller's schema."
4. **P7 / P14 / P21 — fail-closed exposure.** Inheritance is a new path a value can travel.
   A *public* zerno inheriting a *secret* one would surface a secret through a public read and
   into bake's client inlining — the laundering vector `WiringExposureError` already bans.
5. **P13 / P14 — bake.** A transform that runs at build time must be pure, serializable, and
   secret-free. Data ops satisfy this; arbitrary functions reopen the build-time-RCE class.
6. **P16 / P9 — config-not-state, and the snapshot/live type split.** Inheriting a `live`
   base must not silently animate a `snapshot` reader.
7. **P17 — honest claims.** The open edges below are named, not hidden.

---

## Considered options (the modeling axis — *what kind* of surface, and *where* it lives)

### Option A — a declared relation combinator `inherit()` *(chosen)*

A new relation in the `variants`/`when`/`rule` family, declared on the contract side:

```ts
inherit(targetZerno, baseZerno)                            // plain inheritance (one base)
inherit(targetZerno, baseZerno, { /* data ops */ })        // derivation (transform)
// transitive: baseZerno may itself inherit — towers are built by composition (single parent)
```

It round-trips as `relv1|` tagged JSON, is identity-bearing, references its base by
identity, and binds as **one entry** (the way a variants group does).

- **For:** obeys P18; the relationship is identity-bearing (P11), so a zerno that inherits is
  a different contract than one that does not — a consumer that binds it gets the same
  relationship or a loud `DescriptorMismatchError`; reuses the recursive-tagged wire format,
  the bind-as-one-entry model, `explain()` provenance, and aggregated `MissingConfigError`;
  keeps `sources` flat (P5); bakeable when the chain is public and build-constant.
- **Against:** the *base* must be referenceable at declaration time, so a library that
  inherits across its own zernos imports one descriptor into another (bounded
  monolith-through-imports cost); a purely cross-cutting app-imposed inheritance is not
  expressible this way (see the deferred bind-time case under the Decision).

### Option B — a new source-ref kind `{ zerno: <ref> }`

Reference another descriptor inside `sources`.

- **Against — rejected:** breaks P5's ref = external-location / impl-injected model (a zerno
  ref has no impl to inject — resolution is *core's* job); turns the flat `sources` list into
  a recursive graph; conflates two axes the Context keeps separate; and it has nowhere clean
  to put a transform.

### Option C — overload `default` to accept a zerno reference

- **Against — rejected:** `default` is JSON-only, static, and the *final* floor by
  construction (P2). Overloading it forfeits that simplicity, cannot express a base that wins
  *before* the target's own literal floor, cannot chain, and has no transform story.

### Option D — put inheritance in the **binding** (a `chain()`-like combinator at bind)

This is question 2's "binding" horn: the app declares inheritance at its composition root,
identity-free, like wiring.

- **For:** flexible — an app could wire two mutually-unaware library zernos to inherit a
  shared base without either author's involvement; keeps descriptors maximally decoupled.
- **Against — rejected as the *primary* mechanism:** wiring is deployment reality and is
  deliberately **identity-free** (P20); its one job is changing *where a value is read*,
  never *what the value is or means*. Inheritance-with-transform plainly changes the resolved
  value, so making it identity-free would let the same zerno resolve to materially different
  values at two composition roots with **no identity signal** — the silent-divergence class
  komirka exists to prevent. And a bind-time transform is precisely the serialized-function
  hazard the wiring API already refused. The legitimate cross-cutting use case is preserved
  as a **deferred, constrained** feature (below), not by weakening identity here.

---

## Decision

Adopt **Option A**. The three questions become sub-decisions **D1–D3**; a fourth, **D4**
(failure mode), surfaced while reviewing D3/§4 and is recorded alongside them.

### D1 — Location: inheritance is **declaration** (contract), not binding

Zerno inheritance is a **declared relation**, constructed with an **`inherit()`** combinator,
joining `variants()` / `when()` / `rule()` and sharing their `relv1|` content-addressed wire
format. It is **identity-bearing**: whether a zerno inherits, from what, and through what
transform is part of what the zerno *means*, so it lives in the identity subset alongside
`sources` and `default`.

> **On the name.** The combinator is `inherit()` *because* "fallback" and `chain()` already
> name the source-precedence axis; spelling it `fallback()` would collapse the distinction.
> Final naming is an open question below, but it will not be `fallback`.

The cross-cutting **app-imposed** case (an application wiring independent, mutually-unaware
zernos to inherit a shared base) is **deferred**, not folded into wiring. If built later it is
a wiring-family combinator subject to the *full* wiring guardrails — data-only (no bind-time
function transforms), recorded in the committed lockfile as effective wiring, exposure-ban
enforced — and its identity/attestation story is worked out then. v1 does not ship it.

```ts
import { zerno, inherit } from "komirka";
import { bind } from "komirka/node";
import { z } from "zod";

const logLevel = zerno({
  key: "LOG_LEVEL",
  schema: z.enum(["debug", "info", "warn", "error"]),
  exposure: "public",
  default: "info",
});

const authLogLevel = zerno({
  key: "AUTH_LOG_LEVEL",
  schema: z.enum(["debug", "info", "warn", "error"]),
  exposure: "public",
  // no default — it inherits instead
});

const cfg = bind([inherit(authLogLevel, logLevel)]);

cfg.unwrap(authLogLevel);
// env AUTH_LOG_LEVEL, if set;
// else LOG_LEVEL fully resolved (env LOG_LEVEL, then its default "info");
// re-validated through AUTH_LOG_LEVEL's own schema.
```

### D2 — Transform: derivation is allowed, but **data-only** — never a serialized function

A base may be adapted before adoption by an optional third argument to `inherit()` — a **small,
declarative, JSON-representable op set** — the same data-only discipline komirka already
chose for the wiring transform API (decisions §10):

```ts
const cdnOrigin = zerno({ key: "CDN_ORIGIN", schema: z.string().url(), exposure: "public" });
const readTimeout = zerno({ key: "READ_TIMEOUT_MS", schema: z.coerce.number().int(), exposure: "public" });

bind([
  // string massage
  inherit(cdnOrigin,   apiOrigin, { replace: ["api.", "cdn."] }),
  // numeric massage
  inherit(readTimeout, timeoutMs, { multiply: 2 }),
]);
```

The op vocabulary is string (`replace`, `template`, `prepend`, `append`) and numeric
(`multiply`, `add`) massaging — deliberately *not* a general expression language.
**Decided in review (2026-07-08):** ship exactly this minimal data-op set; the
named-and-versioned transform escape hatch (below) is deferred until a real case needs it.
The *shape* (data, not function) is non-negotiable regardless.

**Two homes for a transform, chosen by scope:**

- **Applies to *every* value of the zerno (direct or inherited):** put it in the target's own
  Standard Schema (`z.string().transform(...)`). This already runs on the inherited value
  via D3's pipeline — no new mechanism, and it is the natural home for a transform intrinsic
  to the zerno's meaning.
- **Applies *only on the inherited path*:** put it in the ops argument on the relation. A directly
  set `READ_TIMEOUT_MS` must not be silently doubled; only the *inherited* value is.

**Why not a function** (recorded as the rejected sub-option): a JS function does not
round-trip (P2), cannot be hashed into identity (P11) — so a value-changing transform would
be invisible to the content address, the silent-wrong-value class — cannot be baked without
reopening build-time RCE (P14/decisions §"Bake executes the manifest"), and is a fresh
secret-leak surface on the inherited path. The motivating cases are all string/number
massaging; "nothing in the motivating cases needs a function" held for wiring and holds here.
If a real case ever needs escape, the honest form is a *named, versioned* transform
(fingerprint discriminator like `schemaId`), not an anonymous closure — and it is still
client-ineligible. Deferred until a case exists.

### D3 — Validation: **layered** — inherited declaration first, transform, then current declaration

Resolution of `inherit(T, B, ops)` — one base, resolved transitively through B:

```
1. T.sources (declared precedence).          raw → T.schema → T value.   [no transform]
2. else resolve B through B's OWN declaration — INCLUDING B's own inheritance,
   recursively (B.sources → B's base → B.default) — validating with B's schema.
3. apply the data-only `ops` (if any).        B value → adapted value.
4. validate the adapted value with T.schema.  → T value, T's type.       [authoritative]
5. else T.default; else MissingConfigError (naming the whole chain).
```

So **both** validations apply, in order: the **inherited** declaration validates first (you
never inherit a value the base itself would reject), the data-only transform adapts, and the
**current** declaration validates last and fixes `Zerno<T>`'s type. Key properties:

- **The current declaration is authoritative for the reading zerno's type** (P4). `Zerno<T>`
  always returns `T`, regardless of the base's type.
- **A base value valid for the base but invalid for the target fails loudly at bind** — e.g.
  `LOG_LEVEL` permits `"trace"` but `AUTH_LOG_LEVEL` does not: inheriting `"trace"` passes
  step 2, fails step 4, and surfaces in the aggregated `MissingConfigError` as an
  inheritance type mismatch. That loud failure is a feature, not a bug — recovering from it
  is an explicit bind-site opt-in (D4).
- **Direct values skip the transform** (step 1 never reaches step 3), which is why a
  path-specific transform must live in the ops argument, not the schema.
- Validations are memoized per `(identity, raw)`, so the double-validation on the common
  compatible-schema path costs nothing after the first read.

`explain()` records the whole hop, redaction-safe:

```json
{
  "zerno": "CDN_ORIGIN",
  "resolved": {
    "kind": "inherit",
    "from": "API_ORIGIN",
    "source": { "env": "API_ORIGIN" },
    "transform": [{ "replace": ["api.", "cdn."] }]
  },
  "value": "https://cdn.example.com"
}
```

### D4 — Failure mode: loud by default, resilience is a bind-site opt-in

An inherited value that resolves but fails the target's schema (D3's schemas-disagree case)
is treated like any other invalid value: **loud by default.** At bind it joins the aggregated
`MissingConfigError`; for a live base it poisons the slot so `unwrap()` throws. Inheritance earns
no silent escape hatch the rest of the library is denied — "invalid is not unavailable" and
"current truth wins" hold unchanged.

Resilience is available as an **explicit bind-site opt-in**, in the same hook family and
location komirka already chose for `keepLastGood` — never a descriptor field:

```ts
bind(entries, { invalid: [useDefault(authLogLevel)] });
// on an invalid resolution, coast to authLogLevel's (validated) default instead of poisoning
// — a sibling of keepLastGood(zerno, { maxCoastMs }) in the { invalid: [...] } family
```

A descriptor `strict`/`resilient` field was **rejected**: it repeats the dilemma komirka
settled for `keepLastGood` — identity-class fractures two teams' policy preferences into
`DescriptorMismatchError`; cosmetic-class hides a behavioral field. Failure-mode policy is a
deployment decision and lives at the composition root.

This also retires the "dead default" worry: a target's `default` is both the absence-floor
(D3 step 5) and the `useDefault` resilience target, so it is never unreachable dead code. (A
precise *bind-time* dev-warning — "this default cannot fire in this binding: every base yields
and `useDefault` is not opted in" — is possible and deferred as polish.)

### Guardrails (each a named, fail-closed error)

- **`InheritanceExposureError` — a public zerno may not inherit from a secret zerno.**
  Downward inheritance across the exposure boundary would surface a secret through a public
  read and into bake's client inlining (P14). Secret-inherits-public is fine (a secret may
  hold anything); public-inherits-secret fails at construction/bind. The effective exposure
  of a chain is the max secrecy of any link. This is `WiringExposureError` applied to the new
  path.

  ```ts
  const publicOrigin = zerno({ key: "PUBLIC_ORIGIN", exposure: "public" });
  const internalHost = zerno({ key: "INTERNAL_HOST", exposure: "secret" });

  bind([inherit(publicOrigin, internalHost)]);
  // InheritanceExposureError: public "PUBLIC_ORIGIN" cannot inherit from
  //   secret "INTERNAL_HOST" — inheritance would surface a secret through a
  //   public read and into bake's client inlining.
  ```

- **`InheritanceCycleError` — no cycles.** `A → B → A` is rejected. Best-effort at
  construction; authoritative at bind, over the identity graph.

- **`InheritanceFreshnessError` — a `snapshot` target may not inherit a `live` base (v1).**
  The rule is asymmetric: `live`-inherits-`snapshot` (a pinned base; the target re-reads its
  own source) and `live`-inherits-`live` (coherent pins via `.snapshot()`) are both fine —
  only *`snapshot`-inherits-`live`* throws. Pinning a moving value into a zerno declared
  never-to-move is subtle enough (provenance, operator expectation) that v1 punts loudly
  rather than guess. Escape today: declare the target `live` too. **Promotion is rejected
  outright** — silently upgrading the target's freshness mutates an identity field by spooky
  action (P11). The designed, not-shipped **v2 door is *snapshot-at-bind*** (pin the base's
  bind-time value — the literal reading of "snapshot" — behind a dev-warning and
  frozen-from-live `explain()` provenance).

- **Membership.** `inherit()` is the target's single entry (P20's one-entry-per-zerno). A base
  is *referenced*, not re-wired — exactly as a `when()` condition zerno is — so a base also
  bound standalone is not a `DuplicateWiringError`. The relation pulls any unbound base into
  the binding so its value is resolvable; an unresolvable base surfaces in the aggregated
  `MissingConfigError`.

### Identity

The `inherit` relation is content-addressed as `relv1|` and **references its base by its
identity hash**, folding the base's identity — transitively, its whole ancestry — and the
data-only transform ops into the relation's identity, and therefore into the target's contract:

```ts
identityOf(inherit(cdnOrigin, apiOrigin, { replace: ["api.", "cdn."] }));
// "relv1:xxh128:…"  — folds in both zernos' identities and the transform ops
```

Consequence (accepted — Resolved §1): changing a base's identity (a schema `version` bump, a
new source) or the transform ops cascades a new identity to the inheritor. Consistent with
"sources are identity" and fail-loud; the cascade churn is the accepted cost.

### Bake / client eligibility

- **All-public, build-constant chain (transform included):** bake executes the data ops at
  build time and emits a single resolved literal. Zero runtime cost — and only possible
  because the transform is data, not a function.
- **Any secret link:** impossible for a public target (`InheritanceExposureError`); a secret
  target is not client-eligible anyway (P14).
- **Env-varying public link:** the same unsolved problem as
  [decisions §2](../../site/content/docs/reference/decisions.mdx) (build-once-promote-many /
  runtime-injected JSON). Inherited, not solved here.
- **A variants member as a base:** deferred/rejected for client targets in v1, mirroring
  `VariantsInClientTargetError` — a base that may be inactive is not a stable literal.

---

## Consequences

**Positive**

- The specific-inheriting-from-general shape — including the "same value, lightly adapted"
  variant — stops being duplicated literals that drift; it becomes one declared, diffable,
  content-addressed relationship.
- Inheritance and the source-level fallback chain compose (`T.sources → base → T.default`)
  instead of competing.
- Layered validation honors *both* contracts and turns schema mismatches between inheritor
  and base into loud bind-time failures.
- The whole thing stays bakeable and identity-safe precisely because the transform is
  data-only — the same discipline that keeps wiring attestable.

**Negative / costs**

- **A second value-provision axis** (sources, inheritance, default) with a precedence order
  to learn. Mitigation: one canonical ordering, shown in `explain()`.
- **Identity cascade.** A base's identity change ripples to every inheritor, widening the
  blast radius of diamond-install `DescriptorMismatchError`s. Accepted cost (Resolved §1);
  `by key + schemaId` is the recorded fallback if churn bites.
- **A blessed op vocabulary is a maintenance surface** and will attract "just one more op"
  pressure — the same slope the wiring transform API sits on. The mitigation is the same:
  hold the line at data massaging; push real logic into the target's schema.
- **Declaration-time base references** couple descriptors (one zerno imports another). Bounded,
  but it is the monolith-through-imports hazard in miniature; keep inherited pairs in the
  same module where possible.

**Security posture**

- Exposure guardrail keeps inheritance from becoming a laundering channel (max-secrecy-of-chain,
  fail-closed). Data-only transforms keep the inherited path off the function-as-leak-surface
  and off the build-time-RCE surface.

---

## Decision log (review rounds)

The sub-questions raised while reviewing this ADR, with outcomes — §1–§7 resolved
(date-stamped by round), §8 deferred.

1. **Resolved (2026-07-08): reference the base by full identity.** A differently-shaped base
   *is* a different contract, so it cascades a new identity to every inheritor — no silent
   base swap, consistent with the `default`-in-hash doctrine (decisions §1). The accepted
   cost is cascade churn: a base release ripples `DescriptorMismatchError`/`unify` across its
   inheritors. `by key + schemaId` (cascade only on the base's validation contract) is
   recorded as the fallback if that churn proves painful in practice.
2. **Resolved (2026-07-08).** Ship the minimal data-op set (`replace`/`template`/`prepend`/
   `append`/`multiply`/`add`); the named-and-versioned transform escape hatch is deferred
   until a real case appears. The shape stays data-only regardless.
3. **Resolved (2026-07-08): layered validation, carrying the base's validated *output*.**
   The base resolves and validates through its own declaration; that output is transformed
   and re-validated through the target's schema. Carrying the base's *raw* instead — skipping
   the base's own validation — was rejected: it would let a zerno inherit a value the base
   itself rejects.
4. **Resolved (2026-07-08).** Ordering is `T.sources → base (fully resolved) → T.default`.
   An *invalid* inherited value is **loud by default** (D4), never silently defaulted;
   resilience (coast to the target's default) is a bind-site opt-in
   (`{ invalid: [useDefault(zerno)] }`), never a descriptor `strict` field. The default thus
   serves as both absence-floor and resilience target — not dead code.
5. **Resolved (2026-07-08): reject `snapshot`-inherits-`live`** (`InheritanceFreshnessError`),
   asymmetric — `live`-inherits-`snapshot`/`live` are fine. Promotion rejected (spooky
   freshness change). Two v2 escape candidates, neither shipped in v1: *snapshot-at-bind*
   (dev-warning + provenance), or a new **`latch`** freshness — first-valid-then-frozen, which
   handles a base that is flaky at boot better than snapshot-at-bind. `latch` is a *general*
   freshness concern in its own right (a third type-state between `Snapshot` and `LiveBinding`;
   poll-on-read detection under P10; config-vs-state per P16), not inheritance-specific — so it
   is tracked as its own item (rejifald/komirka#14), not designed here. Today's escape is to declare the target `live`.
   Accepted cost: a boot-only `snapshot` zerno can't inherit a `live` base without being forced
   into `live`.
6. **Resolved (2026-07-08): single-base `inherit(T, B)`, transitive.** One parent per zerno
   (B may itself inherit), so the inheritance graph is a forest — **no diamonds**; cycles are
   caught at any depth by `InheritanceCycleError`. Towers are built by composition and cascade
   to one value (the consistency property). *Multiple* inheritance (multi-base
   `inherit(T, B₁, B₂)`) is **deferred** — it is the diamond/footgun case (two independent
   parents, e.g. `SESSION_KEY ← [APP_SECRET, MASTER_KEY]`); the recursive `relv1|` format
   carries it for v2. The earlier "flat dodges the variants-nesting hazard" rationale was
   **wrong** — inheritance has no branches; the real reason for v1's shape is single-parent =
   no diamonds and one canonical form.
7. **Resolved (2026-07-08): keep `inherit()`; drop `via()`.** `inherit` maps to the *value*-
   inheritance models (CSS `inherit`, prototypal lookup), not structural inheritance — the
   Scope note draws that line. Transform ops are an optional third argument
   `inherit(target, base, ops?)`; the `via()` wrapper is gone (it only existed to tag one base
   in a multi-base list, which §6 removed). `fallback()` stays rejected (collision). Errors are
   `Inheritance*Error`.
8. **App-imposed bind-time inheritance (deferred).** If demand appears, what is its
   identity/attestation story as a wiring-family combinator — recorded in the lockfile,
   data-only, exposure-banned — without weakening the identity guarantee D1 rests on?

---

## Scope — what this ADR is *not*

- **Not descriptor-field / template inheritance.** Reusing another zerno's *schema*,
  *exposure*, or *doc* at construction is already possible because a zerno is plain frozen data
  built from an options object — userland object spread covers it
  (`zerno({ ...baseOpts, key: "…" })`). That is a construction-time convenience, not a
  relation. This ADR is strictly about **value** inheritance/derivation at *resolution* time.
- **Not per-request / per-user / context-dependent inheritance.** A `unwrap()` whose inherited
  value depends on request context is a feature-flag / targeting SDK, which P16 and the P19
  scope line refuse. Inheritance here is uniform: one value per process per zerno, through a
  static chain.
- **Not a computed-expression language.** The transform is data-only massaging, not a DSL.
  Logic that a data op cannot express belongs in the target's Standard Schema, which is
  already BYO, already validated, and already runs on the inherited value.
