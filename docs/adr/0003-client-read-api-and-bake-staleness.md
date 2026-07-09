# ADR 0003 — Client read API and bake staleness (baked handles)

- **Status:** Accepted (2026-07-09; design phase — no code yet)
- **Date:** 2026-07-09
- **Deciders:** project author
- **Constitution touchpoints:** P5 (browser-first — no Node/schema weight in the client
  path), P6 (bundle-frugal, measured), P11 (content-addressed identity), P13 (bake is the
  only client delivery channel), P17 (honest claims)
- **Related docs:** [`guides/browser`](../../site/content/docs/guides/browser.mdx),
  [`bake/overview`](../../site/content/docs/bake/overview.mdx),
  [`reference/errors`](../../site/content/docs/reference/errors.mdx) (`StaleBakeError`);
  resolves issue #20

> Engineering decision record. Records *why* and what it costs, not the final reference prose.

---

## Context

The browser guide had client code import the **real descriptor** to use as the `unwrap()`
key:

```ts
import { config } from "./config.baked";
import { apiBaseUrl } from "./config.tesserae"; // <-- imports zod + every schema
config.unwrap(apiBaseUrl);
```

`config.tesserae` imports `zod` and constructs schemas, and a bundler cannot tree-shake a
schema that is a live property of an object passed to `unwrap()`. So the flagship
"zero runtime dependency" client — the whole point of bake removing "the real bundle
payload" (principles §1) — shipped `zod` and every client schema anyway. The same import
also **violates the design's own client-graph lint** ("no `*.tesserae.ts` reachable from a
client entry", bake defense stack / conditional.mdx cost note).

An empirical bundle test (esbuild `--bundle --minify`, `scratchpad/bundle/`) quantified it:

| client entry | minified | gzip | zod present? |
| --- | --- | --- | --- |
| imports the real descriptor | 328,078 B | 65,401 B | `ZodError`, `invalid_type`, `too_small` |
| imports a baked handle | 565 B | **393 B** | **none — fully absent** |

Identical runtime output. The descriptor path is ~166× larger gzip, entirely from `zod`.

The tension is structural: a **runtime** `StaleBakeError` requires the client to reference
the real (upgradable) descriptor so it can hash-check it — which is exactly what reships the
schema. You cannot have both a runtime staleness net *and* a schema-free client bundle.

## Decision

**Option 1 — baked handles + build-time staleness.**

1. **Bake emits a per-tessera handle.** For each client-target tessera, the generated
   `config.baked` module exports a lightweight **handle** — brand + `key` + identity hash +
   a phantom `Tessera<V>` type, **no schema** — alongside the public literal value and the
   ~30-line shim. Client code reads through the baked module only:

   ```ts
   import { config, apiBaseUrl } from "./config.baked";
   config.unwrap(apiBaseUrl); // typed, synchronous, zero runtime dependency
   ```

   It never imports the real descriptor. Types still flow through `import type` (erased at
   build, no runtime cost), so a library API typed `Scope<ConfigOf<typeof widgetTesserae>>`
   keeps working. The existing **client-graph lint** ("no `*.tesserae.ts` reachable from a
   client entry") is what enforces handle-only imports — Option 1 is what makes that lint
   satisfiable.

2. **`StaleBakeError` is a build-time guarantee in prod, plus an automatic dev-mode runtime
   check.** `bake --check` in CI re-derives every artifact and fails on drift — that is the
   production guarantee. On top of it, the generated module carries a **dev-only** runtime
   hash check for fast local feedback ("you changed a schema, re-bake"). It must be emitted
   so a prod build strips it entirely: the descriptor is reached only through a **dynamic
   import inside a `NODE_ENV !== "production"` branch** (or a separate dev module), never a
   static import. Proven (`scratchpad/bundle/`): the dynamic-import prod bundle is **414 B
   gzip with zod absent**, and the dev build code-splits the descriptor + zod into a lazily
   loaded chunk. A **static** descriptor import does *not* strip — it retains ~65 KB of zod in
   prod (the trap this clause exists to prevent).

## Options considered

- **Option 1 *(chosen)*** — handles + build-time staleness. Zero-dep client, runtime net
  moves to CI.
- **Option 2** — keep `unwrap(realDescriptor)`, accept `zod` in the client, and correct the
  "zero runtime dependency" claim. Rejected: concedes a flagship guarantee for a runtime net
  that `bake --check` already provides at build time.

## Consequences

**Positive**

- "Zero runtime dependency" is now literally true and measured (393 B gzip vs 65 KB) —
  honest per P6/P17.
- Resolves the browser-guide-vs-client-graph-lint contradiction.
- `import type` keeps cross-package `Scope` typing working with no runtime weight.

**Negative / costs**

- In **production** there is no runtime `StaleBakeError` net (the dev check is stripped):
  `bake --check` in CI is load-bearing and must be enforced. A stale bake that bypasses the
  gate reaches prod as a wrong/missing value (`NotInScopeError` or an outdated literal), not a
  runtime error. Documented prominently. (Dev builds *do* get the runtime check.)
- Bake must generate typed handles **and** a dev-only check wired through a dynamic import /
  separate dev module — a codegen surface, and a constraint (a static descriptor import would
  silently re-ship zod to prod, as the spike showed).

**Notes**

- Handles carry the identity hash for the opt-in runtime check and for `explain()`
  provenance; the shim still carries the `Scope` brand.
- Secret tesserae never get a client handle — bake never resolves secret values, so nothing
  secret is emitted (P14, unchanged).
- Test code and server code may still import real descriptors (they are not the client
  bundle); the lint scopes to client-reachable graphs only.
