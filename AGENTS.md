# Working in this repo

`hannah-agent` — the agentic engine behind the Hannah avatar. A hard fork of
opencode v1.18.18, stripped to the headless engine and frozen (ADR-0004).
**Read [`docs/README.md`](docs/README.md) before making design decisions**; the
roadmap, the `/hannah/v0` contract, and the security model live there.

## Fork discipline

- **Upstream is frozen.** We do not pull upstream releases and we do not
  continue upstream's v1→v2 (Effect) migration. Port security/provider fixes by
  hand and log them in [docs/UPSTREAM.md](docs/UPSTREAM.md).
- **Build on the v1 runtime path** (`packages/agent/src`). Touch the v2
  packages (`core`, `server`, `protocol`, `schema`) only where v1 already
  depends on them. Never modify both stacks to implement one feature.
- **One seam.** Hannah-specific code lives in `packages/agent/src/hannah/` and
  is reached only through the `/hannah/v0` façade. `hannah-backend` never
  imports engine code and never calls native engine routes
  ([docs/INTEGRATION.md](docs/INTEGRATION.md)).
- **Docs move with code.** A change to the façade contract, the security
  posture, the fork's relationship to upstream, or where a whole feature lives
  needs its doc update *and* an ADR in the same change.

## Naming

Scope `@hannah/*`; binary and package `hannah-agent`; env prefix
`HANNAH_AGENT_*`; config `~/.config/hannah-agent/hannah-agent.json[c]` and
project `.hannah-agent/`. Before renaming anything else, check
[docs/DEBRANDING.md](docs/DEBRANDING.md) — some `opencode` strings are
deliberate (third-party package names, upstream's provider id, the photon
patch token, the MIT notice) and must stay.

## Verifying a change

```bash
bun install
bun turbo typecheck        # all 14 packages must pass
cd packages/<pkg> && bun test   # tests cannot run from the repo root
bun run dev serve          # smoke: the headless server Hannah talks to
```

After any mechanical/scripted edit across the tree, run **all three**:
typecheck, the full test suite, and the boot check in DEBRANDING.md §Verification.
Typecheck alone does not catch string-level breakage (a renamed config base
name once broke every project-config lookup while typecheck stayed green).

Quarantined tests and their reasons: [docs/audit/M0.4-test-baseline.md](docs/audit/M0.4-test-baseline.md).

## Branches and commits

- Default branch `main`; work on short feature branches
  (`session-recovery`, `facade-events` — no `feat/` prefixes, max three words).
- Conventional commit subjects: `type(scope): summary` with types
  `feat`, `fix`, `docs`, `chore`, `refactor`, `test`; scope is the package or
  area (`agent`, `core`, `tui`, `facade`, `docs`).
- Regenerate the API reference with `bun run --cwd packages/agent src/index.ts generate`
  after changing the public `HttpApi`; commit `packages/sdk/openapi.json` with
  the change.

## Style (inherited from upstream, still in force)

### General

- Keep things in one function unless composable or reusable. Do not extract
  single-use helpers preemptively.
- Avoid `try`/`catch` where possible. Avoid the `any` type.
- Use Bun APIs when possible, like `Bun.file()`.
- Rely on type inference; annotate only for exports or clarity.
- Prefer functional array methods over for loops; use type guards on `filter`
  to keep inference downstream.
- In `src/config`, follow the existing self-export pattern at the top of the
  file (e.g. `export * as ConfigAgent from "./agent"`).
- In Effect generators, bind services to named variables first. No nested
  service yields such as `yield* (yield* Foo.Service).bar()`.
- Reduce variable count by inlining values used once.

### Destructuring

Avoid unnecessary destructuring; use dot notation to preserve context.

### Imports

- Never alias imports; never use star imports. Import a module's own exported
  namespace by name, e.g. `import { Project } from "@hannah/core/project"`.
- Prefer dynamic imports for heavy modules only needed on some paths,
  especially in startup-sensitive entrypoints. Destructure the binding near the
  top of the narrowest scope that needs it; avoid inline
  `(await import("./m")).value()` chains.

### Variables and control flow

Prefer `const`; use ternaries or early returns instead of reassignment. Avoid
`else` — prefer early returns. When a function has several validation
branches, keep the main function on the happy path and move supporting detail
into small helpers below it, extracting only when it names a real concept.

### Comments

Comment non-obvious constraints and surprising behavior — never obvious
assignments or control flow.

### Drizzle schema

Use snake_case field names so column names need not be redefined as strings.

## Testing

- Avoid mocks; test the real implementation rather than duplicating logic.
- Tests cannot run from the repo root (guard: `do-not-run-tests-from-root`);
  run them from package directories.
- Snapshot changes must be reviewed, not blindly `--update-snapshots`-ed.

## V2 session core (upstream design notes)

The Effect-based v2 stack in `packages/core` carries invariants that still
apply where v1 consumes it — durable prompt admission separate from model
execution, process-global `SessionExecution` keyed by Session ID,
Location-scoped runner/permissions/filesystem, one explicit `llm.stream` per
provider turn, explicit steer/queue delivery semantics, and Session-owned
context epochs. Full statements live in [CONTEXT.md](CONTEXT.md). Per ADR-0004
we do not extend this migration; treat these as constraints, not a roadmap.
