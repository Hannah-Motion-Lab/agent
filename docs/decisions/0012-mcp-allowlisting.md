# ADR-0012 — MCP allowlisting

- Status: **Accepted** (M3.3, 2026-08-22)

## Context

MCP servers are how the engine gains capabilities it does not ship with —
browser automation, a bug tracker, a database. Phase 3 wants at least one. The
question is what connecting one actually costs, and the answer turned out to be
larger than expected.

Three facts about how MCP tools reach the permission layer, all verified in the
source rather than assumed:

1. **An MCP tool is an opaque capability.** `session/tools.ts` asks with
   `permission: <toolKey>`, `patterns: ["*"]` and empty metadata. The two
   things that make `read` and `bash` safe — the sensitive-path denylist and
   the danger-command scanner — have **nothing to inspect**. `~/.ssh` is
   protected from `cat` and not from a filesystem MCP server, and no per-call
   policy can change that, because there is no call detail to police.

2. **Unknown permission keys tiered as `low` risk.** `PolicyPresets.risk` fell
   through to `return "low"` for anything it did not recognise, and `low` is
   exactly the tier the backend lets a spoken "sí" grant (T7). An MCP tool was
   one mishearing away from running.

3. **The preset matrices do not mention MCP at all**, so an MCP tool matched no
   rule and fell to the engine's default of `ask`. That part was already right,
   and it is the only reason (1) and (2) were not already a live hole.

A fourth thing worth recording because it is easy to lose: the ask carries
`always: ["*"]`, so a single "always" reply would grant every tool on that
server for the session. Hannah never sends it — the façade replies `once` or
`reject`, nothing else — so this is inert. It stays inert by test, not by luck.

## Decision

**Allowlist by server, not by tool, and treat the allowlist as an ADR-level
decision rather than a config setting.**

- `session/tools.ts` stamps `metadata: { mcp: <serverName> }` on every MCP
  permission ask. Derived from the record rather than the tool key, because the
  key mangles both names together (`playwright_browser_navigate` could be
  server `playwright` or server `playwright_browser`) and a guess inside an
  allowlist is a hole. This required adding `clientName` to `MCP.McpTool`.
- `PolicyMCP` holds the allowlist. A tool from a server that is not on it is
  **denied by the hard policy layer** — before the presets, unappealable, never
  surfaced as an approvable question.
- Each entry declares its **capabilities** (`browser`, `network`, `filesystem`,
  `exec`, `read-only`). That is what the reviewer of a future entry argues
  about, and it drives the risk tier.
- **MCP tools are never `low` risk.** Anything with `network`, `filesystem` or
  `exec` is `high` — HUD confirmation, never a spoken grant (T7). The rest are
  `medium`.
- `HANNAH_AGENT_MCP_ALLOW` allows extra servers for one run. Entries from it are
  assumed to have every dangerous capability, because unknown provenance means
  unknown reach and the risk tier must not quietly drop.

**First server: Playwright MCP** (`browser`, `network`), shipped **disabled** in
`profile/hannah-agent.jsonc` with a pinned version.

## Rationale

- **The seam is the server because that is where the information is.** Every
  other layer of this system polices arguments; for MCP there are none. Pretending
  otherwise — a per-tool allowlist, an argument sniffer — would look like
  security and provide none.
- **Disabled by default, pinned, and opt-in** because connecting Playwright hands
  over a browser that is already logged into the user's accounts. That is a
  bigger grant than any single approval in this system, and it should be a thing
  someone did on purpose. Pinning is T6: `@latest` in a config file is a package
  the user did not choose being run on their machine.
- **Capabilities rather than a boolean** so the next entry has to answer "what
  does this hand over?" in the pull request, not after an incident.
- Fixing the `low` default was not optional. It was reachable today by any
  plugin-registered tool with an unfamiliar key, not only by MCP.

## Consequences

- Adding an MCP server is a code change plus an ADR amendment. That is
  deliberate friction, and it is the point.
- A server the user configures but does not allowlist connects and lists its
  tools, then every call is denied with a spoken reason. Failing loudly at the
  first call beats silently having the capability.
- The denial is a hard policy denial, so it is **not** approvable — the user
  cannot say "sí" past it. Changing that requires editing the allowlist.
- `risk()` now takes metadata. Call sites that do not pass it keep the old
  behaviour for non-MCP permissions.

## Alternatives considered

- **Per-tool allowlist.** Finer-looking, but the unit of trust is the process:
  a server can add a tool between one run and the next, and the new tool would
  need an entry it can add for itself by being listed.
- **Sandboxing MCP servers** (container, seccomp). The right long-term answer
  and out of scope for P3 — noted in ROADMAP P4 hardening.
- **Reading arguments out of the MCP call.** The ask does not carry them, and
  plumbing them through would make policy depend on each server's argument
  shape — a per-server parser is a per-server bug.
