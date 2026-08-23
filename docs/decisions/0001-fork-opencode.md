# ADR-0001 — Fork opencode rather than build on an SDK

- Status: **Accepted** (retroactive; executed 2026-08-14)
- Deciders: project owner

## Context

Hannah needs an agentic engine ("hands"). Options considered: (a) thin custom
agent loop on the Claude Agent SDK, (b) drive an unmodified opencode headless
server as a black box, (c) hard-fork opencode and mold it.

## Decision

Hard-fork opencode (v1.18.18 snapshot) into this repo, in the same org as the
other Hannah repos, as a standalone sidecar project.

## Rationale

- The project is expected to **root deep**: long-term, Hannah-specific behavior
  (façade, policy layer, macro skills, narration-shaped events) inside the
  engine itself, which a black-box or SDK wrapper would fight.
- opencode brings years of hardened engine work Hannah would otherwise
  re-implement: session persistence, streaming tool loop, multi-provider LLM
  layer, permissions, plugins/skills/MCP, subagents.
- Owning the code up front avoids the predicted wall (needing engine changes
  mid-project with no fork in place).

## Consequences

- We own a large codebase (15 packages, Effect-based core) with a real learning
  curve — mitigated by the façade seam (ADR-0006) and freeze policy (ADR-0004).
- Upstream sync is manual and selective (UPSTREAM.md).
- The alternatives remain fallbacks: the façade contract (INTEGRATION.md) is
  engine-agnostic by design, so a future engine swap would keep the backend
  untouched.
