# ADR 0011 — Ship the Node file source in v0.1

- **Status:** Accepted (2026-07-09; design phase — no code yet)
- **Date:** 2026-07-09
- **Deciders:** project author
- **Constitution touchpoints:** P5 (sources are declared data refs; Node-only capabilities live in
  subpath entries — `{ file }` resolves in `tessellum/node`), P6 (bundle-frugal — the file source
  is in the Node subpath, never in the browser/core read path), P10 (no side effects — freshness is
  poll-on-read or explicit `refresh()`, never a watcher/timer), P16 ("if it can change while the
  process runs, it's state, not config" — the one exception is a tessera explicitly declared
  `freshness: "live"` over a **re-readable** source), P17 (honest claims — a v0.1 that documents
  machinery it cannot run fails its own bar)
- **Related docs:** [`concepts/freshness`](../../site/content/docs/concepts/freshness.mdx),
  [`guides/node-server`](../../site/content/docs/guides/node-server.mdx),
  [`guides/testing`](../../site/content/docs/guides/testing.mdx) ("Testing live config"),
  [`reference/api`](../../site/content/docs/reference/api.mdx) (`file`, `LiveBinding`,
  `BindOptions.maxStalenessMs` / `.clock`),
  [`reference/decisions`](../../site/content/docs/reference/decisions.mdx) §3 (this question),
  §10 (this pointer); resolves decisions §3
- **Builds on:**
  - [ADR 0004](./0004-async-snapshot-coherence.md) — its "one coherent cut" reasoning is *structural*
    for files: a file is read once per pass, so every tessera backed by it shares one generation
    (D2). Providers needed an explicit `coherent([...])` group; files get coherence for free.
  - The `clock` seam (issue #26) — `manualClock` is what makes the poll throttle and coast budgets
    deterministic in tests, which is a precondition for shipping a *testable* live surface (D4).

> Engineering decision record, kept apart from the published design site. Records *why* and
> what it costs, not the final reference prose.

---

## Context

`freshness: "live"` is a headline of the design: a per-request pin (`snapshot()`), `epoch()`,
`refresh()`, `health()`, and `keepLastGood` all exist to make "config that can legitimately change
while the process runs" safe and observable. But **liveness only means anything over a re-readable
source.** Live environment variables are physically impossible on Node — a running process's OS
environment never changes after `exec`. So without a re-readable source in v0.1, every one of those
features is a *paper feature*: documented, specced, and unrunnable.

Files are the one re-readable source with a mainstream deployment story on Node, and the question
(decisions §3) was whether to ship the `{ file }` source in v0.1 or defer it to v0.2 (env-only
first). The lean was yes; this ADR settles it.

No spike: the mechanics are already specced (poll-on-read throttling, the file examples in
`guides/testing`, `LiveBinding`), and the clock seam (#26) already makes them testable. This is a
**scope** decision — do we commit the test surface for v0.1 — not a mechanics one.

---

## Decision drivers

- **P17 — honest claims.** A v0.1 that ships `LiveBinding`, `epoch()`, `refresh()`, `health()`, and
  `keepLastGood` but has no source they can actually run against is documenting machinery it cannot
  demonstrate. That is exactly the overclaim the honesty bar forbids.
- **The proof gate needs it.** The §12 proof-gate demo's item #1 is a Node server with "one
  `freshness: "live"` file-ref tessera proving poisoning, `keepLastGood`, and `epoch()` against an
  edited file." Without the file source there is no demo, and without the demo there is no v0.1.
- **Files have a real deployment story.** Kubernetes volume-mounted ConfigMaps update in place; the
  live tessera re-reads on the next poll. This is not a toy — it is how a large fraction of the
  target audience ships config.
- **P16 — the file source is the *sanctioned* exception, not a new plane.** Poll-on-read only; no
  watcher, no timer, no subscription (P10). Liveness stays a read-cut property.

---

## Considered options

- **A. Ship the `{ file }` source in v0.1 *(chosen)*.** Live becomes real: the freshness surface has
  a source it can run against, the proof-gate demo is buildable, and the honesty bar holds.
- **B. Env-only v0.1; files in v0.2 *(rejected)*.** Smaller first release, but it ships the entire
  freshness surface as paper — `LiveBinding` with nothing live to bind, `refresh()` with nothing to
  re-read. It defers the one thing that distinguishes "live is designed" from "live exists," and it
  guts the proof-gate demo. The scope saved is not worth the credibility lost.

---

## Decision

### D1 — The `{ file }` source ships in `tessellum/node` for v0.1

A tessera may declare `sources: [{ file: "/path" }]` and, with `freshness: "live"`, bind to a
`LiveBinding` whose reads poll the file. `{ file }` resolves **only** in `tessellum/node` (it needs
`node:fs`); a bare `{ file }` ref under the core or browser entry is `NoWiringError`, never a silent
read (P5). File reads are **synchronous**, so a file-backed live tessera colors the binding
`LiveBinding` (not `AsyncBinding`) — the sync read path stays sync.

### D2 — The mechanics it commits to (already specced; this ADR pins them as v0.1 scope)

- **Poll-on-read, throttled by `maxStalenessMs`.** `unwrap()` re-reads only when the served value is
  older than the budget (default roughly one second for files). No background polling (P10).
- **One coherent pass per file.** A file is read once per poll, so *every* tessera backed by that
  file resolves from the same read — a multi-key file can never tear across keys. This is ADR 0004's
  coherence guarantee, but *structural* for files: no `coherent([...])` group is needed (that
  machinery exists for provider sources, which lack the single-read property).
- **Invalid-after-boot poisons; `keepLastGood` is the opt-in.** A file edited to an invalid value
  poisons the tessera (`InvalidLiveValueError`, current-truth-wins), the epoch bumps on the
  transition, and `keepLastGood(tessera, { maxCoastMs })` is the explicit bind-site opt-in to coast
  on the last valid value within a budget.
- **Deterministic in tests.** The poll throttle and coast budget read the injectable `clock`
  (issue #26), so `manualClock` drives them by hand — no real waiting, no flakiness.

### D3 — The Kubernetes ConfigMap contract is documented, caveat and all (P17)

A volume-mounted ConfigMap updates in place via Kubernetes' `..data` **symlink swap** — the live
tessera re-reads the new value on its next poll. The load-bearing caveat, stated in the guide:
**`subPath` mounts do *not* update** (they resolve the symlink at mount time and freeze). "Use a
directory mount, not a `subPath`, for live file config" is the one-line rule the freshness guide
must carry, because the failure mode otherwise is a live tessera that silently never changes.

### D4 — The test surface is accepted as v0.1 cost

Shipping the file source means owning: poll-on-read throttling, the single-coherent-pass read,
`keepLastGood` + `onInvalid`, and cross-platform filesystem quirks (path handling, atomicity of
read vs concurrent write, the symlink-swap behavior above). This is a real surface for a first
release; it is accepted because the alternative (B) is a paper freshness story.

---

## Consequences

**Positive**

- Live is **real**, not paper: `LiveBinding`, `epoch()`, `refresh()`, `health()`, `keepLastGood`
  all have a source to run against, and the proof-gate demo's live requirement is buildable.
- Coherence over a file is free (D2), so the flagship anti-tear guarantee holds for files with no
  extra API.
- The freshness surface is testable without real time (the `clock` seam), so "deterministic tests
  for the live surface" — a stated selling point — is actually deliverable in v0.1.

**Negative / costs**

- A real **test surface** (D4): FS quirks and the throttle/coherent-pass logic are where the bugs
  will be, and they land in the first release.
- The **`subPath` caveat** is a genuine footgun; mitigated by stating it loudly in the guide, but it
  is the kind of thing operators hit in production, not review.

**Security posture**

- Unlike the browser entry, the Node file source **is** secret-capable: a `exposure: "secret"`
  tessera may read from a file (a mounted secret). That is correct — `tessellum/node` is a trusted
  server entry (P5/P7); the browser entry still ships no secret-capable sources at all.

---

## Scope — what this ADR is *not*

- **Not the provider (async) story.** Providers (DB/SSM/etc.) are the async surface (ADR 0004/0005);
  this ADR is only the synchronous, Node file source.
- **Not a watcher.** Poll-on-read only (P10) — no `fs.watch`, no timers, no subscription. A value
  that must push updates is out of scope forever (P16).
- **Not a browser source.** Files are Node-only (`node:fs`); the browser gets config via bake or the
  runtime-injected document (ADR 0008), never a file.
- **Not the `latch` freshness mode.** First-valid-then-frozen (rejifald/tessellum#14) is a separate,
  still-open freshness question, not decided here.
