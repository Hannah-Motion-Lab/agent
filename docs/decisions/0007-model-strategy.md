# ADR-0007 — Model strategy: separate agent LLM

- Status: **Accepted** (D1, 2026-08-17: Anthropic default + Ollama profile)

## Context

The backend's persona LLM (Groq `llama-3.1-8b-instant` / local Ollama) is
chosen for sub-second streaming, and is far too weak for reliable multi-step
tool use. The engine supports every major provider via the `ai` SDK.

## Decision

1. The agent LLM is configured **independently** of the persona LLM — separate
   provider, key, and model, set in the Hannah profile (`M1.1`), never shared
   with backend config.
2. **Default profile**: Anthropic Claude (current Sonnet-class model) via API
   key — best tool-use reliability per cost for agentic work.
3. **Alternative profile** (maintained and tested in the boot matrix): local
   Ollama with a strong open tool-calling model (e.g. Qwen-coder class) for
   offline/sensitive contexts — with documented reliability expectations.
4. Subagents (`task` tool) inherit the task's model in v0; cheap-model routing
   for trivial macros is deferred to M4.4.
5. Cost controls are non-optional: per-task timebox + token caps (M1.3),
   cost surfaced in `task.completed.stats`.

## Rationale

- Two-brains separation is the core architecture (VISION); sharing model config
  between repos would blur it and couple failure modes.
- Task success rate is the product: the strongest available tool-use model is
  the default; frugality comes later as routing, not as a weaker default.

## Consequences

- Cloud default means task-touched file content reaches the provider —
  disclosed in SECURITY §6; the local profile is the documented opt-out.
- Provider breakage is a fork-maintenance surface (UPSTREAM.md allows porting
  provider fixes).
