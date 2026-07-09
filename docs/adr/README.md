# Architecture Decision Records

Engineering decision records for tessellum, kept apart from the published design site
(`site/content/docs`, which presents the library "as if it existed"). Each ADR records the
context, the options weighed, the decision, and what it costs.

The project's running list of *open* questions lives in the single
[`decisions.mdx`](../../site/content/docs/reference/decisions.mdx) registry —
[`principles.md`](../../principles.md) §6 points there rather than keeping a second copy.
ADRs here are the longer-form records for decisions that need room to show their work, and
the registry links to each one as its question gets settled.

| # | Title | Status |
| --- | --- | --- |
| [0001](./0001-tessera-inheritance.md) | Tessera inheritance and derivation (value fallback and transform across descriptors) | Accepted |
| [0002](./0002-secret-value-representation.md) | Secret value representation (the `Secret` wrapper) | Accepted |
| [0003](./0003-client-read-api-and-bake-staleness.md) | Client read API and bake staleness (baked handles) | Accepted |
| [0004](./0004-async-snapshot-coherence.md) | Async snapshot cross-key coherence (coherence groups) | Accepted |
| [0005](./0005-async-read-deadline-and-boot-outage.md) | Async re-read deadline and boot-outage policy (`readTimeoutMs` / `readyTimeoutMs`) | Accepted |
| [0006](./0006-atomic-setmany-vs-write-batch.md) | Atomic `setMany` vs. `maxWriteBatch` (an atomic write cannot span chunks) | Accepted |
| [0007](./0007-cross-install-identity-and-library-consumption.md) | Cross-install branded-type identity and library-author consumption (structural `Scope` brand, peer-dep, escape) | Accepted |
| [0008](./0008-env-varying-public-values.md) | Env-varying public values for build-once-promote-many SPAs (rebuild default + one blessed runtime-injected mode) | Accepted |
| [0009](./0009-attestation-strictness.md) | Attestation strictness for rewired deployments (`attest`: mandatory on client targets, opt-in on servers) | Accepted |
| [0010](./0010-server-bake-target-semantics.md) | Server bake-target semantics (the wiring module checks presence, nothing else) | Accepted |
