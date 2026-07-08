# komirka

Atomic configuration. Each value is a **zerno**: one self-contained atom — name, validator,
docs, and secrecy in inert, importable data — bound explicitly per runtime (`process.env` on a
server, the request `env` on a worker, a literal in a test, a baked constant in the browser).

Secret by default: a zerno is a secret unless you mark it public, and secrets never reach the
browser by construction.

Validation, live values, value inheritance, conditional config — all built in.

> **Design phase — no code yet.** This repository *is* the design: [`principles.md`](./principles.md)
> is the constitution, and [`site/`](./site) presents it as documentation you can read as if the
> library already shipped. **`komirka`** (комірка — Ukrainian for a memory/spreadsheet cell: one
> small addressed slot holding one value) is reserved on npm as a `0.0.0` placeholder; the
> primitive is **`zerno`** (зерно — a grain). Repo:
> [github.com/rejifald/komirka](https://github.com/rejifald/komirka).

## One value, every runtime

t3-env, envalid, and znv validate config correctly — but each loads and validates every value in
one import-time call. That monolith can't bind to a Cloudflare Worker's per-request `env`, and it
treats every value, secret or not, as an ordinary string. As per-value atoms, the same zerno
works across every runtime, and secrets are fail-closed by construction.

## Declare once, bind explicitly

Declare the atoms once. Each runtime binds the same values — the zernos never change.

```ts
// config/db.ts — inert zernos. Importing this file costs bytes, not behavior.
import { zerno } from "komirka";
import { z } from "zod";

export const dbUrl = zerno({
  key: "DATABASE_URL",
  schema: z.string().url(),
  doc: "Primary Postgres connection string",
  // exposure defaults to "secret" — fail closed
});

export const poolSize = zerno({
  key: "DB_POOL_SIZE",
  schema: z.coerce.number().int().min(1).max(100),
  default: 10,
  exposure: "public",
});
```

```ts
// Node — eager validation of exactly what this entrypoint binds, at boot
import { bind, env } from "komirka/node";
const cfg = bind({ db: env(dbUrl, "PLATFORM_PG_URL"), pool: poolSize });
```

```ts
// Cloudflare Workers — the same zerno, bound to the per-request env bag
// (the case import-time validators structurally cannot serve)
import { bind } from "komirka/workers";
const cfg = bind(dbUrl, { env }); // inside fetch(req, env) — the bag is required, never ambient
```

```ts
// Tests — literal values, zero process.env mutation
import { bind, literal } from "komirka";
const cfg = bind({ db: literal(dbUrl, "postgres://localhost:5432/test") });
```

```ts
// Browser — no binding at all: config arrives as baked literals, secrets structurally excluded
import { config } from "./config.baked";
```

komirka has zero runtime dependencies; validators plug in through the Standard Schema interface,
so any schema library that implements it works.

## Gates, not guidelines

Every feature passes all of them, or it doesn't ship. The load-bearing few — the full set
(P1–P21) lives in [`principles.md`](./principles.md):

- **Zernos are inert data.** Constructing one does zero I/O, zero validation, zero registration,
  zero side effects.
- **Values live only in explicit bindings.** No ambient global, no module-scope cache; a read
  outside an active binding is a named error, never a silent fallback.
- **Browser-first, runtime-universal core.** No Node APIs in the core entry; `process.env` and
  file sources live in subpath entries.
- **Fail-closed exposure.** `secret` is the default; `public` is the explicit opt-in.
- **Bake is the only client delivery channel** — it inlines public values as literals and
  leaves secrets out of the client entirely. A secret's value is never resolved at build time;
  it's read at runtime, where the value lives.
- **Identity by value, not by import.** A zerno's identity comes from its own definition —
  name, validator, sources, exposure — not from where it's imported. Two packages can agree on
  the same config contract without sharing a monolith, and a mismatch fails loudly instead of
  drifting silently.
- **Config, not state.** If it can change while the process runs, it's state — reached by an
  explicit `live` zerno over a re-readable source, never by streaming or subscriptions.
- **Honest claims.** Every guarantee states its boundary in the same breath — what the leak scan
  cannot see, what `pick()` does not defend against. A security story that overclaims is itself a
  vulnerability.

## Design today, code next

- **Read the design as documentation.** The fastest way to evaluate komirka is to read the site
  as if the library already shipped:

  ```bash
  cd site
  pnpm install
  pnpm dev        # http://localhost:3000
  ```

  Start at **/docs** and **/docs/principles**, then the concept pages (zerno, binding, identity,
  secrets, conditional config, freshness) and the runtime guides (Node, Workers, browser,
  testing, live config).
- **[`principles.md`](./principles.md)** — the constitution: every hard constraint, every pitfall
  found through adversarial design review, and the full security model.
- **[`docs/adr/`](./docs/adr)** — accepted design decisions, each recording *why* and what it
  costs (start with [zerno inheritance](docs/adr/0001-zerno-inheritance.md)).
- **v0.1 proof gate:** one zernos file consumed unchanged by a Node server, a Cloudflare Worker,
  a Vite client (with bake failing the build on a planted secret leak), and a vitest suite with
  zero `process.env` mutation.
