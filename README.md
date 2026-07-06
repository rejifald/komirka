# komirka

> **Design phase — no code yet.** Package name: **`komirka`** (комірка — the Ukrainian word
> for a memory/spreadsheet cell: one small addressed slot holding one value). Published on
> npm as a 0.0.0 name-reservation placeholder; repo is
> [github.com/rejifald/komirka](https://github.com/rejifald/komirka). The primitive is
> **`zerno`** (зерно — Ukrainian for a grain/seed: one small unit of config).

Atomic configuration: each config value is an inert, importable, documented, validated
descriptor — bound explicitly per runtime (Node, Cloudflare Workers, browsers, tests),
with secrets fail-closed by construction. BYO validation via Standard Schema; zero runtime
dependencies; descriptors round-trip as JSON.

## In this repo

- **[`principles.md`](./principles.md)** — the project constitution: every hard
  constraint, every pitfall identified through adversarial design review, and the full
  security model. Read this first; every future feature must pass it.
- **[`site/`](./site)** — the design presented as a documentation website (fumadocs).
  The fastest way to evaluate the design is to read it as if the library existed:

  ```bash
  cd site
  pnpm install
  pnpm dev        # http://localhost:3000
  ```

  Start at **/docs** (overview), then **/docs/principles**, then the guides
  (Node, Workers, browser, testing, live config on Kubernetes).

## Status

- Design produced through two adversarial multi-agent review rounds (prior-art sweep,
  five design lenses, six attack passes) — the surviving decisions are recorded in
  `principles.md` and presented across the site.
- First planned consumer: [StitchAPI](https://github.com/rejifald/StitchAPI), as a
  devDependency via the build-time `bake` step (zero runtime dependency).
- v0.1 proof gate: a demo repo where one zernos file is consumed unchanged by a Node
  server, a Cloudflare Worker, a Vite client (with bake failing the build on a planted
  secret leak), and a vitest suite with zero `process.env` mutation.

## Related projects

- **[yakir](https://github.com/rejifald/yakir)** — drift prevention: keeps *one fact
  represented across many artifacts* (code, docs, generated files) in sync. Complementary and
  deliberately distinct — komirka is config (one authoritative slot a runtime reads); yakir is
  consistency across representations (no single source). See
  [principles §8](./principles.md#8-relationship-to-yakir-drift-prevention).
