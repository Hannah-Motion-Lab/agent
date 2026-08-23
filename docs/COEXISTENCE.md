# Coexistence with the rest of the Hannah project

> Written 2026-08-22, before this repo's first commit, after reading
> `hannah-workspace` and `hannah-desktop` and the 51 commits `hannah-backend`
> has on `origin/main` that this workspace's checkout does not.

**Read this before enabling the agent on a machine that already runs Hannah.**
The sidecar does not collide with anything at the port or filesystem level, but
it overlaps in *purpose* with a capability the backend already has, and running
both without deciding which one owns the job would ship two shells, two skill
systems and two safety models in one product.

## What the other repos are

| Repo | What it is | Relationship to this one |
| --- | --- | --- |
| `hannah-backend` | WS/REST orchestrator: ASR→LLM→TTS, memory, **and a tool layer with a real pty, `[RUN:]` action tags and `SKILL.md` skills** | **Overlaps.** See below. |
| `hannah-frontend` | React/three.js client, VRM avatar, HUD, **terminal panel** | Hosts the agent's HUD; the terminal panel belongs to the backend's tool layer |
| `hannah-motion-lab` | text→motion on :8005 | No relationship |
| `hannah-desktop` | Electron overlay, 400×620 widget | No functional relationship; **a layout problem** — see below |
| `hannah-workspace` | `./hannah` launcher + project docs | Must learn about the sidecar to start, stop and diagnose it |

Neither `hannah-desktop` nor `hannah-workspace` is an alternative to this
sidecar: one is a window, the other is a launcher.

## The real overlap: the backend's own tool layer

`hannah-backend` already does "act on the computer", and it got there first:

- a **real persistent shell** (`node-pty`) behind `TOOLS_SYSTEM_CONTROL`, with a
  `⌨` panel in the UI,
- **`[RUN:]` and friends** — a tag-based action protocol, chosen deliberately
  because it is reliable on a 7B local model where function-calling is not,
- **`skills/<name>/SKILL.md`** injected into the model, the same mechanism this
  repo uses for its macros,
- `web_search` / `fetch_url`, window control, deterministic parsers,
- a destructive-command confirmation (`rm`, `dd`, `mkfs`, …) as the safety net.

**Is it a complete alternative? No — but it is a real one.** Honest comparison:

| | backend tool layer | hannah-agent |
| --- | --- | --- |
| Multi-step autonomous work | one action per tag | a full agent loop with a plan |
| Approvals | confirmation on destructive patterns | risk-tiered, timeout=deny, voice vs HUD (T7) |
| Sensitive paths | — | denylist evaluated before any preset |
| Task lifecycle | — | timebox, queue, cancel, history, audit trail |
| Cost | none (same 7B) | a second, larger model |
| Processes | none | one more sidecar |
| Works on a 7B local model | **yes, by design** | no — it wants a capable model |

The last two rows are why this is a decision and not an upgrade. The backend's
layer is *cheaper and simpler and already shipped*; this sidecar is *safer and
far more capable and costs a second model*.

## The decision to make first

Pick one, and say so in the workspace README:

1. **Agent owns actions.** Turn `TOOLS_SYSTEM_CONTROL` off, keep the backend's
   pty panel as a manual terminal only, and route every model-initiated action
   through `[TASK:]`. One safety model, one skill system. Costs a cloud model.
2. **Backend owns actions; the agent is opt-in for big jobs.** `[RUN:]` keeps
   the quick deterministic ones; `[TASK:]` only appears in the prompt when the
   sidecar is up (it already works that way). Two systems, but with a rule the
   persona can follow.
3. **Backend only.** Ship this repo as an alternative and leave it off.

Option 2 is the pragmatic one and the closest to what exists today, but it is
only coherent if the *boundary* is written down: **`[RUN:]` for one command with
a known shape, `[TASK:]` for anything needing several steps or a decision.**
Without that sentence in the protocol text, a 7B model will pick whichever tag
it saw most recently.

## Concrete work, per repo

### hannah-backend

1. **Two action tags in one prompt.** `[RUN:]` and `[TASK:]` compete. Add the
   boundary sentence above to `llm.taskProtocol`, and measure — the risk
   register already lists persona tag misuse as high-likelihood.
2. **Two skill systems.** `backend/skills/<name>/SKILL.md` and
   `~/.config/hannah-agent/skill/<id>/SKILL.md` do not collide on disk, but
   several capabilities are duplicated by name (`find-file`, `launch-app`,
   `media-control`, `organize-downloads`). Decide which side owns each, and
   delete the loser — a capability that exists twice will diverge.
3. **Two shells with different safety models** is the item that actually
   matters. The pty has no allowlist; the agent has a denylist, risk tiers and
   an audit log. Whichever survives should be the only one the model can reach.
4. **Language.** The backend pins `Reply ALWAYS in English` because `af_heart`
   is the only good Kokoro voice. This repo's narration strings and the
   `context.language` default were written in Spanish. Either flip them to
   English or thread the real value through — do not leave both.
5. **This workspace's checkout is 51 commits behind `origin/main`.** The Phase 2
   and 3 backend work in it was written against the older tree and will not
   merge as-is; it must be rebased onto the tool-layer code, where several of
   its pieces (skills, tags, confirmation) already have counterparts.

### hannah-frontend (27 commits behind `origin/main`, same caveat)

The HUD components added here assume a full browser window:

- `AgentTaskPanel` is **330 px wide** at `right: 18px` — in the 400×620 overlay
  that is 87% of the width, covering the avatar.
- `AgentHistoryPanel` asks for 520 px and clamps to `calc(100vw - 40px)`; it
  will fit at 360 px but its rows are laid out for twice that.

Neither is broken in a browser tab. Both need a compact variant, or to be a
separate window, before the overlay is the default surface.

### hannah-desktop

No code change needed. It never talks to :8006 and does not need to. Its only
requirement is the one above: whatever the HUD shows has to fit a 400×620
widget, or open elsewhere.

### hannah-workspace

The launcher is where the sidecar becomes real:

- `./hannah` should start `hannah-agent serve --port 8006` when
  `AGENT_ENABLED=true`, and only then.
- `./hannah stop` must stop it — it holds no VRAM, but it does hold a port and
  an audit file handle.
- `./hannah doctor` should report whether the profile is installed
  (`~/.config/hannah-agent/`), whether the macro skills are there, and which
  macros this machine can actually run (`GET /hannah/v0/macros` says so, with a
  reason per exclusion).
- The port table in `README.md` needs a row: **8006 · hannah-agent · 127.0.0.1**.
- `SETUP.md` needs the profile install step (`scripts/install-profile.sh`) and
  the fact that without an API key the agent starts but every task fails at the
  model.
- The VRAM claim ("the whole default stack is local") stops being true when the
  agent runs against Anthropic. Either say "except the agent", or document the
  Ollama profile (`profile/hannah-agent.local.jsonc`) as the local path.

## What does *not* conflict

- **Ports.** 8006 is free: the table goes 3001, 5173, 8001–8003, 8004/8005,
  11434.
- **Config and data.** Everything this repo writes lives under
  `~/.config/hannah-agent`, `~/.local/share/hannah-agent`, `~/.cache/hannah-agent`
  and `.hannah-agent/` in a project — no path is shared with the backend
  (M0.2 renamed every one of them).
- **Processes.** The sidecar holds no GPU memory; it is a Node process talking
  to a cloud model, or to the same Ollama the rest already uses.
- **The backend's `data/`** (`settings.json`, `memory.db`) is untouched.
