# The Hannah profile

> Status: M1.1, implemented 2026-08-19. The profile is the configuration that
> turns the forked engine into *Hannah's* agent: which brain it uses, what it
> is allowed to do, and what it is allowed to talk to.

Two templates live in [`profile/`](../profile/):

| File | Brain | Use it when |
| --- | --- | --- |
| `hannah-agent.jsonc` | Anthropic API (`claude-opus-5`) | Default. Best tool-use reliability; task content goes to Anthropic. |
| `hannah-agent.local.jsonc` | Local Ollama | Nothing leaves the machine. Weaker at long multi-step tasks — try it before relying on it. |

Install one (never overwrites without `--force`):

```bash
scripts/install-profile.sh           # Anthropic
scripts/install-profile.sh --local   # Ollama
scripts/install-profile.sh --print   # inspect without installing
```

It writes to `$HANNAH_AGENT_CONFIG_DIR`, else `${XDG_CONFIG_HOME:-~/.config}/hannah-agent/hannah-agent.jsonc`.

## What the profile decides

### The brain (ADR-0007)

`model` is the **agent** LLM: it plans, calls tools, and executes. It is
deliberately *not* the model Hannah speaks with — that persona model lives in
`hannah-backend`. Two brains, two jobs: the persona talks and never executes;
the agent executes and never talks (ARCHITECTURE §4).

`small_model` handles cheap side work (session titles, summaries), so routine
bookkeeping never costs a frontier-model call.

`enabled_providers` is pinned to a single provider. Any other provider stays
inert **even if its API key is present in the environment** — the engine
auto-loads providers from the environment otherwise, which would be a quiet
way to send task content somewhere you did not choose.

### Reach (ADR-0010, SECURITY §4)

The `permission` block encodes the **`companion` preset**: reading is free,
writing asks, network tools are denied outright, and the shell runs a small
read-only safe-list (`ls`, `cat`, `git status`, …) without asking while
everything else asks. Rules are last-match-wins and **anything unmatched
defaults to `ask`**, so a tool added by a future engine update cannot appear
pre-approved.

Three things this layer deliberately does *not* do:

- **It is not the security boundary.** Config is user-editable and model-visible
  in effect; the non-negotiable denials (sensitive paths, danger commands) belong
  to the policy layer in M1.2, which sits underneath and cannot be approved away.
- **It has no timeout.** The engine blocks forever on an unanswered approval
  (M0.1 audit §4). "No answer means no" is the façade's job (M1.3).
- **It cannot express per-path shell rules.** Shell patterns match the *command
  prefix*, not the paths a command touches. `rm` asks; deciding that
  `rm ~/.ssh/id_rsa` must never be askable at all is again M1.2.

`webfetch`/`websearch` are denied *and* removed from the tool list, because the
audit found they send query text to third parties (exa.ai, parallel.ai). If a
macro later needs the web, it goes through an explicit MCP server with its own
approval class, not through a tool that is quietly always present.

### MCP servers (ADR-0012)

That promise is now kept by the `mcp` block, which ships one server —
Playwright — **disabled** and version-pinned.

Two things are easy to get wrong here. First, **enabling a server in this file
is not enough**: trust is decided per server in
`packages/agent/src/hannah/policy/mcp.ts`, and a tool from a server that is not
allowlisted there is denied by the hard policy layer before any preset sees it.
That is deliberate friction — an MCP tool is asked about with no arguments, so
the denylist and command scanner cannot vet it, and the server is the only place
left where a real decision can be made.

Second, **pin the version**. `@latest` in a config file means a package the user
did not choose gets run on their machine (T6). If you bump Playwright, bump it
here on purpose.

MCP tools are never `low` risk, so they always need a HUD button — a spoken
"sí" cannot grant one (T7).

### Blast radius

`subagent_depth: 1` stops subagents from spawning subagents. `snapshot: true`
keeps the file snapshots that let a task be undone. `tool_output` caps keep a
runaway command from filling the session. `formatter`/`lsp` are off: they exist
for coding sessions and cost startup time and file watching that a desktop
companion does not need.

### The server

Loopback only, port **8006** (Hannah's slot after motion-lab on 8005), mDNS off,
CORS empty. The backend is the only client, and it reaches the sidecar over
localhost. A CLI `--port` flag overrides the config value.

**Authentication is not in the profile.** Set `HANNAH_AGENT_SERVER_PASSWORD`
in the environment that launches the server; without it the engine prints
`server is unsecured` and accepts any local caller. On a single-user machine
loopback binding is the real control, but set it anyway before the sidecar ever
runs somewhere shared.

## Model catalog egress (ADR-0009, decided here)

The engine fetches a model catalog (pricing, context limits, capabilities) at
startup and hourly thereafter. Upstream pointed this at `models.opencode.ai`;
this fork points it at **`https://models.dev`**, the origin that mirror serves —
verified byte-identical, so the change costs nothing and removes a dependency on
the project we forked from.

That leaves exactly two egress destinations in a default install: **your model
provider** and **models.dev**. Narrow it further if you want:

| You want | Do this |
| --- | --- |
| A pinned, offline catalog | `HANNAH_AGENT_MODELS_PATH=/path/to/api.json` (fetch it once with `curl https://models.dev/api.json`) |
| A different mirror | `HANNAH_AGENT_MODELS_URL=https://example.com` (the engine appends `/api.json`) |
| No catalog at all | `HANNAH_AGENT_DISABLE_MODELS_FETCH=1` — needed only for providers the catalog does not know; the local profile declares its models inline, so it works with the fetch off |

The catalog is cached under `~/.cache/hannah-agent/models.json` and refreshed
at most every 5 minutes.

## When it does not work

The engine reports **missing provider credentials as `Model not found`** — and
will happily suggest the exact model you just asked for:

```
failed  Model not found: anthropic/claude-opus-5.
        Did you mean: claude-opus-5, claude-opus-5-fast, claude-opus-4-5?
```

That is an upstream wart, not a typo on your side: the catalog knows the model,
but the provider has no credentials, so nothing resolved. Fix it with
`export ANTHROPIC_API_KEY=...` (or `hannah-agent auth login`), or switch to the
local profile. `scripts/hannah-smoke.ts` prints this hint when it sees that
error.

## Verifying it

```bash
scripts/boot-matrix.sh          # all four cases
scripts/boot-matrix.sh airgap   # just the isolated one
```

The matrix boots the server under a scratch `$HOME` in each supported shape and
asserts it becomes healthy *and* creates no `opencode`-named paths. Every case
runs with `env -i`, so a stray key in your shell cannot make a broken
configuration look fine:

| Case | Asserts |
| --- | --- |
| `offline` | Boots with no provider key and no catalog fetch |
| `anthropic` | Boots with the Anthropic profile and a key present |
| `ollama` | Boots with the local profile and no catalog |
| `airgap` | Boots inside an unprivileged **network namespace** — loopback is the only reachable network. This is the real "needs no egress" proof; the other cases only show it doesn't *use* the network |

`airgap` is skipped automatically where unprivileged network namespaces are
unavailable.

The shipped profiles are also covered by
`packages/agent/test/hannah/profile.test.ts`, which parses them against the
engine's config schema and asserts the preset still resolves the way SECURITY
§4 describes — so weakening a permission by accident fails CI rather than
shipping.

## Editing your own copy

The installed file is yours; the template is only a starting point. Two habits
worth keeping:

1. **Re-run the profile test after editing** if you changed `permission` —
   copy your file over the template, or point the test at it — because
   "unmatched defaults to ask" makes it easy to *think* you allowed something.
2. **Prefer narrowing to widening.** If a macro keeps asking for the same
   command, add that exact command prefix to the `bash` safe-list rather than
   loosening `"*"`. The wildcard is the one rule that governs everything you
   have not thought about yet.
