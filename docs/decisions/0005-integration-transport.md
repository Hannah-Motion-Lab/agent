# ADR-0005 — Integration transport: HTTP + SSE façade

- Status: **Accepted** (D2, 2026-08-17)

## Context

hannah-backend (plain Node.js, streams everything) must drive the agent and
receive events. Candidate transports:

| Option | Verdict |
| --- | --- |
| (a) Backend calls the engine's native API directly | Couples backend to engine internals mid-refactor; every engine change breaks another repo. Rejected. |
| (b) Backend imports `@hannah/sdk` (generated JS client) | Cross-repo dependency + version skew + still the native API surface. Rejected. |
| (c) ACP (Agent Client Protocol, `hannah-agent acp`) | Real standard, but stdio JSON-RPC, editor-shaped, process-per-connection — wrong shape for a long-lived sidecar with HUD + backend consumers. Kept as reference implementation for how approvals/updates can be modeled. |
| **(d) Small versioned HTTP + SSE façade (`/hannah/v0`)** | **Chosen.** |

## Decision

Backend ⇄ agent communication uses exclusively the `/hannah/v0` HTTP + SSE API
defined in INTEGRATION.md: plain `fetch` + `EventSource`-style consumption, no
shared code, optional bearer token, localhost only.

## Rationale

- SSE matches the backend's streaming architecture and reconnect story
  (`Last-Event-ID`), with none of WebSocket's ceremony — traffic is
  one-directional events + simple POSTs.
- A hand-written, versioned contract stays stable while engine internals churn
  (ADR-0004) and keeps the backend free of TypeScript/engine types.
- Contract-testable from both sides with recorded fixtures (INTEGRATION §8).

## Consequences

- We maintain a translation layer (engine events → `hannah.v0`) — deliberate
  cost, it is also the narration-quality control point.
- If a future client needs bidirectional low-latency (e.g. PTY streaming into
  the HUD), that will be a new ADR (likely a scoped WS addition), not an
  extension of v0.
