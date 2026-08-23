# ADR-0010 — Voice-first permission presets

- Status: **Accepted** (M0.5, 2026-08-18; implemented in M1.2)

## Context

The engine's permission system is config-driven allow/ask/deny per tool
(granularity confirmed in M0.1). Upstream's defaults assume a developer
watching a terminal. Hannah's user is listening to an avatar (SECURITY §1) and
the agent's reach is the home directory.

## Decision

Three named presets, selected per task (`mode` in the create-task call),
defined in one place (M1.2 policy layer) and mapped onto engine permission
config — the full matrix lives in SECURITY.md §4:

- **`companion`** (default): reads free inside workspace roots; writes ask
  (grouped per task); shell safe-list free, rest asks; deletes and network
  always ask; everything outside roots is hard-denied.
- **`trusted-project`**: coding-agent ergonomics pinned to one project dir;
  writes and non-dangerous shell free within it.
- **`paranoid`**: everything asks; for demos, debugging, and nervous days.

Plus the non-negotiable **hard policy** layer evaluated before any preset:
sensitive-path denylist, danger-command list, workspace-roots fence — not
visible to the model, not overridable by approval.

Approval requests carry `risk` (`low`/`medium`/`high`); `high` requires HUD
confirmation, not voice alone (T7). Timeout (default 120 s) = deny.

## Rationale

- Presets keep the persona's dispatch decision simple ("this is a chore in
  their project" → `trusted-project`) instead of per-permission reasoning.
- Hard policy separate from presets means a misconfigured or manipulated
  preset still cannot reach `~/.ssh` or `sudo` (T1/T2/T4).

## Consequences

- **M0.1 confirmed the granularity is sufficient** (audit §4): rules are
  `{permission: {tool: action | {pattern: action}}}`, last match wins,
  unmatched defaults to `ask`, and the shell tool asks under permission
  `bash` with *per-command-prefix* patterns (`git status`, `npm install`, …)
  derived by parsing the command — so the safe-list rows are expressible
  directly as engine config, and a per-session ruleset can be attached at
  session creation. No façade-side reimplementation is needed for the matrix.
- Two things the engine does **not** provide, which the policy layer therefore
  owns (M1.2/M1.3): the **ask timeout** (the engine blocks indefinitely, so
  timeout⇒deny is enforced by the façade replying `reject`), and the
  **sensitive-path denylist** (bash patterns are per-command, not per-path, so
  the hard-policy layer must inspect resolved paths itself).
- Also from the audit: an `always` approval is stored **in memory only** and a
  `reject` **cascades** to every other pending ask in the same session. Both
  must be reflected in the façade's approval semantics and narrated correctly
  (a single "no" can cancel more than the user expects).
- The safe-list/danger-list contents are versioned test fixtures; changing
  them requires updating the bypass-attempt tests (SECURITY §7).
