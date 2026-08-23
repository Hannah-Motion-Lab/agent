# Vision — hannah-agent

> Status: living document. Last updated 2026-08-14.

## One sentence

**hannah-agent gives Hannah hands**: it is the engine that lets the desktop avatar
act on the user's computer — files, shell, apps, projects — the way a coding agent
does, but driven by voice, embodied in a character, and safe by default.

## Where it sits

Hannah is a real-time AI avatar composed of three existing repos plus this one:

| Repo | Role |
| --- | --- |
| `hannah-frontend` | The body — React/Three.js VRM avatar, HUD, mic/camera |
| `hannah-backend` | The nervous system — realtime ASR → persona LLM → TTS pipeline, WebSocket gateway, sidecar coordinator |
| `hannah-motion-lab` | The movement — text→motion generative model (sidecar :8005) |
| **`hannah-agent`** | **The hands — headless agentic engine (sidecar :8006), forked from opencode v1.18.18** |

The backend already follows a sidecar pattern (ASR :8001, TTS :8002, vision :8003,
EMAGE :8004, motion-lab :8005). hannah-agent is the next sidecar: a long-lived local
server the backend dispatches **tasks** to and receives **events** from.

## Two brains, one character

This is the central design idea and it must never blur:

- **Persona LLM** (backend): small, fast, streams speech in <500 ms. It *is* Hannah —
  personality, conversation, emotion, gestures. It never executes anything.
- **Agent LLM** (this repo): strong tool-calling model. It executes multi-step tasks —
  slow is fine, correct and safe is mandatory. It has no personality; its output is
  events, not dialogue.

The persona *delegates* to the agent (via a `[TASK:...]` tag, like the existing
`[MOTION:]` protocol) and *narrates* the agent's event stream back to the user.
The user experiences one character who talks instantly and works in the background.

## Product pillars

1. **Voice-first.** Every interaction — dispatch, progress, approval, result — must
   work with no keyboard and no visible terminal. If a flow can't be spoken and
   heard, it isn't done.
2. **Safe by default.** The agent can touch the user's real files. Risk-tiered
   permissions, explicit approval for destructive actions, allowlisted workspace
   roots, and a full audit trail are launch requirements, not polish.
3. **Local-first.** The engine runs on the user's machine, binds to localhost, and
   phones home to nothing except the chosen model provider (and the models.dev
   catalog). Upstream's share/account/cloud services stay disabled.
4. **Narratable.** Events are designed to be spoken: short, human, throttled.
   A task that cannot be summarized out loud in one sentence per step is emitting
   the wrong events.
5. **Insulated fork.** Backend and frontend only ever see the small, versioned
   Hannah façade API — never engine internals. The engine underneath can be
   refactored (or resynced with upstream) without breaking Hannah.

## Primary scenarios (the demos we build toward)

- **S1 — Desk assistant**: "Hannah, ordena mi carpeta de descargas." She confirms
  the plan out loud, asks before moving anything, reports "listo — 34 archivos en
  4 carpetas."
- **S2 — Coding hands**: "Run the tests in the backend repo and fix the lint
  errors." She works in the background while the conversation continues, and
  narrates milestones.
- **S3 — Approval by voice**: The agent wants to run `rm` on 12 files. Hannah asks;
  the user says "sí, dale"; the task proceeds. Silence or "no" means no.
- **S4 — Barge-in discipline**: The user interrupts Hannah mid-narration. Speech
  stops instantly (existing backend behavior); the *task keeps running* unless the
  user says stop.
- **S5 — Desktop macros**: "Open my editor with the frontend project", "put on some
  music", "screenshot this and save it to the project" — a curated library of
  reliable one-shot actions.

## Non-goals

- **Not a product for third parties.** This is Hannah's engine, not a general
  coding-agent distribution. No installers, no marketplace, no multi-user server.
- **Not a cloud service.** Nothing is hosted; no accounts.
- **Not autonomous by default.** Proactive/unattended behavior arrives late
  (Phase 4), opt-in, sandboxed, and only after the security review gate.
- **Not chasing upstream.** We freeze on the forked snapshot and evolve
  independently (see [UPSTREAM.md](UPSTREAM.md), ADR-0004).
- **Not Windows/macOS, for now.** Linux first (the machine Hannah lives on).
  Nothing should gratuitously break portability, but no effort is spent on it.

## Success criteria by horizon

- **Bases set (P0)**: engine audited and documented; branding decisions executed;
  CI green; every open decision has an ADR.
- **Usable hands (P2)**: S1–S4 work end-to-end by voice, reliably enough to demo
  live without a safety net.
- **Resident agent (P4)**: Hannah runs as a service, has a macro library, a task
  history, hardened permissions — and the user actually leaves it running.
