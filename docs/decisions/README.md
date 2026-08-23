# Architecture Decision Records

One file per decision. Statuses: **Proposed** (open, close by ROADMAP M0.5
unless noted) → **Accepted** → **Superseded by ADR-xxxx**. Retroactive ADRs
document decisions already executed, so the reasoning survives.

Rule: anything that changes the façade contract, the security posture, the
fork's relationship to upstream, or where a whole feature lives, gets an ADR
in the same change.

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-fork-opencode.md) | Fork opencode rather than build on an SDK | Accepted (retro) |
| [0002](0002-identity-and-naming.md) | Identity & naming conventions | Accepted (retro) |
| [0003](0003-prune-to-headless-engine.md) | Prune to the headless engine | Accepted (retro) |
| [0004](0004-freeze-upstream-target-v1.md) | Freeze upstream; build on the v1 engine path | Accepted (M0.5, 2026-08-18) |
| [0005](0005-integration-transport.md) | Integration transport: HTTP + SSE façade | Accepted (D2, 2026-08-17) |
| [0006](0006-task-facade.md) | Task façade as the only seam | Accepted (D2, 2026-08-17) |
| [0007](0007-model-strategy.md) | Model strategy: separate agent LLM | Accepted (D1, 2026-08-17) |
| [0008](0008-config-dirs-and-files.md) | Config/data directory & filename rename | Accepted (D4, 2026-08-17) |
| [0009](0009-upstream-services.md) | Disable upstream cloud services | Accepted (M0.5, 2026-08-18) |
| [0010](0010-permission-presets.md) | Voice-first permission presets | Accepted (M0.5, 2026-08-18) |
| [0011](0011-tui-as-dev-harness.md) | TUI kept as dev harness only | Accepted (M0.5, 2026-08-18) |
| [0012](0012-mcp-allowlisting.md) | MCP allowlisting by server | Accepted (M3.3, 2026-08-22) |
