# ADR-0004 — Freeze upstream; build on the v1 engine path

- Status: **Accepted** (M0.5, 2026-08-18 — the M0.1 audit confirmed the seam)

## Context

The forked snapshot is mid-refactor: the running product lives in
`packages/agent` (v1) while an Effect-based rewrite (`core`/`server`/
`protocol`/`schema`, "v2") is partially wired in and partially design-stage
(`specs/v2` has open questions). Upstream will keep moving that migration
forward; we will not be pulling it.

## Decision

1. **Freeze** on the v1.18.18 snapshot as our permanent base (sync policy in
   UPSTREAM.md: security/provider fixes only, ported by hand).
2. Build all Hannah-specific work against the **v1 runtime path** — the code
   `serve` actually executes — touching v2 packages only where v1 already
   depends on them.
3. Do **not** continue the v1→v2 migration ourselves, and never modify both
   stacks to implement one feature.
4. Fork versioning restarts at `0.1.0` (post-P0); we stop mirroring upstream
   versions.

## Rationale

- Chasing a moving upstream rewrite is the single biggest schedule risk for a
  solo developer; the value of Hannah is in the layer above the engine.
- The v1 path is the only battle-tested one at the snapshot.
- The façade (ADR-0006) makes this reversible: if the engine is ever swapped
  or re-synced, the contract holds.

## Consequences

- Some engine internals we rely on are "legacy" by upstream's standards —
  irrelevant to us, but reading upstream docs/issues requires mapping their
  post-migration world back to ours.
- The M0.1 audit must mark, for each runtime concern (sessions, tools,
  permissions, events, storage), which stack serves it, so rule 3 is checkable
  in review.

## Audit findings (M0.1, 2026-08-18) — refinement, not reversal

The split is in the **runtime services**, not the HTTP layer: one process
serves both the legacy routes and the v2 `/api/*` routes from the *same*
in-process services (`Permission.Service`, `Question.Service`, the prompt
service, `EventV2Bridge`), and the shipping TUI already drives `/api/*`.

Rule 2 is therefore sharpened: **the façade binds to those shared services
in-process** rather than to either wire surface. That keeps the decision
intact while removing the false implication that "v1 path" means "legacy HTTP
routes". Session content still persists through the v1 JSON store; the SQLite
database belongs to the v2 stack. See audit §1, §7, §12.
