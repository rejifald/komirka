# ADR 0004 — Async snapshot cross-key coherence (coherence groups)

- **Status:** Accepted (2026-07-09; design phase — no code yet)
- **Date:** 2026-07-09
- **Deciders:** project author
- **Constitution touchpoints:** P16 (config not state), P17 (honest claims — every guarantee
  states its boundary), P19 (writes are operator-plane, input-typed, write-through)
- **Related docs:** [`concepts/freshness`](../../site/content/docs/concepts/freshness.mdx),
  [`guides/database-config`](../../site/content/docs/guides/database-config.mdx),
  [`reference/api`](../../site/content/docs/reference/api.mdx) (`AsyncBinding`, `Provenance`),
  [`reference/errors`](../../site/content/docs/reference/errors.mdx)
  (`CoherenceGroupSourceError`, `CoherenceError`, `WriteConflictError`),
  [`reference/decisions`](../../site/content/docs/reference/decisions.mdx) §7 (async reads),
  §10 (this pointer); resolves issue #21
- **Supersedes:** the prior claim that `AsyncBinding.snapshot()` delivers cross-key coherence
  through a "batch read for expired keys only", and the database-guide CAS-retry recipe that
  read a `explain().version` the `Provenance` type never defined and could not make progress

> Engineering decision record, kept apart from the published design site. Records *why* and
> what it costs, not the final reference prose.

---

## Context

The per-request pin is sold as the cure for torn config: bind once in middleware, and
"this request sees exactly one generation" — the DB host and the password that was rotated
with it never split across a generation boundary. `concepts/freshness` states it plainly
("guaranteed same generation as target"), and principle **P17**'s own worked example is
precisely a rotated `db.host` + `db.password` pair.

For **file** sources the guarantee is structural: a file is read atomically, so one read
serves every tessera backed by it — "one coherent pass per source." For **provider**
sources it was not. `AsyncBinding.snapshot()` was specced as "a batch read for expired keys
only" (`reference/api.mdx`): if the cache is fresh it costs zero I/O, and if some keys have
exceeded `maxStalenessMs` it re-reads *exactly those keys*. Caches drift out of phase in
normal operation — write-through `set()`, a prior partial pin, and the poisoned-slot
staleness bypass all stamp a per-key `cachedAt`. So a pin can mix a just-re-read key
(generation N+1) with a still-cached sibling (generation N): torn config across a related
pair, the exact failure the pin advertises it prevents. `consistentReads` did not save this
— it governs whether *one* `read()` call is one cut, not whether the cached keys a pin did
*not* re-read belong to the same generation as the ones it did.

Two downstream breakages fell out of the same gap. The `database-config` "Concurrent
writers" CAS-retry loop re-pins with `snapshot()` to get a fresh version after a
`WriteConflictError`, but a still-fresh key is never re-read, so `ifVersion` stays stale and
every retry re-conflicts — no progress. And the loop reads `snap.explain(rateLimit).version`,
a field `Provenance` never defined.

A spike (`scratchpad/snapshot_coherence_spike.mjs`, Node, no deps, deterministic manual
clock) modeled the async cache + snapshot logic and confirmed all of it empirically:
out-of-phase related keys **tear** under expired-keys-only; re-reading them as one cut is
**coherent** (and cost one round trip when they fit one batch); the CAS loop **gives up
after 3 attempts** as written and **converges in 2** once a conflict forces an authoritative
re-read.

## Decision drivers

- **P17 — honest claims.** The advertised "one coherent generation" must be true and
  testable for provider sources, or the boundary must be stated. A silent over-promise on
  the flagship anti-tear guarantee is the worst outcome.
- **Cost must be opt-in and bounded.** Re-reading an entire provider's key-set on every
  single-key expiry is unacceptable for a store holding hundreds of unrelated keys at
  `maxReadBatch: 1` (Vault KV v2). Coherence should cost only where it is wanted.
- **The library cannot infer which keys rotate together.** `db.host` + `db.password` are
  related; `db.host` + `feature.flag` are not. Nothing in a descriptor says which.
- **No new plane.** The fix must stay behind P16/P19 — no watch/subscribe, no per-request
  context, no per-caller values. Coherence is a read-cut property, not runtime state.
- **The CAS recipe must provably progress** against a live concurrent writer.

## Considered options

- **A — Whole-cohort cut, source-scoped (implicit).** Any expired key re-reads its whole
  provider key-set as one cut. Correct by default and matches the file model, but pays
  whole-provider re-reads for incidental co-location; a wide, slow store makes every pin
  expensive whether or not coherence is wanted there. Default-correct, but the cost is not
  opt-in.
- **B — Narrow the guarantee and document it.** Keep expired-keys-only; redefine `snapshot()`
  as temporal pin-stability (no mid-request tear) but *not* cross-key coherence for
  providers. Cheapest, but a retreat from the design's headline promise and forces softening
  the freshness page and P17's own example.
- **C — Explicit coherence groups (chosen).** A declared `coherent([...])` group is pinned
  and re-read as one cut; ungrouped keys keep expired-keys-only. Coherence is opt-in and
  precisely priced; the default is honest rather than silently torn.

## Decision

### D1 — Coherence is a declared `coherent([...])` group, re-read as one cut

A **coherence group** is a bind-site declaration naming a set of tesserae as one coherence
domain:

```ts
const cfg = bind(
  { dbHost: provider(dbHost, pg), dbPassword: provider(dbPassword, pg), rateLimit: provider(rateLimit, pg) },
  { maxStalenessMs: 5_000, coherent: [[dbHost, dbPassword]] },  // one group; rateLimit is ungrouped
);
```

`snapshot()` guarantees every member of a group reflects **one** generation. When **any**
member is expired at pin time, the whole group is re-read as one cut — one `read()` when it
fits a batch and the provider declares `consistentReads`, the bounded re-check loop (D3)
otherwise. Ungrouped tesserae keep the existing **expired-keys-only** behavior: each is
individually pinned with no cross-key promise. That is the honest default — the boundary
P17 demands — because the library cannot guess which keys rotate together.

A variant's discriminant + active branch is already an **implicit** coherence group
(`refresh()` re-reads it "as one coherent batch"); `coherent([...])` generalizes that
mechanism to arbitrary related keys.

**Why bind-site, not descriptor.** Which keys must not tear together is a deployment fact
(they must share a store; two apps may group differently), not a contract change. Putting it
on the descriptor would either fork identity over an operational preference or hide real
behavior from identity — the same argument that settled `keepLastGood` as a bind-site
opt-in.

### D2 — A group resolves to a single source; cross-source groups are refused at bind

One coherent cut requires one `read()` to one provider. Two stores have two independent
version timelines; no cut spans them. A `coherent([...])` whose members resolve to more than
one provider is **`CoherenceGroupSourceError`** at bind — we refuse to promise what no store
can deliver (P17). The practical corollary is the design's standing advice made mandatory
for grouped keys: rotate-together config must be **co-located in one store**.

### D3 — `consistentReads` stays an optimization; the re-check loop generalizes

Coherence never depends on `consistentReads` for correctness — only for round-trip count.
A group re-read is one round trip when it fits one `maxReadBatch` and the provider declares
`consistentReads`. When it chunks, or `consistentReads` is falsy, core buys coherence with
the existing bounded re-check loop, now generalized from "re-read the discriminant" to
"re-read the group's version witnesses and retry (≤ 3×) if any member moved." If the group
cannot be captured as a stable cut within the retry budget — the store is mutating faster
than it can be read coherently — the pin throws **`CoherenceError`** (rare, and honest about
what happened). This is the same "demoted to a round-trip optimization" language the contract
already uses; D3 makes it true for cross-key coherence, not only intra-read.

### D4 — `version` on `Provenance` (the CAS token)

`explain()` gains a `version?: string`: *the provider CAS token the pinned value carries;
`undefined` for versionless providers, non-provider sources, and defaulted values.* It is
non-sensitive metadata — a SQL row version, a DynamoDB condition attribute, an etcd revision,
never the value — so it is present even for **secret** tesserae (the secret write-verify path
already turns on version-token equality). This makes the DB-guide's
`snap.explain(rateLimit).version` real.

### D5 — A `set()` CAS conflict marks the key stale (the retry corollary)

A `WriteConflictError` from `set(k, …, { ifVersion })` **marks `k` stale** in the local
cache. The store has *told us* our version is superseded, so believing it is correct, not a
heuristic — and it mirrors the existing poisoned-slot rule, where current-truth state
bypasses staleness memoization so the next read re-reads immediately. The next `snapshot()`
therefore re-reads `k` authoritatively (and, if `k` is grouped, re-reads its whole group as
one cut), `ifVersion` advances, and the recompute sees a coherent view. The recipe needs no
`refresh()` and no new error fields:

```ts
async function bumpRateLimit(delta: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snap = await cfg.snapshot();               // after a conflict, the key was marked
    const current = snap.unwrap(rateLimit);          // stale → this re-reads it authoritatively
    const { version } = snap.explain(rateLimit);     // the CAS token this cache last saw (D4)
    try {
      return await cfg.set(rateLimit, String(current + delta), { ifVersion: version });
    } catch (e) {
      if (e instanceof WriteConflictError) continue; // set() marked it stale — next pin re-reads
      throw e;
    }
  }
  throw new Error("gave up after 3 conflicts");
}
```

## Consequences

- The "one coherent generation" pin is now honest and testable, by source: **structural** for
  files (per source), **declared** for providers (per `coherent` group), **implicit** for
  variants (discriminant + active branch). P17's rotated-pair example holds again — for grouped
  keys.
- **Cost is opt-in and bounded.** Only grouped keys pay whole-group re-reads. After a coherent
  read a group's members share one `cachedAt` and re-phase, so they expire together and the
  steady-state cost is ≈ one group read per staleness window, taken only when a pin actually
  crosses expiry.
- **Ungrouped related keys can still tear** — stated as the default. The DB guide teaches
  `coherent([...])` for any rotate-together set, and the failure is a wiring omission the reader
  can see, not a silent contract hole.
- **New surface:** the `coherent` bind option; `CoherenceGroupSourceError` (bind-time);
  `CoherenceError` (read-time, re-check exhaustion); `version` on `Provenance`. The
  `verifyProvider()` conformance kit gains a coherence probe (a chunked group re-read must
  re-check and converge).
- **The CAS recipe provably progresses** (spike: 2 attempts vs. give-up-at-3), with the loop
  body essentially unchanged.

## Scope — what this ADR is *not*

- **Not** the blocking-re-read timeout or the DB-unreachable-at-boot behavior
  ([#22](https://github.com/rejifald/tessellum/issues/22)) — a failure/liveness axis, its own
  ADR. Coherence here assumes reads that return; a slow or dead provider is #22's subject.
- **Not** `setMany` atomicity vs. core-owned chunking
  ([#17](https://github.com/rejifald/tessellum/issues/17)) — a durable-write axis, its own ADR.
  D2's single-source rule and #17's atomic-write chunking rule are siblings, not the same
  decision.
- Stays behind **P16/P19**: coherence groups add no state, no watch/subscribe, no per-request
  context, and no per-caller values. They make the existing pin honest; they do not widen what
  config *is*.
