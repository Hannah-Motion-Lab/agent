# Integration Contract — hannah-backend ⇄ hannah-agent

> Status: **v0 implemented on the agent side** (M1.3, 2026-08-19). The routes,
> the event vocabulary, SSE resume, approval timeouts, the 409 guard, bearer
> auth and the audit log are live in `packages/agent/src/hannah/facade/`; the
> backend side is P2. Any change from here requires an ADR.
> Transport decision: ADR-0005. Façade design: ADR-0006.
>
> Canonical event streams for backend tests: [`docs/fixtures/`](fixtures/) —
> generated from the real façade, not hand-written
> (`HANNAH_WRITE_FIXTURES=1 bun test test/hannah/fixtures.test.ts`).

## 1. Topology & lifecycle

- hannah-agent runs as a **local sidecar**: `hannah-agent serve`, bound to
  `127.0.0.1:8006` (next free slot in the backend's sidecar port scheme).
- The backend reaches it via `AGENT_SIDECAR_URL` (default `http://127.0.0.1:8006`),
  feature-flagged by `AGENT_ENABLED=false` by default — identical pattern to
  `MOTION_SIDECAR_URL`/`config.motion.enabled`.
- Process management is external (dev: a terminal / `npm run sidecar:agent`
  script in the backend; later: systemd user unit — ROADMAP M4.5). The backend
  never spawns it.
- **Auth**: the façade requires a bearer token when `HANNAH_AGENT_TOKEN` is set;
  the backend passes the same value. Localhost-only binding is the first line of
  defense, the token the second (SECURITY.md §4).
- **Health**: backend polls `GET /hannah/v0/health` on boot and surfaces agent
  availability to the frontend (`agent_available` flag in its session state).

## 2. Façade HTTP API (`/hannah/v0`)

Versioned prefix; breaking changes bump `v0` → `v1`. All bodies JSON.

| Method & path | Purpose |
| --- | --- |
| `GET /hannah/v0/history?limit=` | `{ tasks: [HistoryRow] }` — live tasks plus what the audit log remembers, newest first |
| `GET /hannah/v0/tasks/{id}/trail?limit=` | `{ taskId, entries }` — the recorded trail for one task |
| `GET /hannah/v0/health` | `{ healthy, version, engineVersion, activeTasks, workspaces: [{id,path}], trash }` |
| `POST /hannah/v0/tasks` | Create a task. → `202 { taskId }` |
| `GET /hannah/v0/tasks` | List recent tasks (id, title, state, timestamps). |
| `GET /hannah/v0/tasks/:id` | Full status incl. last progress summary + stats. |
| `GET /hannah/v0/events` | **SSE stream** of all task events (global, single connection; `Last-Event-ID` resume). |
| `POST /hannah/v0/tasks/:id/approvals/:approvalId` | `{ decision: "allow" \| "deny", by: "voice" \| "hud" \| "timeout" }` |
| `POST /hannah/v0/tasks/:id/answer` | `{ questionId, answer }` — reply to a `task.question`. |
| `POST /hannah/v0/tasks/:id/cancel` | `{ reason?: "user" \| "shutdown" }` Graceful stop. |

### Create-task request

```jsonc
{
  "prompt": "Organize ~/Downloads into folders by file type",  // required — imperative, English
  "title": "ordenar descargas",       // short label for HUD/history (persona's words)
  "cwd": "/home/user/Downloads",      // optional; must fall inside an allowed workspace root
  "mode": "companion",                // permission preset: companion | trusted-project | paranoid (ADR-0010)
  "timeboxMs": 600000,                // hard cap; task.failed with reason "timebox" when exceeded
  "context": {                        // optional, persona-provided color
    "conversationSummary": "user is cleaning up before a stream",
    "language": "es"                  // language for user-facing strings in events
  }
}
```

Concurrency (M3.4): **one lane plus a bounded queue.** A second `POST` while one
is running is accepted with `202 { taskId, queued: true, position }` and starts
when the lane frees; `409 { activeTaskId }` now means *the queue is full*
(`MAX_QUEUED`, 3), which is a real refusal rather than "not right now".

One lane rather than N is deliberate: concurrency would multiply the two things
that are genuinely hard here — approvals arriving from two places at once, and a
narrator with two stories to tell. A queue lifts the 409 without buying either.

`task.accepted` carries `queued: true` and `position` for a waiting task, and
nothing for one that started. `task.started` is the signal that a queued task
actually began — and the backend narrates it, because for a queued task
*starting* is news. `GET /tasks/{id}` carries the live `queuePosition`, since
the queue shifts underneath.

`narration: "full" | "final"` on create is "avísame solo cuando termines". It
rides on the task and echoes in `task.accepted`; the backend applies it. The HUD
always shows everything. Approvals and questions are **never** silenced by it —
an unheard approval times out into a deny and the task dies without the user
knowing why.

Superseded: the pre-M3.4 rule was one foreground task and a 409 for the second.

### Task states

`accepted → running → (awaiting_approval | awaiting_answer)* → completed | failed | cancelled`

## 3. Event vocabulary (`hannah.v0`)

SSE envelope — one JSON object per event:

```jsonc
{ "v": "hannah.v0", "taskId": "t_01J...", "seq": 17, "ts": 1765700000000,
  "type": "task.progress", "data": { ... } }
```

`seq` is per-task and monotonic; the backend uses it for dedupe/resume.

> Implementation notes (fixed by the M0.1 audit, 2026-08-18): the engine's own
> SSE stream is live-only — no `Last-Event-ID` support exists there — so the
> façade assigns `seq` and keeps a per-task ring buffer to serve resume itself.
> Likewise the engine has **no timeout on permission/question asks**; the
> `timeoutMs` → deny rule below is enforced by the façade, which replies
> `reject` to the engine when the clock runs out.

| `type` | `data` | Narrate? |
| --- | --- | --- |
| `task.accepted` | `{ title, mode, cwd }` | yes — "voy con eso" |
| `task.started` | `{ model }` | no |
| `task.plan` | `{ summary, steps[] }` (when the engine plans first) | yes — one sentence |
| `task.progress` | `{ summary, detail?, answer? }` — human sentence, **≤120 chars**, throttled ≥5 s per task | selectively (see §6) |
| `task.tool` | `{ tool, status: "started"\|"done"\|"failed", target?, summary }` | no (HUD only) |
| `task.approval.requested` | `{ approvalId, kind: "shell"\|"edit"\|"delete"\|"network"\|"other", summary, command?, paths?, risk: "low"\|"medium"\|"high", timeoutMs }` | **always** |
| `task.approval.resolved` | `{ approvalId, decision, by }` | only if denied by timeout |
| `task.question` | `{ questionId, text, options? }` | **always** |
| `task.answered` | `{ questionId }` | no |
| `task.output` | `{ text, summary }` — the agent's prose in full (≤4000 chars) | never on its own (see below) |
| `task.completed` | `{ summary, answer?, stats: { durationMs, toolCalls, filesTouched, tokensIn, tokensOut, costUsd? } }` | **always** |
| `task.failed` | `{ summary, error, recoverable }` | **always** |
| `task.cancelled` | `{ reason }` | yes, briefly |

Rules for event authors (façade translator, P1):

- `summary` fields are **plain, speakable sentences in the task's `language`** —
  no paths unless essential, no jargon, no markdown.
- The façade *translates* engine-bus events into this vocabulary; it never leaks
  raw engine event names across the seam.
- Everything is HUD-renderable; only the "Narrate? = yes" rows are candidates
  for speech.

### Implementation notes (M1.3)

Four behaviors are the façade's alone, because the engine does not provide them
(M0.1 audit §3, §4):

- **`seq` and resume.** The store assigns a per-task `seq` (what the backend
  dedupes on) *and* a global cursor used as the SSE `id:`. Two counters, because
  resume needs one ordering across all tasks while the backend reasons per task.
  On reconnect the façade replays from its ring buffer and, when the buffer had
  already dropped part of the gap, says so in a `: hannah.resume … truncated=true`
  comment rather than pretending the replay was complete.
- **Approval and question timeouts.** The engine blocks forever on an
  unanswered ask. The façade times out (`timeoutMs`, default 120 s), replies
  `reject` to the engine, and emits `task.approval.resolved` with `by: "timeout"`.
  Silence means no.
- **The timebox.** A task that exceeds `timeboxMs` is failed with
  `error: "timebox"` and the engine run is interrupted.
- **Ordering on cancel.** State flips to `cancelled`/`failed` *before* the
  engine interrupt is awaited. Interrupting makes the in-flight prompt settle,
  and if that settles first the run loop would report `task.completed` for a
  task the user just cancelled — the one bug in this area that would be actively
  dishonest to the user.

`high`-risk approvals are refused with `409` when granted `by: "voice"`
(SECURITY T7): the HUD button is the second factor. Denying by voice is always
accepted — only *granting* needs confirmation.

### 2.1 History (M3.5)

History is **derived from the audit log**, not stored separately. The log already
records every task's whole life, is append-only, and already has a retention
policy; a second store would be a second source of truth, and the disagreement
would surface as Hannah describing a task the log says never happened.

A row carries what the task was, how it ended, and — the interesting part — how
many approvals it asked for and how many were granted. Live tasks win over
recorded ones on overlap: same task, further along.

Retention is enforced **at startup**, not by a command, because a policy nobody
remembers to run is not a policy. Rotation is by day, so trimming deletes whole
files: a log you have to rewrite to trim is a log you can corrupt while
trimming. `scripts/audit-purge.ts` exists for trimming harder than the
configured window without a restart, and for seeing what would go first.

### 3.0 Where a task runs (M3.1)

`task.accepted` carries `workspace` alongside `cwd` — the id of the root the
directory belongs to, if any, so the HUD can show "downloads" instead of a path
and the audit log records *why* that directory was chosen.

The agent resolves the directory itself: an explicit `cwd`, then a real path in
the prompt, then a root named in the prompt (accent- and case-insensitive, both
languages), then the fallback. The backend may still send `cwd` and it wins, but
it no longer has to guess.

`health.workspaces` is the list the backend puts in the persona's system prompt.
It contains only directories that exist on this machine, because a persona that
offers to tidy a folder nobody can open is worse than one that offers nothing.
`health.trash` names the reversible-delete tool, or `null`.

**Roots are ergonomics, not a boundary** — D3 made the workspace root `/`
(SECURITY §4, §5).

### 3.1 The answer path (M3.0)

Most tasks are a side effect — "I moved 23 files" — and a 120-character summary
says everything there is to say. Some tasks *are* their output: a status report,
a search, "find the file that…". For those, the summary is not a description of
the result, it is a truncation of it.

So assistant prose longer than 120 characters (or containing a line break) is
emitted **twice**: once shortened as `task.progress`, carrying `answer: true`,
and once whole as `task.output`. The last such text also rides on
`task.completed` as `answer`, and appears in `GET /tasks/{id}` so it survives a
reconcile.

`answer: true` on a progress line means **do not speak this one** — the full
text is one event behind. Saying half an answer aloud and then saying the answer
is worse than either alone, and only the façade knows what is coming next.

Delivery splits the way the rest of this seam already splits: **the HUD gets the
full text, the voice gets the gist.** The backend hands the persona up to 1200
characters of the answer with an instruction to deliver it in at most two
sentences and mention that the detail is on screen. Reading a twenty-line list
out loud is worse than not answering.

Related: `context.language` is now read rather than merely stored — a non-English
task appends an instruction that the agent address the user in that language,
while leaving commands, code, paths and tool arguments untouched. Before this,
the agent always answered in English and the persona had to translate on the
fly, which loses detail and sounds like it.

## 4. Backend responsibilities (P2 — spec for `hannah-backend`)

### 4.1 Dispatch — the `[TASK:]` protocol

Extend the fixed tag protocol in `backend/src/config.js` (alongside `[MOTION:]` /
`[EMOTION:]`):

- The persona LLM may emit at most one `[TASK: imperative description]` per
  response, only when the user asked for something actionable on the computer.
- The orchestrator (`processAndSendSegment`) strips the tag from
  subtitle/TTS/motion exactly like `[MOTION:]`, and hands the description to
  `agent.js` → `POST /hannah/v0/tasks` (persona also supplies `title` and
  `context.language`).
- If `AGENT_ENABLED=false` or health-check failed, the protocol instructs the
  persona to say it can't do that right now — the tag path must degrade to
  conversation, not error.

### 4.2 New WebSocket message types (backend → frontend)

> Implemented in `backend/src/gateway/agentBridge.js` (M2.3, 2026-08-21).

| WS `type` | Source event | Frontend behavior |
| --- | --- | --- |
| `agent_task_started` | `task.accepted` | HUD task panel appears |
| `agent_task_progress` | `task.started` / `plan` / `progress` / `tool` / `output` / `approval.resolved` / `answered` | update panel timeline |
| `agent_approval_request` | `task.approval.requested` | modal buttons in HUD **and** avatar asks aloud |
| `agent_question` | `task.question` | same pattern as approvals |
| `agent_task_done` | `task.completed` / `failed` / `cancelled` | final state + stats in panel |

Every `agent_task_progress` carries a `kind` naming which event produced it, so
the panel can render a plan differently from a shell command without the
frontend learning engine vocabulary. `task.approval.resolved` and
`task.answered` are folded in here rather than getting types of their own: for
the HUD they *are* timeline entries, and the pending modal closes on them —
including when the resolver was voice or the 120 s timeout rather than a click.

`agent_approval_request` and `agent_question` add an `expiresAt` (absolute ms,
derived from `timeoutMs` on arrival) so the HUD can show the countdown. Silence
means "no", and a button with no clock on it hides that.

Frontend → backend: `AGENT_APPROVAL { taskId, approvalId, decision }`,
`AGENT_ANSWER { taskId, questionId, answer }`, `AGENT_CANCEL { taskId }` (HUD
buttons), which the backend forwards to the façade with `by: "hud"` — the
attribution that lets a `high`-risk approval be granted at all (SECURITY T7) —
plus `AGENT_NARRATION { taskId, narration }`, which is backend-local: the agent
does not narrate, so there is nothing to tell it.

**Error path — `agent_command_failed { command, taskId, reason, … }`.** Success
is never acked: the modal closes when `task.approval.resolved` comes back from
the façade, which is the only thing that actually knows whether the action was
granted. Failure has no such event, so an expired approval or a dead sidecar
would leave the modal waiting forever. This message exists to make that
impossible.

**One subscription per process, not per connection.** The façade's event stream
is global, so N WebSocket clients must not open N streams competing over the
same `Last-Event-ID` cursor. The bridge owns one subscription, keeps a bounded
timeline per task, and replays it to a client that connects mid-task — which is
also what makes a task survive a browser reload. If an event arrives for a task
the bridge has never seen (backend restarted while a task was running), it
reconciles from `GET /tasks/{id}` instead of rendering a half-built panel.

### 4.3 Voice approvals

> Implemented in `backend/src/gateway/agentBridge.js` → `routeUtterance()`,
> with the classifier in `backend/src/pipeline/llm.js` (M2.4, 2026-08-21).

While a `task.approval.requested` or `task.question` is pending, the backend
routes the next user utterance through an intent check (persona LLM with the
pending question as context): affirmative → `allow` / the answer;
negative → `deny`; unrelated → treat as normal conversation and leave the
approval pending until `timeoutMs` (default 120 s → deny, spoken notice).
Approvals are never inferred from anything except an utterance that arrived
*after* the question was asked (SECURITY.md §5, voice-spoofing note).

Three implementation rules the code enforces rather than trusts:

- **"After" means the utterance *started* after the question, not that its
  transcript arrived after.** The gateway stamps `SPEECH_START`; an utterance
  that began before the approval appeared is never treated as an answer to it,
  because the user could not have been answering something they had not yet
  been asked. Without that clock the ordinary case of talking over the question
  silently grants it.
- **A lexical shortcut decides the unambiguous cases before the model does.**
  "sí" / "no" / "para" never pay model latency, and a dead classifier cannot
  leave Hannah deaf to a plain yes. Everything else goes to a one-word
  classification whose *only* accepted outputs are `ALLOW`/`DENY`/`CANCEL`/
  `ANSWER`; anything else — including a classifier error — becomes `unrelated`.
- **Ambiguity never grants.** `unrelated` leaves the approval pending, and a
  pending approval expires into deny. The safe outcome is the default outcome,
  not a special case.

A `high`-risk approval granted by voice is refused by the façade with 409
`hud_confirmation_required` (T7). The backend turns that into a spoken sentence
pointing at the HUD button plus an `agent_command_failed`, so the user learns
*why* their "sí" did not work instead of repeating it at a silent avatar.

### 4.4 Narration & injection

> Implemented in `backend/src/gateway/agentBridge.js` (M2.4, 2026-08-21).

The backend narrates via the **existing** system-injection path
(`processTextTurn`) so narration gets persona voice, emotion tags, and gestures
for free. Input to the persona: the event's `summary` plus instruction to relay
it in ≤1 sentence. Narration events must never enter the durable conversation
history as user turns (same rule as YOLO alerts).

`processTextTurn` is **injected** into the bridge at composition
(`websocket.js`), not imported by it — the orchestrator already imports the
bridge to route utterances, and an ES module cycle there would be fragile. The
injection also makes narration testable with a spy instead of a model.

Every narration instruction ends with an explicit *do not invent* clause. The
persona is being told what happened, not asked what she thinks happened; the
event stream is the only thing that knows the truth about a task.

## 5. Interruption semantics (barge-in vs cancel)

> Implemented (M2.4, 2026-08-21): barge-in in `gateway/websocket.js` aborts the
> turn only; cancellation is `routeUtterance`'s stop-intent path or the HUD
> button; `agentBridge.shutdown()` is wired to SIGINT/SIGTERM in `server.js`.

Existing backend barge-in (user speaks → abort TTS/LLM stream) **must not**
cancel the running task:

- Barge-in aborts *narration only*. The task continues; its next events queue
  for narration per §6.
- Cancellation is *explicit*: a stop-intent utterance ("para", "cancela",
  "déjalo") or the HUD button → `POST /tasks/:id/cancel`.
- On backend shutdown/restart: send `cancel { reason: "shutdown" }` for the
  active task; on reconnect of SSE, resume with `Last-Event-ID` and reconcile
  via `GET /tasks/:id`.
- On backend **start**, adopt whatever `GET /tasks` reports still running
  (M2.5): a backend restarted mid-task would otherwise show nothing until the
  next event, and a silent task is indistinguishable from one that never
  existed. Adoption is not narrated — the user was already told.
- If the stream stays down past `AGENT_LOST_CONTACT_MS` (default 15 s) with a
  live task, the backend closes it as **lost, not finished** — `task done` with
  `error: "lost_contact"` plus a spoken line saying it does not know whether the
  task completed. Only a task the backend closed *itself* can be reopened, so a
  later reconcile can correct the story in either direction; a task the agent no
  longer knows about keeps the honest "I don't know".

## 6. Narration budget

> Implemented (M2.4, 2026-08-21): `AGENT_NARRATE_PROGRESS_MS` (default 20 s).

To keep Hannah pleasant instead of chatty:

- Always speak: acceptance, approvals, questions, completion, failure. These
  survive `narration: "final"` too — a silenced approval times out into a deny
  and the task dies without the user knowing why.
- `task.progress`: speak at most one per **20 s** per task, and only when the
  user isn't mid-conversation; everything still shows in the HUD.
- If several narratable events queue while the user is talking, collapse to the
  most recent meaningful one ("ya terminé, por cierto").

## 7. Sequence diagrams

### Happy path with one approval

```mermaid
sequenceDiagram
    participant U as User (voice)
    participant B as Backend (persona)
    participant A as Agent façade
    U->>B: "ordena mis descargas"
    B->>U: "¡voy!  [TASK emitted]" (TTS)
    B->>A: POST /hannah/v0/tasks
    A-->>B: 202 taskId · SSE: task.accepted, task.plan
    B->>U: narrates plan (1 sentence)
    A-->>B: task.approval.requested (move 34 files, risk: medium)
    B->>U: "¿Muevo 34 archivos a 4 carpetas?"
    U->>B: "sí, dale"
    B->>A: POST .../approvals/:id {allow, by: voice}
    A-->>B: task.progress ... task.completed
    B->>U: "Listo — 34 archivos ordenados."
```

### Barge-in during narration (task unaffected)

```mermaid
sequenceDiagram
    participant U as User
    participant B as Backend
    participant A as Agent
    A-->>B: task.progress "instalando dependencias"
    B->>U: "estoy instal—" (TTS)
    U->>B: (speaks) → barge-in: TTS+persona stream aborted
    Note over B,A: task keeps running — no cancel sent
    U->>B: "¿qué hora es?" → normal conversation
    A-->>B: task.completed (queued for narration)
    B->>U: answers, then: "por cierto, ya terminé lo tuyo"
```

## 8. Contract tests (P1/P2 deliverables)

- Agent side (P1) — **done**: `packages/agent/test/hannah/facade.test.ts`
  drives the façade over real `Request`/`Response` objects: create, approve,
  deny, approval timeout, question round-trip and timeout, cancel, timebox,
  engine crash, 409 on concurrent create, token auth on/off, SSE resume after
  disconnect, redaction, audit contents. The engine is faked there so the
  contract runs with no model; `engine-adapter.test.ts` covers the real-engine
  binding separately, and `fixtures.test.ts` regenerates `docs/fixtures/`.
- Backend side (P2): mock façade server (recorded SSE fixtures) so backend unit
  tests run with no engine — keeps backend's "works with sidecar down" rule.
- A `docs/fixtures/` set of canonical event streams (JSONL) shared by both.
