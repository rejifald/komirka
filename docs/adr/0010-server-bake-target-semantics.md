# ADR 0010 — Server bake-target semantics (the wiring module checks presence, nothing else)

- **Status:** Accepted (2026-07-09; design phase — no code yet)
- **Date:** 2026-07-09
- **Deciders:** project author
- **Constitution touchpoints:** P4 (BYO validation via Standard Schema only — validators are
  closures and **do not serialize**, which is the whole reason this question exists), P6
  (bundle-frugal, zero runtime dependencies — the reason the emitted module imports nothing), P8
  (eager validation over the bound subset — tier 2's job), P13/P14 (bake declares targets; it
  never resolves secret values), P15 (emitted env access must be inline-proof — dynamic computed
  access, never `process.env.KEY`), P17 (honest claims — the module states what it does *not* check)
- **Related docs:** [`bake/overview`](../../site/content/docs/bake/overview.mdx) ("The server
  wiring module: names, never values"),
  [`reference/decisions`](../../site/content/docs/reference/decisions.mdx) §4 (this question),
  §10 (this pointer), [`guides/node-server`](../../site/content/docs/guides/node-server.mdx);
  resolves issue #30
- **Builds on:** [ADR 0003](./0003-client-read-api-and-bake-staleness.md) — the client tier gets
  zero-runtime-dep *and* validation because its values are build-constant and validation already
  happened at bake. This ADR settles the tier where that trick is unavailable.

> Engineering decision record, kept apart from the published design site. Records *why* and
> what it costs, not the final reference prose.

---

## Context

For the **client** target there is no tension: public values are validated at bake time, then
inlined next to a ~30-line shim that imports nothing. Zero runtime dependency *and* validated —
validation simply happened earlier, which is sound because the values are build-constant
(ADR 0003).

For **servers** the tension is structural. Validators are BYO Standard Schema objects — closures.
They do not serialize into a generated module (P4), and bake deliberately never resolves secret
values (P14). So for any value that varies per deployment — every secret, every per-environment
variable — **zero-runtime-dep and runtime schema validation are mutually exclusive.** You cannot
inline what you refuse to resolve, and you cannot re-validate without the validator.

Two things follow, and §4 left the second one open:

1. The **two-tier story** (build-constant → bake; runtime-varying → runtime bind) is the answer to
   the headline question, and it needs to be recorded as settled rather than "the lean."
2. The optional generated **server wiring module** already reads env dynamically. What does it
   actually *check*? Candidates: presence-only at boot (schema-free, still catches the deploy that
   forgot a var), or pure enumeration with no checks at all.

Explicitly **off the table**, and staying off it: serializing validators via generated code, or a
mini validation DSL embedded in baked output. Both collide head-on with BYO Standard Schema (P4)
and the bundle-frugality gate (P6).

No spike: the mechanics are already settled (P15's dynamic computed access was proven
non-foldable in the #20 browser spike). This is a shape decision about what the emitted module does.

---

## Decision drivers

- **A forgotten env var is the single most common server misconfiguration**, and the one failure a
  schema-free module *can* still catch. Catching it at boot, naming every offender at once, is
  most of the value of the module.
- **P6 — the module must be able to import nothing.** StitchAPI consumes this library as a
  *devDependency* and bakes at build time to keep a zero-runtime-dependency published package. A
  server module that imports core to throw a typed error forfeits exactly that.
- **P4 — validators cannot be in the artifact.** Any check the module performs must be
  schema-free by construction, or it is a lie about which validator ran.
- **P15 — inline-proof access.** Whatever the module reads, it reads via `process.env[keys[i]]`.
- **P17 — the module must not imply it validated.** Presence is not validity. If the module says
  nothing about types, the docs must say so plainly, or operators will assume boot-time checking
  they did not get.

---

## Considered options

- **A. Presence-only checks at boot** *(chosen)*. The module enumerates the declared env key names,
  reads each via dynamic computed access, and throws one aggregated, named error listing every
  missing key. Schema-free.
- **B. Pure enumeration, no checks** *(rejected)*. The module exposes the key list and dynamic
  accessors and verifies nothing. Smallest possible surface — but it gives the operator nothing
  they could not get by reading `process.env` themselves, and a forgotten variable surfaces later
  as an undefined propagating into a connection string. The module's entire reason to exist is to
  turn that into a boot failure.
- **C. Serialize validators / embed a mini-DSL** *(rejected, and permanently)*. Collides with P4
  (Standard Schema is `validate()`-only, closures, no introspection) and P6 (a DSL interpreter is a
  runtime dependency by another name). It would also silently diverge from the real schema — the
  worst outcome: a boot check that passes where the runtime bind would fail.

---

## Decision

### D1 — The two-tier story is settled, not a lean

- **Tier 1 — build-constant values: bake them.** Zero runtime dependency. This is how StitchAPI
  consumes the library: devDependency, bake at build, nothing shipped at runtime.
- **Tier 2 — runtime-varying values: runtime-bind them.** The server imports the library as a
  normal dependency and binds at boot with **full schema validation**. Secrets validate at runtime,
  where the value actually lives (P14).

Mandatory bake attaches to the **trust boundary** — untrusted client targets — and trusted servers
may runtime-bind. That same boundary is the axis ADR 0009 cuts along for attestation.

### D2 — The optional server wiring module performs **presence-only** checks at boot

The emitted module enumerates the declared env key **names**, reads each through dynamic computed
access, and throws **one aggregated error naming every missing key** — not the first one.

```ts
// config.baked.server.ts (excerpt) — key NAMES only, never values; imports nothing
const keys = ["DATABASE_URL", "DB_POOL_SIZE", "SMTP_PASSWORD"];

const missing = keys.filter((k) => process.env[k] === undefined); // computed access (P15)
if (missing.length) {
  const err = new Error(`Missing required configuration: ${missing.join(", ")}`);
  err.name = "MissingConfigError"; // same NAME as the runtime bind's error, no import (P6)
  throw err;
}
```

Three properties are normative:

- **Schema-free.** It checks presence, never type, range, or shape. No validator is serialized;
  none could be (P4).
- **Self-contained.** It imports nothing — not even tessellum — so a package that bakes at build
  keeps its zero-runtime-dependency guarantee (P6). It reuses the *name* `MissingConfigError` so
  operators see one vocabulary, without taking the dependency that owning the class would require.
- **Inline-proof.** Access is `process.env[k]`, never `process.env.DATABASE_URL`, so a bundler's
  `define`/DefinePlugin has no static member expression to fold into a literal secret (P15).

### D3 — What the module explicitly does **not** do

It does not validate values, does not carry values, and never carries a secret value. Presence is
not validity: `DATABASE_URL=""` passes a presence check and fails the real schema at the tier-2
`bind()`. The bake docs say this in the same breath as the guarantee (P17), so no operator mistakes
a green boot check for a validated configuration. Full validation is tier 2's job, and it is eager
and aggregated there (P8).

---

## Consequences

**Positive**

- The most common server misconfiguration — a deploy that forgot a variable — becomes a named boot
  failure listing every offender, instead of an `undefined` surfacing inside a connection string an
  hour later.
- The module keeps the zero-runtime-dependency property intact, so the StitchAPI consumption story
  (devDependency + bake) survives unchanged.
- The two-tier answer stops being "the lean" and becomes the recorded contract, so nobody relitigates
  "why can't the server target be zero-dep *and* validated."
- The `MissingConfigError` name is shared without sharing the class — one vocabulary, no dependency.

**Negative / costs**

- **Presence is not validity**, and some operators will read a passing boot check as more assurance
  than it is. The mitigation is documentation, not machinery (P17), because the machinery that would
  fix it is exactly what P4/P6 forbid.
- **An empty string passes.** `KEY=""` is "present." Making empty-string a failure would be a
  type-ish judgment the module has no schema to justify; tier 2 catches it.
- **A second place that knows env key names** (the module and the manifest) — kept honest because
  both are generated from the same declared tesserae, and `bake --check` gates drift.

**Security posture**

- The module carries **names only**, never values, so it can be committed and read freely. It never
  resolves a secret (P14), and its dynamic access is inline-proof (P15), so it cannot become the
  vector where a bundler folds `SMTP_PASSWORD` into an artifact.

---

## Scope — what this ADR is *not*

- **Not a validation mechanism.** No serialized validators, no DSL — now or later. The tier-2
  runtime bind is where schemas run.
- **Not mandatory.** The server wiring module remains **optional**, per `server` target. Mandatory
  bake attaches to the client trust boundary only.
- **Not the attestation decision.** Whether a server bind *verifies the committed wiring digest* is
  ADR 0009 (`attest`, opt-in for servers).
- **Not a claim that an empty variable is configured.** Presence-only means presence-only.
