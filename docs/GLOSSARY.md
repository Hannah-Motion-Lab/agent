# Glossary

Shared vocabulary across the four Hannah repos. Use these words with exactly
these meanings in code, docs, and commit messages.

| Term | Meaning |
| --- | --- |
| **Hannah** | The character/product: avatar + voice + hands, experienced as one entity. |
| **Persona LLM** | Small fast model in `hannah-backend` that talks, emotes, and emits protocol tags. Never executes. |
| **Agent LLM** | Strong tool-calling model configured in this repo. Executes tasks; never speaks to the user directly. |
| **Engine** | The forked opencode machinery in this repo (sessions, tools, permissions, providers). |
| **Façade** | The `/hannah/v0` HTTP+SSE surface — the *only* API other Hannah repos may use (INTEGRATION.md). |
| **Task** | Hannah-level unit of delegated work (façade concept). Maps to an engine session + prompt under the hood. |
| **Session** | Engine-level conversation/execution container (opencode concept). Not exposed across the seam. |
| **Tag protocol** | Backend's inline directives from the persona LLM: `[MOTION:...]`, `[EMOTION:...]`, and (P2) `[TASK:...]`. |
| **Sidecar** | A local service the backend coordinates over HTTP/WS: ASR :8001, TTS :8002, vision :8003, EMAGE :8004, motion-lab :8005, **agent :8006**. |
| **Mode / preset** | Per-task permission profile: `companion`, `trusted-project`, `paranoid` (SECURITY §4). |
| **Workspace roots** | Allowlisted directories the agent may work in. |
| **Hard policy** | Non-overridable deny rules (sensitive paths, danger commands) evaluated before any approval. |
| **Approval** | Explicit user consent for one gated action (`approvalId`), by voice, HUD, or timeout-deny. |
| **Macro** | Curated, named, tested capability from the P3 library (implemented as an engine skill + prompt). |
| **Skill** | Engine mechanism: markdown instruction pack loadable by the `skill` tool. |
| **Narration** | Backend speaking selected task events through the persona (budgeted, INTEGRATION §6). |
| **Barge-in** | User speech interrupting Hannah's TTS. Kills narration, never the task. |
| **HUD** | The frontend's on-screen panel (subtitles, settings, and — from P2 — the task panel). |
| **v1 / v2** | The two engine generations coexisting in the fork: `packages/agent` (running) vs Effect-based `core`/`server`/`protocol`/`schema` (upstream's unfinished rewrite, frozen here). |
| **Upstream** | opencode at the v1.18.18 snapshot (UPSTREAM.md). |
| **Ledger** | Append-only divergence table in UPSTREAM.md. |
