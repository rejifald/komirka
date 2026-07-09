# ADR 0002 — Secret value representation (the `Secret` wrapper)

- **Status:** Accepted (2026-07-09; design phase — no code yet)
- **Date:** 2026-07-09
- **Deciders:** project author
- **Constitution touchpoints:** P4 (the zerno's type is the schema's output), P7 (fail-closed
  exposure), P9 (`Snapshot` immutability), P17 (honest claims — every guarantee states its
  boundary)
- **Related docs:** [`concepts/secrets`](../../site/content/docs/concepts/secrets.mdx),
  [`concepts/binding`](../../site/content/docs/concepts/binding.mdx),
  [`reference/errors`](../../site/content/docs/reference/errors.mdx) (`ExposureError`),
  [`reference/decisions`](../../site/content/docs/reference/decisions.mdx) §8 (`Redacted<T>`
  rejected for `.values`); resolves issue #19
- **Supersedes:** the prior implicit claim that `unwrap()` of a secret returns a primitive
  `string` that nonetheless throws on `JSON.stringify` / `structuredClone`

> Engineering decision record, kept apart from the published design site. Records *why* and
> what it costs, not the final reference prose.

---

## Context

The secrets model advertised two things about a secret value in the same breath: it is typed
`: string` and "usable anywhere a string is," **and** it throws on `JSON.stringify` and
`structuredClone` (the serialization guard that closes the SSR-payload leak the build-time
scan cannot see). Issue #19 asked whether both can be true at once.

A spike (`scratchpad/secret_guard_spike*.mjs`, Node v22, real zod v4) answered it empirically:

- **A JS primitive string cannot carry any guard.** `JSON.stringify("sk_…")` cannot throw;
  there is no interception hook. So the `: string` + guard pairing is not simultaneously
  realizable for a primitive.
- **A boxed `String` is porous.** It guards `JSON.stringify` (via a throwing `toJSON`) but
  **not** `structuredClone` (which special-cases String exotics and ignores added
  properties), and `{ ...secret }` spreads it to a character map that serializes cleanly — a
  leak the `toJSON` guard gives false confidence about.
- **A `Proxy` over a plain object is complete.** It guards `JSON.stringify`
  (`ExposureError`), `structuredClone`/`postMessage` (proxies are categorically
  non-cloneable → `DataCloneError`), redacts under `util.inspect`, and leaks nothing under
  spread (`ownKeys → []`), while forwarding coercion (`Symbol.toPrimitive`/`toString`/
  `valueOf`) and string methods to the raw so it stays usable as a string.

A realistic gauntlet (real zod, Node `crypto`) then pinned down the residual costs of the
Proxy: `typeof` is `"object"`, so `z.string().parse(secret)` rejects it and
`crypto.createHmac("sha256", secret)` throws — both fixed by an explicit reveal, but neither
caught by the compiler if the value is typed `string`. Derived strings (`` `${s}` ``,
`"x" + s`, `s.slice()`) remain plain unguarded strings — the guard catches the
*dump-the-value* class, never the *interpolate-into-a-message* class.

## Decision drivers

1. **P17 — honest claims.** Whatever we ship, its boundary must be stated in the same
   breath. "Throws on structuredClone" must be *true*, or gone.
2. **Flagship ergonomics.** "Usable anywhere a string is" is a headline; a `.reveal()` on
   every read is the ceremony `Redacted<T>` was rejected for in decisions §8.
3. **Secret-by-default equilibrium.** Because `exposure` defaults to `secret`, *most* reads
   are secret. Any per-read tax pushes teams toward `exposure: "public"` — the worse
   security equilibrium (decisions §8).
4. **Defense-in-depth, not a single gate.** komirka already runs an AST lint for
   client-designated env reads; a lint is an available, in-character layer.

## Considered options

- **A — honest primitive `string`, no value-level guard.** Simplest and fully honest, but
  drops the SSR tripwire entirely.
- **B — dev-only boxed tripwire.** Real string in prod, boxed String in dev. Honest, but the
  boxed guard is porous (no `structuredClone`, spread leak) even in dev.
- **C1 — Proxy typed as `string`.** Full guard, zero ceremony — but `crypto`/`zod` typecheck
  failures compile green and throw at runtime, with no compiler help.
- **C2 — Proxy typed as `Redacted<string>`.** Compiler forces `.reveal()` at the dangerous
  sinks, but also at every ordinary coercing SDK call — the decisions §8 tax.
- **Hybrid *(chosen)* — Proxy + string-assignable brand + targeted lint.**

## Decision

Adopt the **hybrid**. `unwrap()`, `.value`/`.values`, and `match()` values of a
**secret-exposure** zerno return a Proxy-based **`Secret<T>`**.

### Type

```ts
type Secret<T> = T & { readonly reveal: () => T; readonly [secretBrand]: true };
```

`Secret<T>` is **assignable to `T`** — usable anywhere a `T` is, with no reveal ceremony for
coercion. `zerno()` brands the descriptor's output type when `exposure` is `secret` (the
default): `zerno({ schema: z.string() })` is `Zerno<Secret<string>>`; an
`exposure: "public"` zerno is `Zerno<string>`. Exposure thus rides *inside* the existing
`Zerno<T>` type parameter — no new type parameter on `Snapshot`/`bind`, and `unwrap<T>` stays
generic. `.reveal(): T` returns the raw; `isSecret(v)` is the runtime brand check.

### Runtime (Proxy over the raw)

- Forwards `Symbol.toPrimitive`, `toString`, `valueOf`, and string methods to the raw — so
  `` `${s}` ``, `"B " + s`, `s.startsWith(...)`, `Buffer.from(s)`, `new URL(base + s)`, and
  `String(s)` all work.
- `toJSON` throws `ExposureError` → `JSON.stringify` throws.
- The object is non-cloneable → `structuredClone` / `postMessage` throw `DataCloneError`
  (this is the RSC / App-Router boundary a boxed String could never guard).
- `util.inspect` / `console.log` redact; `ownKeys` is empty so `{ ...s }` leaks nothing.
- `.reveal(): T` is the single, greppable escape; `set`/`defineProperty`/`deleteProperty`
  throw (immutable).

### Boundaries — stated, not hidden (P17)

- **The guard travels with the value, not with strings derived from it.** `` `${s}` ``,
  `"x" + s`, and `s.slice()` produce plain, unguarded strings. The guard catches the
  *structural* leak class (a secret dumped into JSON, a clone, a logged object), never the
  *coercion* leak class (a secret interpolated into a log message).
- **`typeof s === "object"` and `s === "raw"` is false.** Code that *typechecks* a string
  input rejects a secret — confirmed against real `z.string().parse` and
  `crypto.createHmac`. The fix is `.reveal()` at that boundary.

### The lint (defense-in-depth for the typecheck sinks)

Because `Secret<T>` is assignable to `T`, the compiler will not force `.reveal()`. A targeted
AST lint — the same layer that bans raw client env reads — flags a secret-typed (or
`isSecret`-detected) value passed to `crypto.*`, to `JSON.stringify` / `structuredClone`, or
interpolated into a logger call, recommending `.reveal()`. This catches the residual
footguns statically without taxing the ordinary coercing read.

## Consequences

**Positive**

- The full structural-leak guard, `structuredClone` **included** — so the honest claim
  survives contact with modern SSR/RSC.
- Flagship "usable anywhere a string is" is preserved: no `.reveal()` for the ~90% of reads
  that hand a value straight to a coercing SDK.
- The residual sharp edges (`crypto`, `JSON.stringify`, log interpolation) are caught by a
  narrow lint rather than a type tax that §8 showed drives teams to `public`.

**Negative / costs**

- `typeof`/strict-equality surprises for code that typechecks its input; mitigated by the
  lint and `.reveal()`, not by the compiler.
- `Secret<T>` assignable to `T` means a widening annotation (`const x: string = s`) drops the
  brand — the same widening class as `freshness`; the lint targets direct sinks, not
  laundered values.
- Proxy trap overhead per property access — negligible for construction-time reads; avoid
  reading a secret in a hot loop.
- The exposure→brand conditional typing, and `Secret<T>`-assignable-to-`T`, are TypeScript
  claims that must be proven in the #6 type-view spike.

**Implementation notes**

- `unwrap()` must **memoize one Proxy per `(binding, zerno)`** so value identity is stable
  (`===`, Map/Set keys).
- The `has` trap must box the raw (`p in Object(raw)`), or a validator probing
  `"constructor" in value` (real zod v4) throws.
- The `util.inspect` custom hook is cosmetic polish; redaction already holds via empty
  `ownKeys`.
- Only secret-exposure zernos are wrapped; public zernos return the raw `T`. `literal()` /
  `secretLiteral()` and provider-sourced secrets all funnel through the same wrapper at read.
