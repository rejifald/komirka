# ADR 0005 — Async re-read deadline and boot-outage policy

- **Status:** Accepted (2026-07-09; design phase — no code yet)
- **Date:** 2026-07-09
- **Deciders:** project author
- **Constitution touchpoints:** P16 (config not state — config on the request path must not
  become an availability dependency with unbounded latency), P17 (honest claims — every
  guarantee states its boundary; `maxStalenessMs` bounds *staleness*, the new `readTimeoutMs`
  bounds the *wait*), P19 (pull-only, operator-plane, poll-on-read — no watch/subscribe, no
  background refresh)
- **Related docs:** [`concepts/freshness`](../../site/content/docs/concepts/freshness.mdx),
  [`guides/database-config`](../../site/content/docs/guides/database-config.mdx) ("When things
  fail"), [`reference/api`](../../site/content/docs/reference/api.mdx) (`AsyncBinding.ready` /
  `.snapshot`, `BindOptions.readTimeoutMs` / `.readyTimeoutMs`),
  [`reference/errors`](../../site/content/docs/reference/errors.mdx) (`SourceUnavailableError`),
  [`reference/decisions`](../../site/content/docs/reference/decisions.mdx) §7 (async reads),
  §10 (this pointer); resolves issue #22
- **Builds on:** [ADR 0004](./0004-async-snapshot-coherence.md) — the D1 coherent-group cut, the
  D3 bounded re-check loop, and the D5 post-conflict re-read are blocking provider reads, and
  this deadline is what bounds all three. This ADR is a base-off-`main` sibling of the open
  ADR 0004 PR and should land after it (or resolve the small textual overlap at merge).
- **Supersedes:** the unbounded reading of "expired reads block on a per-key single-flight
  re-read" (`decisions.mdx` §7, `api.mdx`) — the block is now deadline-bounded — and the
  unspecified DB-unreachable-at-boot behavior of `ready()`.

> Engineering decision record, kept apart from the published design site. Records *why* and
> what it costs, not the final reference prose.

---

## Context

`maxStalenessMs` is sold as "an honest hard bound, not a hint." It is — for *staleness*. It
bounds how old a value a read may **serve**. It says nothing about how long a caller **waits**.
Those are different quantities, and the gap is the bug.

An expired read does not serve stale-while-revalidating; it **blocks** on a single-flight
re-read so the served value is genuinely within budget (the hot-tessera thundering-herd rule:
one in-flight read coalesces the herd). But the block has no deadline. A provider that is not
*down* but merely *slow* — a saturated pool, a lock wait, a hung TCP socket with no read
timeout — wedges every coalesced caller for as long as it takes. `maxStalenessMs: 5_000`
promises a 5-second freshness budget while the caller waits 30 seconds. Config on the request
path has become an availability dependency with unbounded latency — the precise anti-goal P16
and the principles call out.

[ADR 0004](./0004-async-snapshot-coherence.md) multiplied the blocking reads. A `snapshot()`
now also issues: the **D1** coherent-group cut (any member expired ⇒ re-read the whole group),
each iteration of the **D3** bounded (≤ 3×) re-check loop, and the **D5** re-read a
`WriteConflictError` forces by marking a key stale. Every one is a blocking `provider.read()`
with no time bound. Whatever bounds the expired-key re-read must bound these too, or the pin's
worst-case latency is still unbounded.

`ready()` is worse, because it has **no cache to fall back on**. The "serve the cached value
within `maxStalenessMs`" rule that covers a mid-life outage cannot apply at boot — nothing is
cached yet. What `ready()` does when the store is unreachable at boot — die, hang, or retry —
was simply unspecified. And boot is exactly when transient unavailability is *most* likely:
in Compose and Kubernetes the database and the app start together, and the app routinely wins
the race to its first read by a few hundred milliseconds.

A throwaway spike (`scratchpad/spike_22_read_timeout.mjs`, Node, no deps, deterministic
virtual clock — 19/19 checks) modeled the single-flight re-read with a per-caller deadline and
the boot state machine, and confirmed all of it:

- **No deadline → unbounded wait.** A 30 000 ms-latency provider makes every coalesced caller
  wait the full 30 000 ms while `maxStalenessMs: 5_000` does nothing.
- **`readTimeoutMs` → bounded wait, `SourceUnavailableError` on breach**, single-flight intact
  (the late result still refreshes the cache for the next caller; it never un-throws the caller
  who already breached). A read that settles under the deadline still returns fresh — no false
  timeout.
- **On an expired read a breach must throw** — the cached value is by definition past
  `maxStalenessMs`, so serving it would be the dishonest serve the design refuses.
- **The deadline stays distinct from `CoherenceError`:** a *slow* group re-read fails on
  attempt 1 with `SourceUnavailableError`; a *fast but churning* group exhausts the ≤ 3× loop
  with `CoherenceError`. Both bounded; different causes.
- **Boot: both policies terminate.** Fail-fast dies on the first strike (even for a 300 ms
  blip); bounded-retry rides out the 300 ms blip (ready in 1 000 ms) yet still fails-fast on a
  genuinely-down store within budget (4 750 ms, 4 attempts). The old unspecified behavior could
  hang forever.

## Decision drivers

- **P17 — a bound named "honest" must bound something the caller feels.** `maxStalenessMs`
  bounds staleness; the wait needs its own stated bound, or the flagship claim overreaches on
  the exact axis (latency) that matters on the request path.
- **The request path must never become an unbounded-latency availability dependency** (P16).
- **One mechanism for every blocking read.** ADR 0004's D1/D3/D5 reads and the plain expired-key
  re-read should inherit the *same* bound, not three bespoke ones.
- **Boot is the transient-outage window.** The boot policy must ride out the dependency-order
  race without hanging, and still fail the boot loudly when the store is genuinely down.
- **Read liveness ≠ write liveness.** "Too slow to answer" and "answering but churning" are
  different failures and deserve different errors (`SourceUnavailableError` vs `CoherenceError`).
- **No new plane** (P19). The fix stays poll-on-read: it bounds a blocking wait; it adds no
  watch, no subscribe, no background refresher.

## Considered options

**The read deadline.**

- **A — No deadline (status quo).** Rejected: the unbounded-wait bug, and it over-promises the
  "honest hard bound."
- **B — Serve the expired value when the re-read is slow (timeout ⇒ stale-while-revalidate).**
  Rejected: serving a value past `maxStalenessMs` is exactly the dishonest serve the design
  refuses. `decisions.mdx` §7 already defers SWR as a *loudly-named opt-in*, never a silent
  timeout fallback.
- **C — Per-caller read deadline surfacing `SourceUnavailableError` (chosen).** The wait is
  bounded; the served value is never stale-beyond-budget (a breach throws); single-flight
  survives.

**Deadline scope.** Per-`provider.read()`-call (chosen) vs a whole-`snapshot()` budget. The
per-call deadline is the unit core already wraps around each `read()` await; it composes with
the *already*-bounded ≤ 3× re-check loop and the core-known chunk count, and it attributes a
breach to a specific read. The derived whole-pin worst case
(`readTimeoutMs × chunks × recheck`) is documented rather than enforced as a second budget.

**Boot outage.**

- **A — Fail-fast (die on the first strike).** Consistent with eager bind's "fail the boot";
  delegates restart/backoff to the orchestrator. But it crash-loops a full process restart on a
  sub-second boot blip, and not every deployment *has* an orchestrator (a CLI, a migration, a
  bare `node server.js`).
- **B — Hang.** The status-quo bug.
- **C — Bounded retry, then fail-fast (chosen).** Retry with backoff up to a boot budget (each
  attempt ≤ `readTimeoutMs`), then throw. Rides out the dependency-order race, stays bounded,
  still fails the boot loudly on a genuinely-down store. Pure fail-fast remains one option away
  (`readyTimeoutMs: 0`).

## Decision

### D1 — A per-read deadline `readTimeoutMs`, surfacing `SourceUnavailableError`

A new bind option `readTimeoutMs?: number` bounds every blocking provider read core awaits: the
expired-key single-flight re-read, ADR 0004's **D1** coherent-group cut, **each iteration** of
the **D3** re-check loop, the **D5** post-conflict re-read, and each `ready()` boot attempt
(D3 below). It **defaults to `maxStalenessMs`** — the wait bound defaults to the staleness bound
the binder already signed, and is tightened independently when a store's acceptable *latency*
differs from its acceptable *staleness*.

On breach, core stops awaiting and raises **`SourceUnavailableError`** naming the key(s) in that
read, carrying `{ cause, staleSince }` where the cause is the deadline. A breach *is* a species
of "unreachable within budget" — a store too slow to answer is functionally unreachable — so it
reuses the existing error rather than minting a timeout-specific one; `errors.mdx` already frames
`SourceUnavailableError` as "the provider is unreachable ⇒ serve within budget, else throw."

Two properties keep this honest and cheap:

- **The deadline bounds the caller's wait, not the provider's work.** Core cannot cancel an
  in-flight `Promise`. A timed-out read keeps running and, if it later resolves, **refreshes the
  cache for the next caller** — it never un-throws a caller who already breached. Single-flight
  is preserved: still one `read()` per key, now with a per-caller deadline measured from when
  each caller began awaiting (a caller that joins an in-flight read already 400 ms old still
  waits at most `readTimeoutMs` more, then breaches on its own clock).
- **On an expired read a breach throws — it never serves the cached value.** That value is by
  definition past `maxStalenessMs`; serving it is the stale-beyond-budget serve the whole "honest
  bound" story rules out. This is the division of labor: `maxStalenessMs` is the *staleness*
  bound, `readTimeoutMs` is the *wait* bound, and neither is allowed to quietly become the other.

### D2 — The deadline stays distinct from `CoherenceError`

Read liveness and write liveness are separate axes with separate errors:

- **`SourceUnavailableError`** — the store was too slow or unreachable to answer a read within
  `readTimeoutMs`.
- **`CoherenceError`** (ADR 0004 D3) — the store answered *fast* but kept moving, so no stable
  cut could be captured within the ≤ 3× budget.

A coherent-group re-read can hit either: a slow group breaches the deadline on the **first**
attempt (`SourceUnavailableError`, fails fast — it does not burn all three re-checks waiting on a
dead store), while a fast churning group exhausts the loop (`CoherenceError`). Both outcomes are
bounded; each error names a different cause and a different next step (restore/​speed up the
store vs slow the write rate / co-locate the group).

### D3 — `ready()` boot outage: bounded retry, then fail-fast

`ready()` retries its boot batch read with exponential backoff — each attempt bounded by
`readTimeoutMs` (D1) — until the store answers (`ready()` resolves) or a total boot budget
**`readyTimeoutMs`** elapses, at which point it throws `SourceUnavailableError` and the boot
fails. A new bind option `readyTimeoutMs?: number` carries the budget (default **30 000 ms** — a
boot budget, distinct from the per-read `readTimeoutMs`). **`readyTimeoutMs: 0` disables retry:
pure fail-fast**, die on the first strike, for deployments that delegate restart and backoff to
an orchestrator's `CrashLoopBackoff`.

This keeps `ready()` **fail-closed** — a genuinely-down store still fails the boot within a
bounded window — while riding out the common startup dependency-order race, and it composes with
D1 (each attempt is one deadline-bounded read). Bounded retry changes *when* `ready()` gives up,
not *that* it does: boot failure remains a boot failure, consistent with eager bind's "fail the
boot loudly and completely" (`errors.mdx` summary). The one probe-contract invariant is
unchanged — readiness may gate on a failed boot read; liveness probes never do.

## Consequences

- The request path has a stated **wait** bound (`readTimeoutMs`), not only a staleness bound.
  The "honest hard bound" claim is now honest on both axes, and P17's boundary is stated in the
  same breath as the guarantee.
- ADR 0004's D1/D3/D5 blocking reads and the plain expired-key re-read are all bounded by **one**
  mechanism.
- `ready()` no longer hangs on a down store and no longer crash-loops on a transient boot blip;
  the boot budget is a single `readyTimeoutMs` knob, and pure fail-fast is `readyTimeoutMs: 0`.
- **New surface:** `readTimeoutMs` and `readyTimeoutMs` bind options; `SourceUnavailableError`
  gains a deadline-breach cause (no new error class); the testing kit's `manualClock` drives a
  slow provider to prove the deadline, and the `verifyProvider()` conformance kit can add a
  slow-read probe.
- A late-arriving read still refreshes the cache, so a slow-but-recovering store converges
  without extra reads.
- **Cost:** two more bind options, and a default (`readTimeoutMs = maxStalenessMs`) that couples
  the two budgets until overridden — documented as tunable. A provider slower than
  `readTimeoutMs` on *every* read is, correctly, indistinguishable from down at the binding
  boundary; the remediation (raise the budget or fix the store) is in the error's first line.

## Scope — what this ADR is *not*

- **Not stale-while-revalidate.** A breach throws; it never serves the expired value. SWR stays
  deferred as a loud opt-in ([`decisions.mdx`](../../site/content/docs/reference/decisions.mdx)
  §7).
- **Not** ADR 0004's cross-key coherence (the read-*cut* shape) and **not** the `setMany`
  atomicity axis ([#17](https://github.com/rejifald/tessellum/issues/17), ADR 0006). This is the
  read-*liveness* axis only.
- **Not provider cancellation.** Core bounds the *caller's* wait, not the provider's I/O.
  Providers should still set their own socket/query timeouts; `readTimeoutMs` is the binding's
  backstop, not a replacement.
- Stays behind **P16/P19**: the deadline bounds a blocking wait and adds no watch, no subscribe,
  no background refresher, and no per-request context. It makes the existing poll-on-read honest
  about latency; it does not widen what config *is*.
