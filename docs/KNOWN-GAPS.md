# Known gaps

> Status: opened 2026-08-22 after M3.4; #4 and #12 closed in M3.6 the same day.
> #16–#21 added 2026-08-27 by P5.0/P5.1 (the watches — see ROADMAP Phase 5);
> #18 closed the same day. #22 and #23 added 2026-08-27 by the **independent
> verification of P5.1**, which found thirteen defects, three of them in claims
> already made by a commit message, a test title or the roadmap.
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
| [16](#16) | R0 (a wrapper's exit code) is not implemented | Design | ~1 d | P5.2, when she can start what she watches |
| [17](#17) | R6b, R7, R8, R9, R10 are not built | Their phases | ~8 wks | P5.3 / P5.5 / P5.6 |
| ~~18~~ | ~~`~/.local/share/hannah-sense` is not on the denylist~~ | — | — | **closed 2026-08-27** |
| [19](#19) | The P5.1 exit demo is not a committed trial | Nothing | ~4 h | Before P5.2 adds acting to it |
| [20](#20) | The trip inbox is in the backend, not the sidecar | Contract | ~1 d | A second backend, or a second HUD host |
| [21](#21) | P5.1 shipped without ADR-0013 and without SECURITY T9–T12 | Nothing | ~3 h | Before P5.2 changes the façade contract |
| [22](#22) | A watched path is still classified by name, not by inode | Design | ~1 d | If the policy model ever moves off paths |
| [23](#23) | The backend ignores the sidecar's SSE `boot=` id | Nothing | ~2 h | Before a watchId can outlive a sidecar restart |

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

---

## The watches (P5.0 / P5.1, 2026-08-27)

Nothing here is a defect in what shipped. They are the edges the watch primitive
was built up to and deliberately stopped at, plus one thing its own milestone
asked for and did not get.

The last two arrived differently and it is worth saying how: P5.1 was **verified
independently after it was called done**, and the verification found thirteen
defects — among them a trip narrated to a stranger and a denylist a symlink
walked past. Those were fixed, not filed. #22 and #23 are what the fixes
knowingly left open, written down at the moment they were understood rather than
after somebody else trips over them, which is the whole point of this file.

### 16
**R0 is not implemented.** The cheapest and only *certain* rung — the exit code
of a wrapper Hannah started — is absent from the ladder. Not an oversight: in an
observe-only phase the sidecar starts nothing, so there is no wrapper whose exit
code there would be to read. The `sense.v1` contract fixes the rung enum at
R1–R10 and the row is simply not emitted; the reason is in
`capability.R0_ABSENT_REASON` and in the sidecar's README, so nobody has to infer
it from an absence.

*Consequence, stated.* Every rung she can actually arm today is an *inference*
from the outside — a PID, an mtime, a pattern, a port. R0 is the one that cannot
be wrong, and she does not have it.

*Approach.* It arrives with P5.2, where a trip can dispatch: the same frozen
command that would be re-run is the one worth wrapping in the first place. The
wrapper has to be started **by the agent**, not by the sidecar, or rule R1 is
broken on day one.

### 17
**Five rungs of the ladder are not built.** R6b (any of R1–R6 over SSH), R7
(AT-SPI), R8 (a screen region's hash), R9 (OCR), R10 (a local VLM).
`/v1/capabilities` reports each one unavailable **with the milestone that brings
it**, not with "not implemented" — an operator asking is trying to tell a bug
from a calendar. And the catalog rule holds: a rung that is not available is
absent from the assembled `[WATCH:]` vocabulary, so she cannot promise one.

R4 (GPU) is a different case and worth not confusing with these: the sensor
**exists** and the rung is deliberately unavailable, because it corroborates and
may never trip a watch alone (checkpointing and dataloader stalls both read 0 %).
It becomes available when P5.2 brings multi-sensor watches.

*Trigger.* Their own phases: P5.3 for the remote case (blocked on nothing now
that M5.0.3 is done), P5.5 for the pixels (spike first, ships disabled), P5.6 for
AT-SPI (spike first, and the honest answer to most GUI cases is A4 — the
application's own CLI — not a synthetic click).

### 18 — closed 2026-08-27
`~/.local/share/hannah-sense` and `~/.config/hannah-sense` are in
`DENIED_DIRECTORIES`, `portal-token` is in `DENIED_BASENAMES`, and the sidecar's
two state files are denied by a rule anchored on the directory name
(`[\\/]hannah-sense[\\/](grants|watches)\.json$`) in `DENIED_PATTERNS`.
Regenerated into `docs/fixtures/policy-paths.json` with eight golden cases, so
the Python side picks the same verdicts up without a second table: a
`POST /v1/watches` on the sidecar's own `watches.json` answers **403** with the
agent's own reason string, where the day before it answered **201**.

*What was decided instead of implemented.* VIGILANCE §9 asked for bare
`grants.json` and `watches.json` in `DENIED_BASENAMES`. They are deliberately
not there. Both are ordinary filenames in somebody else's tree — an IAM fixture,
a file-watcher config — a deny here is unappealable by design, and the directory
entries already cover the only place the sidecar ever writes: `config.py` pins
the path literally and refuses to follow `XDG_DATA_HOME` *because* this list
names it, which is a comment that is now true rather than aspirational. The
anchored pattern buys the one case the directory entries miss, at no cost to
anyone else's tree: a copy that kept the directory name, the shape a backup of
`~/.local/share` has. `portal-token` is denied by name because it is a bearer
secret — whoever holds it starts a ScreenCast with no dialog — so a copy is
worth exactly what the original is, the same argument `ui-token` already won.

*What remains.* Two things, both narrow. `HANNAH_SENSE_STATE_DIR` moves the
state out from under all of it; it is documented as tests-only and warns loudly,
and nothing on the agent side can tell that it was set. And `grants.json` and
`portal-token` **do not exist yet** — the rules are ahead of the files, so P5.4
and P5.5 have to use those exact names or the rules are silently dead, which is
precisely how the `hannah-backend/data` pattern came to be dead in a development
checkout (VIGILANCE B2).

*The sense-side half, and what it depends on.* The sidecar does not carry a copy
of any of this: `sidecar/sense/paths.py` reads `docs/fixtures/policy-paths.json`
out of the agent checkout beside it (`hannah-agent/` then `agent/`, overridden by
`HANNAH_AGENT_FIXTURES`) and **fails closed** when it cannot — no table means
R2/R3 report unavailable and every path watch is refused, which is the only safe
direction. Two consequences of reading a file instead of calling a service, both
open and neither worth a redesign today. The table is loaded **once per process**
and cached, because `classify()` runs on every sample of every watch, so an asset
regenerated while the sidecar is up is not picked up until it restarts. And
nothing checks the asset's `version` against the running agent, so a sidecar
installed beside a **stale** agent checkout enforces the older list in silence —
the failure mode is a rule added here that the sidecar does not have, which is
exactly the drift the generated asset exists to prevent, moved one layer out.
A `version` compare at load, logged loudly, is the cheap half of the fix; the
expensive half is deciding what a sidecar should do when it finds it is older
than the policy, and refusing to start is probably right.

<details><summary>Original entry</summary>

**`~/.local/share/hannah-sense` was never added to `DENIED_DIRECTORIES`.**
M5.0.2 asked for it in the same change as the `hannah-backend/data` fix and only
the second half landed. The sidecar's state directory is 0700 with 0600 files and
holds `watches.json`: the label the user spoke, the sensor kind, the path being
watched, the owning session id. An agent task can read all of it with `read` or
`bash`.

*Why it still matters even though it holds no credential.* The path a watch names
is often the interesting one — a log under a private project, a unit name, a
port. And it is the same class of file as `~/.local/share/hannah-agent`, which is
denied precisely so a task cannot read the machinery watching it.

*Approach.* One line in `policy/paths.ts` beside the `hannah-agent` entries, plus
`watches.json` (and, when they exist, `grants.json` and `portal-token`) in
`DENIED_BASENAMES`, then regenerate `docs/fixtures/policy-paths.json` — the
golden asset test fails until it is regenerated, which is the point of it.

*Trigger.* Now. It is thirty minutes and it was already agreed.

</details>

### 19
**The P5.1 exit demo is not a committed trial.** The bar was `sense-trials`: a
real child appending to a log, `SIGKILL` at *t*+N, a trip asserted within
`period × DEBOUNCE_N + slack`, **and** a control arm where the child is never
killed and must emit zero trips. That run happened by hand and earned its keep —
it is what found the latch bug (one dead process tripping three times in 45 s).
What is missing is the script.

*What exists instead.* The control arm as a unit test with the `stub` sensor
(`test_scheduler.py::test_el_stub_no_dispara_nunca`: ten healthy samples, zero
events, zero fires), and scheduler tests for the debounce, the latch, blindness,
recovery, faults and the clock-jump re-baseline. All of them drive the scheduler
directly with fake time.

*Why the script still matters.* Everything above proves the *decision*; none of
it proves the sampling of a real process at a real period. The repo has been here
before — `macro-trials.ts` exists because a check that merely looks for "the task
completed" passes while doing nothing.

*Trigger.* Before P5.2. The moment a trip can dispatch, "did it notice?" and "did
it notice **once**?" stop being the same question.

*The verification round did not close this and made the case for it louder.*
Everything it found, it found by reading code and by probing a running sidecar by
hand — the trip delivered to the wrong session, the symlink at sample time, the
unit name that armed and could never be sampled. A committed trial against a real
process is the one instrument nobody had, and two of those three would have shown
up in one.

### 20
**The trip inbox lives in the backend, not in the sidecar.** `VIGILANCE.md` §10
puts the durable inbox in `hannah-sense`; it is in `senseBridge.js`, writing
under the backend's `data/`. Marked in the code (backend `34aa48e`) rather than
left to be read later as though the plan had said so.

*Why.* The `sense.v1` contract has no inbox route, and the sidecar knows nothing
about sessions or about `attachSession` — which is the delivery condition for a
trip that happened while nobody was there. Putting it in the sidecar means either
teaching it the session model or adding a route that exists for one consumer.

*What it costs.* A trip survives a sidecar restart, a HUD reload **and a backend
restart** — the file is read back at `init()` and there is an acceptance test for
it (`senseBridge.test.js`, "el buzón sobrevive a un reinicio del backend") — but
not a reinstall that wipes `data/`, and two backends against one sidecar would
each keep their own. Neither is a shape this product has today.

*What does not survive the restart is the ownership, and that is deliberate.*
`conversationManager` lives in RAM, so after a backend restart no stored trip can
belong to a session that still exists; every one of them comes back as an
**orphan** — narrated to whoever is listening, in words that say it was set up in
an earlier conversation and do not tell the listener they asked for it. Erring
the other way would mean guessing that the person in front of the machine is the
person who armed it, which is the exact leak `fdb2f32` closed.

*One more thing that file is.* `watch-inbox.json` lives under the backend's
`data/` (0700 dir, 0600 file) and holds labels, watch ids, session ids and
timestamps — no observed content, but the label is the user's own sentence. That
directory is covered by the agent's denylist only when `HANNAH_AGENT_DENY_DIRS`
names it, which the launcher always does and a hand-started agent does not: the
same residual as M5.0.2, now with one more file behind it.

*Trigger.* A second backend host, or a second HUD host, or `sense.v1` growing an
inbox route for another reason.

### 21
**P5.1 shipped without ADR-0013 and without the SECURITY rows it promised.**
`VIGILANCE.md` §14 lists ADR-0013 (the watch as a sensor sidecar: placement, the
observe/act split, why not a task and why not a backend loop) and four new threat
rows T9–T12 with `sense.*` risk tiering in SECURITY §4. Neither is written.

*Why it matters more than the usual doc debt.* The reasoning is currently spread
across commit messages, module headers and this roadmap. The `sense.*` tiering in
particular is a decision with teeth — the plan requires `sense.screen` and
`sense.remote` to be `high` **by name**, so that no unknown key can fall through
to `low`, which is the tier a spoken "sí" can grant (the same shape M3.3 closed
for MCP). The code has no `sense.*` permission key yet because nothing asks for
one; the day something does, the table has to already say `high`.

*Approach.* ADR-0013 from the material in ROADMAP Phase 5 and the sidecar's
module headers. SECURITY §3 gains T9–T12, §4 gains the split rows, §6 gains the
"evidence frames are never persisted" asset class.

*Partly paid, 2026-08-27.* The wire contract half is written: INTEGRATION **§4.5**
now carries the four `watch_*` message types with their payloads and delivery
rules, `WATCH_DISARM`, the attach snapshot in order, and the three
`/api/v1/watches` routes with the reason their guard is stricter than the rest of
the backend. That was the piece a second HUD or a second backend could not have
been written without, and it had been in no gap at all. ADR-0013 and the SECURITY
rows are still owed.

*Trigger.* Before P5.2 touches the façade contract — that milestone amends
INTEGRATION §2/§3 anyway, and one doc pass is cheaper than two.

### 22
**A watched path is still classified by name, and a name is not a file.** This is
the residual of a real bug, so the bug comes first: until backend `5a175ae` the
denylist ran **once**, at `POST /v1/watches`, and the sensor then reopened the
path every period with `stat()`/`open()`, both of which follow symlinks. Two
shapes were reproduced live and both ended with a sensor reading a `.env` — a
*dangling* symlink (which `Path.resolve()` walks to the nearest existing ancestor,
so it resolves to itself and passes under its own innocent basename, then follows
its target the moment the target appears), and a real file *replaced* by a symlink
afterwards, which is the shape of an ordinary log rotation. The sensor now keeps
the raw path and goes through `open_watched()`: classify again now, `open` with
`O_NOFOLLOW` and `O_NONBLOCK`, then classify the name the kernel gives the
descriptor before reading a byte.

*What is left, stated in that function's docstring so nobody concludes again that
nothing is left.* The classify→open window still exists — what changed is that
nothing is read inside it, so losing the race raises a `SensorFault` instead of
producing a read. `/proc` is required to learn what was actually opened; without
it the sensor fails closed. And **a hardlink is invisible**: the denylist is by
name, and a hardlink gives one inode a second, innocent name.

*Why it is here and not in the sidecar's own list.* The hardlink hole is the
agent's whole path model — `policy/paths.ts` decides on strings — and it is the
same hole for `read`, for `bash` and for a watch. What the watch adds is
*duration*: the agent classifies milliseconds before a single read, and the
sidecar turns that into a scheduled, repeated read for hours, which is why the
sample-time classification was worth doing even though it does not close this.

*Approach.* Deny by inode as well as by name — stat the denied set at load and
compare `st_dev`/`st_ino` after `open` — or accept it explicitly, which is
defensible for a single-user machine where the attacker who can make the hardlink
can also read the file.

*Trigger.* The day the policy model stops being a list of path rules, or the
first time a watch is armed on something a second user can link.

### 23
**The backend ignores the `boot=` id the sidecar now sends.**
`senseClient.subscribe()` keeps `lastId` for the life of the backend process and
re-sends it as `Last-Event-ID` on every reconnect; the SSE comments — `sense.v1 connected`
and `sense.resume from=… replayed=… truncated=… boot=…` — are parsed out and
discarded, so the backend cannot tell a clean resume from a sidecar that
restarted underneath it.

*Why it is not urgent.* The half that was dangerous is fixed: `since()` used to
answer `truncated=false` to a cursor ahead of the ring and then filter everything
behind it, so a `Last-Event-ID` of 500 against a freshly restarted sidecar meant
an open connection, `onStatus` saying `up`, and nothing but keep-alives — deaf
while reporting healthy, which is the exact failure the blindness contract exists
to catch. Backend `1a231ff` makes an impossible cursor behave like a new
connection (whole ring, `truncated=true`) and takes the watermark from the ring
instead of the client. So the sidecar now fails safe on its own, and a restarted
sidecar returns its watches as `suspended` and emits nothing for them until
somebody re-arms (assumption A4: re-arming is not consent).

*What is still wrong-shaped.* The bridge dedupes by `(watchId, seq)` and `seq`
restarts at 1 with each sidecar boot, while the bridge's `w.seq` is per backend
process. Today no event can hit that, because a watch that survived a restart is
`suspended` and silent; the day a `watchId` is reused across a boot — a resumed
watch, a re-arm that keeps the id — its first events would be dropped as
duplicates, silently. Reading `boot=` and resetting `lastId` and every `w.seq`
when it changes is the fix, and it is small.

*Trigger.* Before anything lets a `watchId` outlive a sidecar restart, which is
P5.2's re-arm or P5.4's standing grants, whichever lands first.
