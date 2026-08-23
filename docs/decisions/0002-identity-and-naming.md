# ADR-0002 — Identity & naming conventions

- Status: **Accepted** (retroactive; executed 2026-08-14)

## Decision

| Concern | Convention |
| --- | --- |
| Product/repo/binary/main package | `hannah-agent` |
| npm workspace scope | `@hannah/*` |
| Env var prefix | `HANNAH_AGENT_*` |
| Main package folder | `packages/agent` |
| Sidecar port | `8006` (continues backend's 8001–8005 scheme) |
| Fork versioning | reset to `0.1.0` at end of P0; upstream base recorded in UPSTREAM.md (base: opencode v1.18.18) |

## Exceptions (binding)

- `LICENSE` keeps upstream's MIT copyright verbatim.
- `__OPENCODE_PHOTON_WASM_PATH` keeps its name (must match the vendored
  photon-node patch).
- Third-party package names containing "opencode" are dependencies, not
  branding.

## Notes

Remaining lower-level renames (config dirs, filenames, URLs, display strings)
are governed by ADR-0008 and tracked in DEBRANDING.md — they are functional
changes, not just naming, hence their own decision.
