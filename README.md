# hannah-agent

Agentic engine for **Hannah** — the layer that lets the avatar act on your
computer (read/edit files, run commands, drive tools) the way a coding agent
does. It runs as a local sidecar for `hannah-backend`, next to the ASR / TTS /
vision / motion sidecars.

**Project documentation lives in [`docs/`](docs/README.md)** — vision, roadmap
(phases P0–P4 with milestones), architecture, the `/hannah/v0` integration
contract, security model, and all decision records (ADRs). Start there.
Contributor rules are in [AGENTS.md](AGENTS.md).

This is a hard fork of [opencode](https://github.com/anomalyco/opencode)
v1.18.18 (MIT — upstream copyright retained in [LICENSE](LICENSE)), stripped to
the headless engine, re-branded, and **frozen** at that snapshot (ADR-0004).
Fork versioning restarts at `0.1.0`.

## Quickstart

```bash
bun install
bun run dev                # CLI/TUI from source (packages/agent/src/index.ts)
bun run dev serve          # headless server — this is what Hannah talks to
bun run typecheck          # all 14 packages
cd packages/agent && bun test    # tests never run from the repo root
```

`serve` binds `127.0.0.1` and prefers port 4096 (`--port` to override; Hannah
will use **8006**). Set `HANNAH_AGENT_SERVER_PASSWORD` to require Basic auth —
without it the server is unsecured and says so at startup.

## State of the fork

- **Phase 0 complete** (2026-08-18): engine audited end to end
  ([docs/audit/M0.1-engine-audit.md](docs/audit/M0.1-engine-audit.md)),
  de-branding finished, versions reset, CI added, all 11 ADRs accepted.
- **Tests green**: core 1090, ui 27, tui 193, agent 3276 — nothing quarantined
  ([docs/audit/M0.4-test-baseline.md](docs/audit/M0.4-test-baseline.md)).
- **Next**: Phase 1 — the Hannah config profile, the policy layer, and the
  `/hannah/v0` façade ([docs/ROADMAP.md](docs/ROADMAP.md)).

## Configuration

Install a profile, then run the server:

```bash
scripts/install-profile.sh          # Anthropic brain (default)
scripts/install-profile.sh --local  # local-only Ollama brain
export ANTHROPIC_API_KEY=...        # or start ollama for the local profile
bun run dev serve --port 8006
```

The profile sets the agent model, the `companion` permission preset, loopback
binding, and disables upstream services. Every setting is explained in
[docs/PROFILE.md](docs/PROFILE.md); verify a machine with
`scripts/boot-matrix.sh`.

### Try a task end to end

With the server running in one terminal, drive the `/hannah/v0` façade from
another exactly the way `hannah-backend` will:

```bash
bun run scripts/hannah-smoke.ts
bun run scripts/hannah-smoke.ts --prompt "count the files in ~/Downloads"
bun run scripts/hannah-smoke.ts --auto false      # answer approvals yourself
bun run scripts/hannah-smoke.ts --token "$HANNAH_AGENT_TOKEN"
```

It opens the event stream first, creates the task, narrates every event, answers
approvals and questions, and exits non-zero unless the task completes. If it
reports `Model not found`, that is the engine's way of saying the provider has
no credentials — the script prints the fix.

### Environment reference

The engine reads ~90 `HANNAH_AGENT_*` variables (full registry:
`packages/core/src/flag/flag.ts`). These are the ones that matter operationally:

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Provider credential for the default profile. Provider keys are plain environment variables, named by the catalog. |
| `HANNAH_AGENT_SERVER_PASSWORD` | Enables HTTP Basic auth. **Unset means the server is unsecured** and says so at startup. |
| `HANNAH_AGENT_SERVER_USERNAME` | Basic-auth username (default `hannah-agent`). |
| `HANNAH_AGENT_CONFIG_DIR` | Override the global config directory. |
| `HANNAH_AGENT_CONFIG` | Load one extra config file, merged last. |
| `HANNAH_AGENT_CONFIG_CONTENT` | Inline JSON config, merged last — handy for one-off runs. |
| `HANNAH_AGENT_DISABLE_PROJECT_CONFIG` | Ignore `.hannah-agent/` and `hannah-agent.json` found in the working tree. |
| `HANNAH_AGENT_PERMISSION` | JSON permission ruleset that overrides the profile's. |
| `HANNAH_AGENT_AUDIT_RETENTION_DAYS` | Days of audit log to keep (default 30). Enforced at startup. |
| `HANNAH_AGENT_MCP_ALLOW` | Extra MCP servers to trust for this run, comma-separated. Assumed to have every dangerous capability — see ADR-0012. |
| `HANNAH_AGENT_WORKSPACES` | `id=path` pairs (comma-separated) naming where tasks run. Defaults to the XDG user dirs that exist. **Ergonomics, not security** — see below. |
| `HANNAH_AGENT_MODELS_URL` | Model-catalog origin (default `https://models.dev`). |
| `HANNAH_AGENT_MODELS_PATH` | Use a vendored catalog file instead of fetching. |
| `HANNAH_AGENT_DISABLE_MODELS_FETCH` | Do not fetch the catalog at all. |
| `HANNAH_AGENT_DISABLE_SHARE` | Hard-off for session sharing (the profile also sets `"share": "disabled"`). |
| `HANNAH_AGENT_DISABLE_AUTOUPDATE` | Hard-off for update checks (only ever ran in the TUI). |
| `HANNAH_AGENT_DB` | SQLite path, or `:memory:`. |
| `HANNAH_AGENT_PURE` | Skip all external plugins. |
| `HANNAH_AGENT_DISABLE_DEFAULT_PLUGINS` | Skip the bundled plugins. |
| `HANNAH_AGENT_LOG_LEVEL` | `DEBUG` / `INFO` / `WARN` / `ERROR`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Only outbound telemetry path, and only if you set it. |

### Where tasks run

Every task used to inherit `process.cwd()`, so "ordena mis descargas" ran
wherever the sidecar happened to be launched from. A task now resolves its own
working directory, most-specific-first:

1. an explicit `cwd` on the create call,
2. a real path written in the prompt (walking up to the nearest directory that
   exists, so `~/Downloads/reports/2026` lands in `~/Downloads`),
3. a workspace named in the prompt — accent- and case-insensitive, in either
   language, so *descargas*, *Descargas* and *downloads* are one place,
4. the fallback.

Anything that fails validation falls through rather than failing the task:
landing in the default directory is recoverable, refusing to start because a
folder was misspelled is not. A directory inside the sensitive-path denylist is
never chosen.

**These roots are ergonomics, not a security boundary.** D3 set the workspace
root to `/`, so naming a root grants nothing that was not already granted — the
denylist and the preset gates are the whole boundary (SECURITY §4). What they
buy is a task that starts in the right place, and a vocabulary the persona can
use: `GET /hannah/v0/health` reports the roots, and the backend puts their names
in the system prompt so Hannah cannot offer to tidy a folder that does not exist
on this machine.

### Macros

Ten recurring jobs ship as engine skills with a catalog in front of them:
`organize-downloads`, `open-project`, `media-control`, `file-screenshot`,
`system-status`, `git-housekeeping`, `download-and-file`, `archive-old-files`,
`launch-app`, `find-file`. `scripts/install-profile.sh` copies the skills into
`~/.config/hannah-agent/skill/`, which the engine already scans.

A macro whose tool is missing is **absent from the catalog**, so the persona
never learns it exists and cannot promise it — `GET /hannah/v0/health` lists
only what this machine can run, and `GET /hannah/v0/macros` lists everything
with the reason for each exclusion. Full reference and the trial harness:
[docs/MACROS.md](docs/MACROS.md).

### History

`GET /hannah/v0/history` and `GET /hannah/v0/tasks/{id}/trail` are **derived
from the audit log**, not from a second store: the log already records every
task's whole life and already has a retention policy, and two stores would
eventually disagree about what happened.

Retention runs at startup (`HANNAH_AGENT_AUDIT_RETENTION_DAYS`, default 30) —
whole day-files, so trimming cannot corrupt one. `bun run
scripts/audit-purge.ts` trims harder without a restart and defaults to a dry
run.

### MCP servers

An MCP tool is an **opaque capability**: the engine asks permission for it with
no arguments, so the sensitive-path denylist and the command scanner have
nothing to inspect. Trust is therefore decided per *server*, in code
(`packages/agent/src/hannah/policy/mcp.ts`), and a tool from a server that is
not allowlisted is denied by the hard policy layer — unappealably, so a spoken
"sí" cannot get past it. MCP tools are also never `low` risk, which means they
can never be granted by voice at all (T7).

Putting a server in `hannah-agent.jsonc` is therefore **not enough** to make it
usable. Adding one is a code change plus an ADR amendment
([ADR-0012](docs/decisions/0012-mcp-allowlisting.md)); `HANNAH_AGENT_MCP_ALLOW`
allows extras for a single run, assuming the worst about their capabilities.

Playwright is the first allowlisted server and ships **disabled** with a pinned
version. Connecting it hands over a browser that is already logged into your
accounts — a bigger grant than any single approval in this system, and one that
should be made on purpose.

### Deleting reversibly

If `gio`, `trash-put` or `trash` is on `PATH`, the agent is *told* to prefer it
over `rm`. Nothing is rewritten: silently turning `rm` into something else would
make the approval the user sees a lie, and `rm` stays available and stays high
risk. What changed is the question — an approval used to read "run
`rm -rf ./build`" and now reads "permanently delete `./build`" or "move
`./build` to the trash". The difference matters most in the one place it used to
be invisible: a question asked out loud, where granting the reversible thing by
mishearing costs nothing and granting the irreversible one costs everything.

## What was removed from upstream

- Cloud/company surfaces: console, enterprise, stats, slack, identity,
  containers, function
- Web site, docs site, desktop app, web UI, storybook, VS Code extension
- Release/publishing infra: SST configs, GitHub workflows, installers, nix,
  husky hooks
- Localized READMEs and marketing assets

Kept: the engine monorepo — CLI/server (`packages/agent`) plus its workspace
dependencies (`core`, `server`, `llm`, `tui`, `ui`, `plugin`, `protocol`,
`schema`, `sdk`, `codemode`, and support packages).

## Naming

| Upstream | Here |
| --- | --- |
| `packages/opencode` | `packages/agent` |
| npm scope `@opencode-ai/*` | `@hannah/*` |
| package / binary `opencode` | `hannah-agent` |
| env prefix `OPENCODE_*` | `HANNAH_AGENT_*` |
| `~/.config/opencode`, `~/.local/share/opencode`, `.opencode/` | `…/hannah-agent`, `.hannah-agent/` |
| `opencode.json[c]` | `hannah-agent.json[c]` |

Some `opencode` strings are **deliberately kept** — third-party package names,
upstream's model-gateway provider id, vendor-registered integration keys, the
photon patch token, and the MIT notice. The full ledger, with the verification
greps, is [docs/DEBRANDING.md](docs/DEBRANDING.md); read it before renaming
anything else.

## Where this fits in the project

Hannah is five repositories:

| Repo | What it is |
| --- | --- |
| [`hannah-workspace`](../workspace) | the `./hannah` launcher and the project-wide docs — **start there** |
| [`hannah-backend`](../backend) | WS/REST orchestrator: ASR → LLM → TTS, memory, tools |
| [`hannah-frontend`](../frontend) | React + three.js client, VRM avatar, HUD |
| [`hannah-desktop`](../desktop) | Electron overlay (Windows / macOS / Linux) |
| [`hannah-motion-lab`](../motion-model) | text→motion gestures, :8005 |
| **`hannah-agent`** (this one) | the agent sidecar, :8006 |

The backend's persona LLM emits a `[TASK:…]` tag (mirroring its existing
`[MOTION:]` protocol); the backend dispatches it to this sidecar's `/hannah/v0`
API and narrates the event stream back to the user through the avatar. The
contract — endpoints, the `hannah.v0` event vocabulary, approval and barge-in
semantics — is specified in [docs/INTEGRATION.md](docs/INTEGRATION.md) and is
the only seam between the two repos.

Nothing here shares a port, a config path or a data directory with the rest of
the stack. What it *does* share is a job: **the backend already has a tool layer
of its own** — a real pty behind `TOOLS_SYSTEM_CONTROL`, `[RUN:]` action tags
and `SKILL.md` skills — which covers the same ground more cheaply and less
safely. Running both without deciding which one owns model-initiated actions
means two shells, two skill systems and two safety models in one product.

**Read [docs/COEXISTENCE.md](docs/COEXISTENCE.md) before enabling this on a
machine that already runs Hannah.** It compares the two honestly, lays out the
three ways to resolve it, and lists the concrete work per repo.
