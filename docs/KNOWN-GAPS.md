# Known gaps

> Status: opened 2026-08-22 after M3.4; #4 and #12 closed in M3.6 the same day.
> Reviewed at every phase boundary; an entry leaves only when it is closed or
> explicitly accepted.

Every item here was found and stated during the work rather than discovered
later. That is the point of the file: a caveat mentioned once in a commit
message is a caveat that has been lost. Each entry says what is open, **why** it
is open, what closing it actually involves, and what should trigger doing it.

Nothing here is a bug in shipped behaviour. Bugs get fixed; these are the places
where the work is knowingly incomplete.

| # | Gap | Blocked on | Cost | Trigger |
| --- | --- | --- | --- | --- |
| [1](#1) | Macro trials never run against a model | API key | ~1 h | First key |
| [2](#2) | Phase 1 end-to-end run unverified | API key | ~30 m | First key |
| [3](#3) | `agent/` not on GitHub | Owner | — | Owner's call |
| [15](#15) | P2/P3 backend+frontend work targets a stale checkout | Rebase | ~1 d | Before merging any of it |
| ~~4~~ | ~~Frontend has no build or test in the loop~~ | — | — | **closed in M3.6** |
| [5](#5) | Full agent suite is flaky under load | Nothing | ~2 h | Before CI runs it on a shared runner |
| [6](#6) | Four macros have no sandboxed trial | Design | ~4 h | If one of them misbehaves twice |
| [7](#7) | MCP servers are not sandboxed | Design | ~1 wk | Second MCP server |
| [8](#8) | Voice approvals cannot identify the speaker | Research | — | P4 security review |
| [9](#9) | Queue positions go stale in the HUD | Nothing | ~1 h | If a queue of 3 becomes normal |
| [10](#10) | Narration targets the newest session only | Nothing | ~2 h | Second simultaneous client |
| [11](#11) | Task outcomes never reach long-term memory | Product | ~3 h | Owner's call |
| ~~12~~ | ~~The avatar is idle while the hands work~~ | — | — | **closed in M3.6** |
| [13](#13) | ~1,370 `opencode` strings in prose | Deliberate | — | ADR-0009 stage 2 |
| [14](#14) | Duplicate `@hannah/Image` service tag | Deliberate | ~1 h | If it ever bites |

---

## Blocked on something outside the code

### 1
**Macro trials never run against a model.** M3.2's acceptance bar is ≥9/10 per
macro on a scripted trial. That is a claim about a model's behaviour and cannot
be asserted from source, so it is not met and was not reported as met.

*Approach.* `bun run scripts/macro-trials.ts --runs 10` against a live sidecar
settles it. Six macros have sandboxed trials that check outcomes a wrong answer
cannot fake. Expect the first run to fail somewhere — that is what it is for.
Failures are fixed in the `SKILL.md`, not in the checks.

*Meanwhile.* `--dry` runs in CI and proves the trials themselves are
well-formed. A broken trial that silently skips is worse than no trial.

### 2
**Phase 1's end-to-end run is unverified.** Everything up to and including the
façade is exercised against a fake engine. `scripts/hannah-smoke.ts` drives the
real one and has been run — but never with a model attached, so the model half
of the path (prompt → tools → events) has no live evidence.

*Approach.* Run the smoke script with a key. It already prints a credential hint
when the model is missing, so the failure mode is explained rather than cryptic.
Do this before item 1: a broken engine binding would make every macro trial fail
for the same uninteresting reason.

### 3
**`agent/` is not on GitHub.** The owner's step, deliberately deferred. Nothing
in the repo assumes a remote; `scripts/test-ci.sh` and the workflow in
`.github/workflows/ci.yml` are ready for one.

### 15
**The Phase 2 and 3 work in `hannah-backend` and `hannah-frontend` was written
against checkouts that are 51 and 27 commits behind `origin/main`.** Found on
2026-08-22 while reviewing the sibling repos before this repo's first commit.

What landed upstream in the meantime is not incidental: a tool layer with a real
pty behind `TOOLS_SYSTEM_CONTROL`, `[RUN:]` action tags, `SKILL.md` skills
injected into the model, window control, a security pass from
`hannah-workspace/AUDIT.md`, ESLint and 59 tests. Several of those are
counterparts to things built here — the skill mechanism and the action tag most
of all.

*Consequence.* None of the agent-side work is affected: this repo is
self-contained and shares no path, port or process with the rest. The backend
and frontend changes, however, will not merge as-is, and some of them should not
merge at all until [COEXISTENCE.md](COEXISTENCE.md)'s first question is
answered — which layer owns model-initiated actions.

*Approach.* Fetch, read the tool layer, then rebase the agent bridge onto it
rather than replaying it. The bridge (`gateway/agentBridge.js`) is the part
worth keeping intact; the `[TASK:]` protocol text has to be reconciled with
`[RUN:]`, and the two skill catalogues have to be deduplicated.

*Trigger.* Before merging any of it. Do not open a PR from the stale tree.

*Update 2026-08-26.* The bridge was rebuilt on the current backend
(`hannah-backend/src/pipeline/agentBridge.js`, one voice: the persona narrates
the façade's events). The first task against a real model then exposed a drift
on *this* side: `translate.ts` expects the runner's `session.next.*` events, but
`GlobalBus` only carries the v1 message vocabulary (`message.part.updated`,
`message.updated`), so a task that ran three commands was reported as "the model
produced no output". `facade/bus-events.ts` now derives the expected events from
the v1 parts, once per part; covered by `test/hannah/bus-events.test.ts`.

---

## Environment and tooling

### 4 — closed in M3.6 (2026-08-22)
Deps are installed, `npm run build` runs Vite for real (it passes, so everything
written in P2–P3 compiles rather than merely parsing), and Vitest covers the
store's agent slice and the posture derivation — 33 tests. Writing them found a
real bug immediately: resolving an approval never returned the task to
`running`, so the panel's state pill was stale after every approval.

Still uncovered, deliberately: the 3D render itself. That needs a GPU and a
person looking at it, and no test replaces either.

<details><summary>Original entry</summary>

**The frontend has no build or test in the loop.** `hannah-frontend` has no
`node_modules` here, so changes are verified with
`npx esbuild src/App.jsx --bundle` — which parses and links the whole module
graph but does not run Vite, does not resolve real dependency versions, and
executes no component.

*Why it is acceptable so far.* The frontend work in P2–P3 is a store slice, a
panel, and message handlers. The bundle check catches every syntax and import
error, which is the failure mode that would otherwise reach the user.

*What it does not catch.* A wrong Zustand selector, a React hook rule
violation, a style that collapses at a real viewport, a peer-dependency
conflict.

*Approach.* `npm install --legacy-peer-deps` once, then add `npm run build` to
the verification loop, and Vitest + Testing Library for the two components with
real logic (`AgentTaskPanel`, the store's agent slice). The store slice is pure
and worth testing on its own — its reducers already carry three rules that a
future edit could silently break (merge-don't-reset on a repeated
`agent_task_started`, queued tasks not taking the panel, resolutions clearing
the matching pending item).

*Trigger.* M3.6 is a frontend milestone. Do it there, before writing the code.

</details>

### 5
**The full agent suite is flaky under load.** Running all 256 test files in
`packages/agent` at once produces ~40 failures, every one in a test that spawns
a subprocess (`test/cli/**`, the TUI thread tests). Verified not to be
regressions: `./test/cli/` alone gives 368 pass / 0 fail, and
`scripts/test-ci.sh` exits 0 on the same command.

*Why it happens.* Bun runs files concurrently; each of these tests starts a real
`hannah-agent` process, and dozens of cold starts contend for CPU until some
exceed their timeout.

*Why it matters.* Not because CI is red — it is green. Because a suite that
fails differently each run trains people to ignore it, and the day a real
regression lands in `test/cli/` nobody will believe it.

*Approach, cheapest first.* (a) Raise the timeout for subprocess tests
specifically — they are slow by nature and the current value is tuned for unit
tests. (b) Failing that, run them in their own CI step with limited concurrency
(`bun test --concurrency 1 ./test/cli/`), which is what `test-ci.sh` should do
rather than relying on the whole-suite run happening to pass. (c) Record the
decision in `docs/audit/M0.4-test-baseline.md`, which already classifies
load-sensitive tests and is the right home for this.

*Do not* quarantine them. They cover the CLI surface end to end and they pass.

---

## Deliberate design debt

### 6
**Four macros have no sandboxed trial.** `open-project`, `media-control`,
`launch-app` and `download-and-file` act on the live desktop or the network, so
a disposable directory cannot contain them: the first two would open real
windows, the third launches real applications, the fourth reaches the internet.

*Approach.* Two of them are testable with a fake on `PATH` — a stub `gtk-launch`
and a stub `playerctl` that record their arguments to a file the check reads.
That tests the *decision* (did it resolve the right `.desktop` entry? did it use
a relative volume step?) without the effect, which is the part that actually
goes wrong. `download-and-file` can point at a local HTTP server. `open-project`
is the one genuinely resistant to it.

*Trigger.* If any of the four misbehaves twice, write the stub rather than
re-reading the skill.

### 7
**MCP servers are not sandboxed.** ADR-0012 decides *whether* a server may be
reached; nothing constrains it once it is. A local MCP server is a child process
with the agent's own privileges, and its tool calls are opaque to policy — which
is precisely why the allowlist is a code change and Playwright ships disabled.

*Approach.* Out of scope for P3 and noted in P4 hardening. The realistic shape
is a container or a `bubblewrap`/`systemd-run` wrapper per server, with the
allowlist entry declaring the sandbox profile alongside its capabilities. The
capability list added in M3.3 is already the right place to hang that.

*Trigger.* The second MCP server. One disabled server is a documented risk; two
enabled ones is a posture.

### 8
**Voice approvals cannot identify the speaker.** Anyone in the room can say
"sí". M3.4 closed *when* an utterance counts (it must have started after the
question); *who* said it is untouched, and `high`-risk approvals route to the
HUD precisely because of that.

*Approach.* Speaker verification is a research task, not an afternoon. Recorded
as residual T7 in SECURITY §3 and in the P4 review scope. The cheap partial
mitigation already exists and should stay: risk tiering.

### 13
**~1,370 `opencode` strings remain in prose.** Comments, `specs/`, upstream
design docs, and the dormant features that name upstream's own services
(`github`/`pr`, `account`/`console`, `.well-known/opencode`). Renaming those
would make them *wrong* — they identify real third-party things.

*Approach.* They die with the features when ADR-0009 stage 2 prunes them.
`docs/DEBRANDING.md` has the verification greps; the functional surface is
already at zero.

### 14
**Duplicate `@hannah/Image` service tag** in v1 (`packages/agent`) and v2
(`packages/core`). Pre-existing upstream duplication, preserved exactly by the
rename rather than introduced by it.

*Approach.* Resolve only if it causes a real collision. ADR-0004 freezes the
upstream target, so the duality is temporary by construction.

---

## Product gaps not yet scheduled

### 9
**Queue positions go stale in the HUD.** `task.accepted` carries the position a
task had when it was accepted; the queue shifts underneath and nothing re-emits.
`GET /tasks/{id}` carries the live `queuePosition`, so the data exists — nothing
consumes it.

*Approach.* Either emit a position update when the queue advances (noisy, N
events per completion) or have the bridge recompute positions locally from what
it already knows and re-broadcast the affected headers (quiet, and the bridge
already re-broadcasts a header when a task is promoted). Prefer the second.

*Trigger.* Only worth it if a queue of three becomes normal. With one or two
waiting, "en cola" is the whole story.

### 10
**Narration targets the most recently attached session.** With two browsers
open, only the newest hears anything. The bridge broadcasts HUD messages to all
clients — it is only the *voice* that picks one.

*Approach.* The owning session is already knowable: `dispatchTask` sets
`session.agentTaskId`. Threading that to the bridge (without an import cycle —
inject it like the narrator) would let narration follow the session that asked,
falling back to the newest. Worth doing when a second client is real; today it
is one avatar on one screen.

### 11
**Task outcomes never reach long-term memory.** Narration lands in the
conversation as an assistant turn, so `memoryStore`'s summariser sees it by
accident. Nothing deliberately records "she organised Downloads on Tuesday".

*Approach.* On a terminal event, write a one-line fact through the existing
summariser path rather than inventing a second store. The risk to avoid is
memory filling with chore receipts: only completed tasks, only those the user
asked for by name, one line each.

*Trigger.* Owner's call — this is a product decision about what Hannah should
remember about herself, not a defect.

### 12 — closed in M3.6 (2026-08-22)
Five postures derived from task state drive gaze, emotion and a slight lean.
The distinguishing signal is the **gaze** — working looks at her task and stops
following you, waiting looks straight at you and holds — because that is what
reads across a room. The posture's emotion applies only while she is silent;
while she speaks, what she is saying wins.

Remaining edge: `SmplxAvatar`, the debug rig, ignores posture. Worth doing only
if that rig stops being debug-only.
