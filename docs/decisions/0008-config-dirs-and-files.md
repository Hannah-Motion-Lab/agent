# ADR-0008 — Config/data directory & filename rename

- Status: **Accepted** (D4, 2026-08-17: rename now; execute in M0.2)

## Context

The engine still reads/writes `opencode`-named locations: global config
(`~/.config/opencode`), data/state (`~/.local/share/opencode` — exact paths to
be confirmed in M0.1), per-project `.opencode/` dirs, and `opencode.json[c]`
config files (~476 source references, see DEBRANDING.md).

## Decision

1. Rename all engine-owned locations: `~/.config/hannah-agent/`,
   `~/.local/share/hannah-agent/` (and any cache/state dirs found in M0.1),
   project dir `.hannah-agent/`, config files `hannah-agent.json[c]`.
2. **Clean break** — no legacy fallback reads. There are no existing
   installations to migrate; dual-path reading is pure complexity.
3. The agent does **not** consume a target repo's real `.opencode/` config even
   when present: when Hannah works inside somebody's project that also uses
   actual opencode, that config belongs to a different product. (Skills/agents
   authored for Hannah live in `.hannah-agent/`.)
4. Config `$schema` URLs pointing at `opencode.ai` are dropped (or replaced
   with a schema file committed in-repo); error-message doc links to
   `opencode.ai` are removed or repointed at our docs.

## Rationale

- Config-dir collision with a real opencode install on the same machine (the
  dev machine has one) causes genuinely confusing bugs — sessions and auth
  landing in the other product's storage.
- These names are user-visible surface ("what's this folder?"); leaving them is
  the kind of half-fork that erodes trust in every other rename.

## Consequences

- ~476 string sites + test fixtures (including literal fixture *directories*)
  must move together; the DEBRANDING.md behavioral check (boot under a scratch
  `$HOME`, assert only `hannah-agent` paths appear) is the acceptance test.
- Documentation of engine features that reference config paths must be updated
  in the same pass.
