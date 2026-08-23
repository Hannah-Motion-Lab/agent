# ADR-0011 — TUI kept as dev harness only

- Status: **Accepted** (M0.5, 2026-08-18)

## Context

The fork retains `packages/tui` + `packages/ui` (Solid/opentui terminal
client). Hannah's product surface is the avatar + HUD; the TUI is not part of
it. Deleting it was considered during the prune.

## Decision

Keep the TUI as an **internal development harness**, with explicit limits:

- It is the interactive debugger for engine behavior (sessions, permissions,
  tools) without needing the backend stack running.
- No Hannah feature may depend on it, and no feature work is invested in it —
  ever. Cosmetic breakage is acceptable; only "boots and can run a session"
  is maintained.
- Its remaining branding strings are cleaned with the visible-strings pass
  (M0.2) but it gets no polish beyond that.
- If it ever blocks an engine change (type errors, dep weight), the default
  answer is to delete it then — recorded as a supersession of this ADR.

## Rationale

- During P0–P1 there is no other interactive client; debugging the façade and
  policy layer purely over `curl` would be slow and blind.
- The cost of keeping it is near-zero while it compiles; the cost of needing
  it after deleting it is a re-vendor from upstream.

## Consequences

- `packages/tui`/`packages/ui` stay in the typecheck matrix (they catch schema
  drift for free) but out of every roadmap deliverable.
- Note from M0.1: the TUI drives the **v2 `/api/*` surface** via
  `@hannah/sdk/v2`, so it exercises the same in-process services the façade
  binds to — which is exactly why it is useful as a debugger, and also why its
  breakage would be an early warning rather than a cosmetic annoyance.
  Its suite is kept green (193 tests) rather than quarantined.
- The smoke/fixture scripts (M1.4), not the TUI, are the canonical way to
  exercise the façade.
