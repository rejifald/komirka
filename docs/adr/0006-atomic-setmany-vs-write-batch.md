# ADR 0006 — Atomic `setMany` vs. `maxWriteBatch` (an atomic write cannot span chunks)

- **Status:** Accepted (2026-07-09; design phase — no code yet)
- **Date:** 2026-07-09
- **Deciders:** project author
- **Constitution touchpoints:** P17 (honest claims — "atomic" states its size boundary in the
  same breath), P19 (writes are operator-plane, input-typed, write-through; atomicity is
  all-or-nothing including the CAS abort)
- **Related docs:** [`guides/database-config`](../../site/content/docs/guides/database-config.mdx)
  ("Multi-tessera updates: `setMany()`"),
  [`reference/api`](../../site/content/docs/reference/api.mdx) (`AsyncBinding.setMany`,
  `AsyncProvider.limits.maxWriteBatch`, `capabilities.atomicWrites`),
  [`reference/errors`](../../site/content/docs/reference/errors.mdx) (`AtomicBatchTooLargeError`,
  `WriteConflictError`), [`reference/decisions`](../../site/content/docs/reference/decisions.mdx)
  §7 (`setMany` verification is report-only), §10 (this pointer); resolves issue #17
- **Builds on:** [ADR 0004](./0004-async-snapshot-coherence.md) D2 — "one coherent cut is one
  `read()` to one provider." This is its write-side mirror: one atomic write is one `write()` to
  one provider, and cannot span chunks. Base-off-`main` sibling of the open ADR 0004 PR; lands
  after it or resolves the small textual overlap at merge.
- **Supersedes:** the database guide's "Multi-tessera updates" presentation of an atomic
  `setMany` with no size caveat, and `api.mdx`'s unqualified "atomic on `atomicWrites` providers"
  comment.

> Engineering decision record, kept apart from the published design site. Records *why* and
> what it costs, not the final reference prose.

---

## Context

`setMany` on an `atomicWrites` provider promises "one transaction, all-or-nothing, including the
CAS abort." Two other rules in the same contract quietly contradict it once a batch gets large:

- **Chunking is exclusively core's job** — "provider-internal chunking voids `consistentReads`;
  declare `limits` instead." A provider never splits a batch itself; core does, by the provider's
  declared `limits.maxWriteBatch`.
- **`maxWriteBatch` is the store's transaction ceiling.** On an `atomicWrites` provider it is not
  a batching hint — it is the number of entries the store can commit in **one** transaction
  (DynamoDB `TransactWriteItems` caps at 100 items; a Postgres provider may declare a very large
  or effectively unbounded ceiling).

They collide the moment `entries.length > maxWriteBatch`. Core must split the write into
`⌈n / maxWriteBatch⌉` separate `write()` calls, and on an `atomicWrites` provider **each `write()`
call is its own transaction**. A split is therefore *multiple* transactions, and "one
transaction, all-or-nothing" is silently void — not through any bug, but as the direct
consequence of two contract rules meeting. Past `maxWriteBatch`, atomicity is not merely
inconvenient to deliver; it is *physically past what the store can do in one transaction*.

The failure this exposes is the design's own named pitfall — **"Multi-tessera writes tear durable
state."** A crash between the split transactions leaves the **database itself** torn: the
discriminant flipped to `adyen` with its branch values missing, so every replica poisons on next
read (`smtp`-with-no-host, in the pitfall's words). That is the torn durable state the atomic
promise exists to prevent, re-entering through the chunking back door.

A throwaway spike (`scratchpad/spike_17_atomic_setmany.mjs`, Node, no deps, integer version
counters — 15/15 checks) modeled it end to end:

- A 5-entry atomic `setMany` on a `maxWriteBatch: 3` provider chunks `[3][2]`; a crash between the
  two transactions leaves the store durably **torn** —
  `{"pay.provider":"adyen","pay.adyen.apiKey":…,"pay.adyen.merchant":…}` with `region` and
  `webhookSecret` **missing**.
- The **refuse** rule issues **zero** `write()` calls and throws `AtomicBatchTooLargeError` with
  the store **untouched** — no torn state is reachable via this path.
- A within-limit atomic batch is exactly **one** `write()` and genuinely all-or-nothing: a CAS
  miss on any one entry aborts the whole transaction, nothing persists.
- `{ allowNonAtomic: true }` sequences singles in dependency order (branch values first,
  discriminant last) and tears only **benignly** — a crash strands staged-but-unused values, never
  an active branch missing its values.

## Decision drivers

- **P17 — "atomic" must state its size boundary.** An `atomicWrites` `setMany` that silently
  chunks past `maxWriteBatch` is the flagship torn-state guarantee over-promising exactly where it
  is load-bearing.
- **The torn-durable-state pitfall is the one the design most wants shut.** A partially-applied
  discriminant + branch write poisons the whole fleet; it must not re-enter via chunking.
- **"Chunking is exclusively core's job" is a standing invariant.** It cannot be relaxed for
  atomic writes without also reintroducing the `consistentReads`-voiding hazard it exists to
  prevent.
- **The physical fact.** Past `maxWriteBatch`, atomicity is undeliverable by the store — no core
  cleverness commits `> maxWriteBatch` items in one transaction.
- **Fail before I/O.** A refusal core computes from the *declared* `maxWriteBatch`, before any
  write, is deterministic and testable without a live store — strictly better than sending the
  batch and letting the store reject it non-deterministically.
- **Mirror D2.** The read side already settled "one coherent cut = one `read()` to one provider"
  (ADR 0004 D2, `CoherenceGroupSourceError` at bind). The write side is the same shape.

## Considered options

- **A — Silently chunk the atomic `setMany` (the status-quo reading).** Rejected: the tear, and a
  silent over-promise on the guarantee the design most wants honest.
- **B — Require the provider to take the whole set in one transaction (no chunking for atomic
  writes); if it exceeds the store's ceiling, the provider/store rejects it.** Rejected on three
  counts: (1) *physically impossible* past `maxWriteBatch` — handing DynamoDB 150
  `TransactWriteItems` fails at the API, so this merely relocates the failure from a clean
  pre-I/O refusal to a non-deterministic store-side reject; (2) it *contradicts* "chunking is
  exclusively core's job" and lets a provider that fails to enforce its own ceiling silently do
  the wrong thing; (3) it wastes a round trip and cannot be tested without the real store. It is a
  strictly worse spelling of "refuse."
- **C — Refuse the oversized atomic `setMany` up front (chosen).** Before any I/O, if an atomic
  `setMany` has more entries than `maxWriteBatch`, throw `AtomicBatchTooLargeError` naming the
  count, the provider, and the limit, and pointing at the escape hatch. The write-side mirror of
  D2.

## Decision

### D1 — An atomic write is one `write()` to one provider; it cannot span chunks

The invariant, mirroring ADR 0004 **D2** on the write side. Core **never** splits an atomic write
across `write()` calls, because a split is multiple transactions and multiple transactions are not
atomic. On an `atomicWrites` provider, `maxWriteBatch` is therefore the ceiling of a single
all-or-nothing write, not merely a transport chunk size.

### D2 — Refuse an atomic `setMany` that exceeds `maxWriteBatch`, before any I/O

When a `setMany` routed to an `atomicWrites` provider carries more entries than the provider's
`limits.maxWriteBatch`, core throws **`AtomicBatchTooLargeError`** at the call, **before issuing
any `write()`**. The error names the entry count, the provider `id`, and `maxWriteBatch`, and
points at the two escapes (D3). No partial write is possible because no write is attempted — the
spike confirms the store is left completely untouched.

Size is measured as **entry count**, mirroring `maxReadBatch` (a key count). Byte-size ceilings
some stores also impose (DynamoDB's 4 MB per transaction) are a provider-internal limit that
surfaces as a per-entry `{ error }` slot / write failure, not a core pre-check — noted, not
modeled, in v1.

### D3 — The escapes: shrink the set, or opt into `allowNonAtomic`

The atomic guarantee is **capped at `maxWriteBatch`**. A rotate-together set that must be atomic
must fit one batch — which, in practice, means modeling config so a discriminant and its branch
values (the canonical atomic set) stay within the store's transaction ceiling. They overwhelmingly
do: a variant flip is a handful of keys, and `maxWriteBatch` is 100 on DynamoDB and effectively
unbounded on Postgres. The cap bites only a genuinely large atomic set on a small-transaction
store — rare, and far better refused than silently torn.

`{ allowNonAtomic: true }` — the **existing** escape — opts into core sequencing single-entry
writes in dependency order (branch values first, discriminant last), stopping at the first
failure, so a crash mid-batch tears only in the benign direction (staged-but-unused values, never
an active branch missing its values). This escape is **not** gated by `maxWriteBatch` (each write
is a single entry), so it is the answer for a large multi-tessera update that genuinely cannot be
one transaction — the operator trades atomicity for a bounded, benign tear direction, explicitly.

### D4 — Interaction with `setMany` verification (report-only)

`setMany` verification is report-only (`decisions.mdx` §7: report-only "until atomic
revert-of-many has an answer for partially superseded batches"). D2 makes this *cleaner*, not
more complex: because an atomic `setMany` is now always exactly **one** transaction (never a
silent chunk-split), report-mode verification observes one coherent post-state, not a smear across
transactions. For an `allowNonAtomic` sequence, verification is per-sequenced-write report,
matching its per-write, stop-at-first-failure semantics. Batch revert stays deferred; when it
lands it additionally gates on `atomicWrites` and restores the *entire* previous post-state — which
the `maxWriteBatch` cap keeps expressible (one transaction to revert, not a chain of them).

## Consequences

- The torn-durable-state pitfall cannot re-enter via chunking: an atomic `setMany` is one
  transaction or a pre-I/O refusal, never a silent split.
- "atomic on `atomicWrites` providers" now states its boundary (`≤ maxWriteBatch`) — the P17 honesty
  fix, on the guarantee that most needs it.
- **New surface:** `AtomicBatchTooLargeError` (call-time, pre-I/O, refused like `NotWritableError`);
  the `setMany` section and `api.mdx` gain the size caveat; the `verifyProvider()` conformance kit
  can probe that an oversized atomic `setMany` is refused with **zero** writes.
- **Symmetric with the read side.** ADR 0004 D2 (read cut = one `read()` to one provider →
  `CoherenceGroupSourceError`) and this ADR's D1/D2 (atomic write = one `write()` to one provider →
  `AtomicBatchTooLargeError`) are the same rule on both axes: rotate-together config is co-located
  in one store and kept small.
- **Cost:** an atomic all-or-nothing write larger than the store's transaction ceiling is simply
  unsupported; the operator shrinks the set or accepts dependency-ordered non-atomic sequencing.
  That is the honest price of "all-or-nothing" over a real store, and the error says so.

## Scope — what this ADR is *not*

- **Not** ADR 0004's read-cut coherence, and **not** #22's read deadline / boot outage
  ([ADR 0005](./0005-async-read-deadline-and-boot-outage.md)). This is the durable-**write**
  atomicity axis only.
- **Not** a change to the non-atomic path. Refuse-by-default for a multi-entry write to a
  non-atomic provider, and `{ allowNonAtomic: true }` dependency-ordered sequencing, are unchanged;
  D2 only adds the `maxWriteBatch` ceiling to the **atomic** path.
- **Not** byte-level batch sizing: v1 measures `maxWriteBatch` as entry count; store-side byte
  ceilings surface as write failures.
- Stays behind **P19**: `setMany` remains operator-plane, input-typed, write-through. The cap
  constrains one write; it adds no plane, no watch, no per-request context.
