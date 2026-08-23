# ADR-0003 — Prune to the headless engine

- Status: **Accepted** (retroactive; executed 2026-08-14)

## Context

The upstream monorepo contained opencode-the-company: SaaS console, enterprise,
stats, Slack app, web site, docs site, desktop app, web app, storybook, VS Code
extension, cloud infra (SST), CI/release pipelines, installers, nix packaging.

## Decision

Delete everything outside the transitive dependency closure of the main
CLI/server package. Kept: `agent` (main), `core`, `server`, `llm`, `tui`, `ui`,
`plugin`, `protocol`, `schema`, `sdk`, `codemode`, `http-recorder`,
`effect-drizzle-sqlite`, `effect-sqlite-node`, `script` + `patches/`, `specs/`.
Also removed: the web-UI embedding step in `packages/agent/script/build.ts`
(its source package is gone; runtime degrades gracefully), husky hooks (no git
repo at prune time), root release/publish scripts.

## Rationale

- Hannah needs an engine, not a company. Every deleted surface was also the
  most branding-saturated code.
- Smaller closure = auditable security story (SECURITY.md egress inventory is
  feasible at 15 packages, hopeless at 32).
- The TUI/UI pair stays because it is the only interactive debugging client we
  have (ADR-0011).

## Consequences

- Anything deleted is recoverable only from upstream (UPSTREAM.md reference
  clone) — accepted.
- The engine may still contain dead code paths referencing deleted surfaces
  (e.g. `web` command); the P0 audit inventories them, P1 prunes what the
  Hannah profile doesn't disable.
