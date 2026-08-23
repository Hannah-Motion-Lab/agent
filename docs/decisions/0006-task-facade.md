# ADR-0006 — Task façade as the only seam

- Status: **Accepted** (D2, 2026-08-17; API details may still be refined during
  M1.3, frozen at M2.1)

## Context

The engine thinks in projects/sessions/messages/parts. Hannah thinks in
**tasks**: "do X, tell me how it goes, ask before anything risky". Something
must bridge them, and its location determines coupling for the whole system.

## Decision

A dedicated module inside this repo — `packages/agent/src/hannah/` — mounted by
the v1 server, exposing the `/hannah/v0` API (INTEGRATION.md):

- **Task model**: one task = one engine session + initial prompt + preset +
  timebox; task states and IDs are façade-owned.
- **Event translator**: subscribes to the engine bus, emits only the
  `hannah.v0` vocabulary; engine event names never cross the seam.
- **Gate adapter**: engine permission requests and `question`-tool calls
  surface as `task.approval.requested` / `task.question`, answered via façade
  endpoints.
- Façade code is the *only* place allowed to import engine internals for
  Hannah purposes; other Hannah repos speak `hannah.v0` or nothing.

## Rationale

- One seam = one place to audit, one contract to test, one blast zone when the
  engine changes (ADR-0004's insurance policy).
- Narration quality (VISION pillar 4) is a translation concern; a dedicated
  translator makes "speakable events" an implementable requirement instead of
  a hope.
- Living inside the server process avoids a second daemon and reuses engine
  auth/lifecycle.

## Consequences

- The façade is a fork-only feature: it will never merge back and must be kept
  compiling against frozen internals — its imports from the engine should stay
  few and high-level (audit M0.1 picks the exact entry points).
- Concurrency semantics (409 single-task in v0, queue in P3) are façade
  policy, not engine limits.
