# Architecture Decision Records

Engineering decision records for komirka, kept apart from the published design site
(`site/content/docs`, which presents the library "as if it existed"). Each ADR records the
context, the options weighed, the decision, and what it costs.

The project's running list of *open* questions lives in the single
[`decisions.mdx`](../../site/content/docs/reference/decisions.mdx) registry —
[`principles.md`](../../principles.md) §6 points there rather than keeping a second copy.
ADRs here are the longer-form records for decisions that need room to show their work, and
the registry links to each one as its question gets settled.

| # | Title | Status |
| --- | --- | --- |
| [0001](./0001-zerno-inheritance.md) | Zerno inheritance and derivation (value fallback and transform across descriptors) | Accepted |
| [0002](./0002-secret-value-representation.md) | Secret value representation (the `Secret` wrapper) | Accepted |
| [0003](./0003-client-read-api-and-bake-staleness.md) | Client read API and bake staleness (baked handles) | Accepted |
