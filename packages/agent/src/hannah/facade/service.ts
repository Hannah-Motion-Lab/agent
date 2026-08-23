export * as Facade from "./service"

import { Policy } from "../policy"
import { Macros } from "../macros"
import { PolicyCommands } from "../policy/commands"
import { PolicyPresets } from "../policy/presets"
import { PolicyWorkspaces } from "../policy/workspaces"
import { PolicyRedact } from "../policy/redact"
import { Audit } from "./audit"
import { Protocol } from "./protocol"
import { Store } from "./store"
import { Translate } from "./translate"

/**
 * The task orchestrator behind `/hannah/v0`.
 *
 * It owns the three things the engine does not provide (M0.1 audit §3, §4):
 * the per-task `seq` and resume buffer, the **timeout on approvals** (the
 * engine blocks forever), and the **timebox** on a whole task. It also owns
 * the vocabulary translation, so engine internals never reach the backend.
 *
 * The engine itself is reached through `EnginePort` — a five-method seam that
 * keeps this logic testable without a model, an API key, or a socket.
 */

export type EngineEvent = Translate.EngineEvent

export type PermissionAsk = {
  readonly id: string
  readonly sessionId: string
  readonly permission: string
  readonly patterns: readonly string[]
  readonly metadata: Record<string, unknown>
}

export type QuestionAsk = {
  readonly id: string
  readonly sessionId: string
  readonly questions: ReadonlyArray<{ question: string; header?: string; options?: ReadonlyArray<{ label: string }> }>
}

export type EnginePort = {
  /** Create a session with the preset's ruleset already attached. */
  createSession(input: { title: string; cwd: string; preset: Protocol.Preset }): Promise<{ sessionId: string }>
  /** Run the prompt. Resolves when the run finishes; rejects on engine error. */
  prompt(input: { sessionId: string; prompt: string }): Promise<void>
  /** Interrupt the in-flight run. Safe to call when idle. */
  cancel(sessionId: string): Promise<void>
  /** `sessionId` lets the adapter reply inside the instance that asked. */
  replyPermission(id: string, reply: "once" | "always" | "reject", sessionId?: string): Promise<void>
  replyQuestion(id: string, answers: string[][], sessionId?: string): Promise<void>
  rejectQuestion(id: string, sessionId?: string): Promise<void>
  /** Engine event bus. Returns an unsubscribe function. */
  subscribe(listener: (event: EngineEvent) => void): () => void
  /** Permission/question asks, surfaced separately so the façade can own ids. */
  onPermission(listener: (ask: PermissionAsk) => void): () => void
  onQuestion(listener: (ask: QuestionAsk) => void): () => void
  version(): string
}

export type Options = {
  audit?: Audit.Sink
  approvalTimeoutMs?: number
  defaultCwd?: string
  /** Days of audit log to keep. Enforced on startup — see `Audit.purge`. */
  retentionDays?: number
  /**
   * Where a task should run. Injectable because the real resolver reads the
   * machine's filesystem, which would make the canonical fixtures depend on who
   * generated them — they exist to pin the wire vocabulary, not the disk.
   */
  resolveCwd?: (input: { cwd?: string; prompt?: string; fallback: string }) => PolicyWorkspaces.Resolution
  /** Same reason as `resolveCwd`: availability depends on the machine's PATH. */
  resolveMacro?: (input: { macro?: string; prompt?: string }) => Macros.Macro | undefined
  now?: () => number
  /** Injectable for tests; defaults to real timers. */
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export class TaskService {
  readonly store: Store.TaskStore
  #engine: EnginePort
  #audit: Audit.Sink
  #options: Options
  #timers = new Map<string, unknown>()
  #unsubscribe: Array<() => void> = []
  /** taskId of the run currently owning the engine session. */
  #sessionToTask = new Map<string, string>()

  constructor(engine: EnginePort, options: Options = {}) {
    this.#engine = engine
    this.#options = options
    this.#audit = options.audit ?? Audit.nullSink()
    this.store = new Store.TaskStore({ now: options.now })

    // Retention runs at startup, not on a command: a policy nobody remembers to
    // run is not a policy. Whole day-files, so trimming cannot corrupt one.
    if (options.retentionDays) {
      const dropped = this.purge(options.retentionDays)
      if (dropped) this.#audit.write({ event: "audit.purged", files: dropped, days: options.retentionDays })
    }

    this.#unsubscribe.push(engine.subscribe((event) => this.#onEngineEvent(event)))
    this.#unsubscribe.push(engine.onPermission((ask) => this.#onPermission(ask)))
    this.#unsubscribe.push(engine.onQuestion((ask) => this.#onQuestion(ask)))
  }

  dispose() {
    for (const off of this.#unsubscribe) off()
    this.#unsubscribe = []
    for (const handle of this.#timers.values()) this.#clear(handle)
    this.#timers.clear()
  }

  #now() {
    return this.#options.now?.() ?? Date.now()
  }

  #timer(fn: () => void, ms: number) {
    return (this.#options.setTimeout ?? ((f: () => void, m: number) => setTimeout(f, m)))(fn, ms)
  }

  #clear(handle: unknown) {
    ;(this.#options.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>)))(handle)
  }

  #emit(taskId: string, type: Protocol.EventType, data: Record<string, unknown>) {
    const safe = PolicyRedact.value(data)
    this.#audit.write({ taskId, event: type, data: safe })
    return this.store.publish(taskId, type, safe)
  }

  // ── task lifecycle ──────────────────────────────────────────────────────

  /**
   * Create a task. It starts immediately if the lane is free, otherwise it
   * **queues** (M3.4).
   *
   * One lane, not N: concurrency here would multiply the two things that are
   * genuinely hard — approvals arriving from two places at once, and a narrator
   * with two stories to tell. A queue lifts the 409 without buying either.
   * The 409 survives only for a full queue, which is a real refusal rather than
   * "not right now".
   */
  async create(input: Protocol.CreateTaskInput): Promise<{ ok: true; task: Store.Task; position?: number } | { ok: false; activeTaskId: string }> {
    const active = this.store.active()
    const waiting = this.store.queued()
    if (active && waiting.length >= Protocol.MAX_QUEUED) return { ok: false, activeTaskId: active.id }

    // Until M3.1 every task inherited `process.cwd()`, so "ordena mis descargas"
    // ran wherever the sidecar was launched from. The prompt usually says where
    // it means; the resolver reads it (SECURITY: a root grants nothing — the
    // denylist still decides what may be touched).
    const resolve = this.#options.resolveCwd ?? PolicyWorkspaces.resolveCwd
    const where = resolve({
      cwd: input.cwd,
      prompt: input.prompt,
      fallback: this.#options.defaultCwd ?? process.cwd(),
    })

    // A macro is a named recurring job with a skill behind it. Resolving it here
    // rather than in the backend keeps one catalog: the agent is the only thing
    // that knows which macros this machine can actually run.
    const resolveMacro = this.#options.resolveMacro ?? Macros.resolve
    const macro = resolveMacro({ macro: input.macro, prompt: input.prompt })

    const task = this.store.create({
      id: Protocol.taskId(this.#now()),
      prompt: input.prompt,
      title: input.title,
      macro: macro?.id,
      narration: input.narration ?? "full",
      queued: Boolean(active),
      cwd: where.cwd,
      mode: input.mode ?? "companion",
      timeboxMs: input.timeboxMs ?? Protocol.DEFAULT_TIMEBOX_MS,
      language: input.context?.language ?? "en",
    })
    const position = active ? waiting.length + 1 : undefined

    this.#audit.write({
      taskId: task.id,
      event: "task.created",
      title: task.title,
      cwd: task.cwd,
      // Why this directory, so a surprising choice is explainable afterwards.
      cwdReason: where.reason,
      workspace: where.workspace?.id,
      macro: macro?.id,
      mode: task.mode,
      timeboxMs: task.timeboxMs,
      narration: task.narration,
      queuedBehind: active?.id,
    })

    this.#emit(task.id, "task.accepted", {
      title: task.title,
      mode: task.mode,
      cwd: task.cwd,
      workspace: where.workspace?.id,
      macro: macro?.id,
      narration: task.narration,
      ...(task.queued ? { queued: true, position } : {}),
    })

    // The run is deliberately not awaited: create returns 202 immediately and
    // the backend follows the task on the event stream. A queued task starts
    // when the lane frees, and `task.started` is the signal that it did.
    if (!task.queued) void this.#run(task)
    return { ok: true, task, position }
  }

  /**
   * Hand the lane to whoever is next.
   *
   * Called from every path that ends a task — completion, failure, cancel,
   * timebox. Missing one would strand the queue silently, which is the failure
   * this whole milestone is supposed to avoid: a task the user was told about
   * that never runs.
   */
  #promote() {
    if (this.store.active()) return
    const [next] = this.store.queued()
    if (!next) return
    next.queued = false
    void this.#run(next)
  }

  async #run(task: Store.Task) {
    const timebox = this.#timer(() => void this.#onTimebox(task.id), task.timeboxMs)
    this.#timers.set(`timebox:${task.id}`, timebox)

    try {
      const { sessionId } = await this.#engine.createSession({
        title: task.title,
        cwd: task.cwd,
        preset: task.mode,
      })
      task.sessionId = sessionId
      this.#sessionToTask.set(sessionId, task.id)

      this.store.transition(task.id, "running")
      this.#emit(task.id, "task.started", { model: "" })

      await this.#engine.prompt({ sessionId, prompt: promptFor(task) })

      // The engine may already have ended the task (error event, cancel).
      const current = this.store.get(task.id)
      if (current && !Protocol.TERMINAL_STATES.has(current.state)) {
        this.store.transition(task.id, "completed")
        this.#emit(task.id, "task.completed", {
          summary: current.lastProgress ?? "done",
          // The last substantive thing the agent wrote. The backend speaks the
          // summary and shows this; without it a task whose result is an answer
          // arrives as a 120-character stub.
          answer: current.answer,
          stats: current.stats,
        })
      }
    } catch (error) {
      const current = this.store.get(task.id)
      if (current && !Protocol.TERMINAL_STATES.has(current.state)) {
        const message = error instanceof Error ? error.message : String(error)
        current.error = message
        this.store.transition(task.id, "failed")
        this.#emit(task.id, "task.failed", {
          summary: "the task failed",
          error: message,
          recoverable: true,
        })
      }
    } finally {
      this.#finish(task.id)
    }
  }

  #finish(taskId: string) {
    const timebox = this.#timers.get(`timebox:${taskId}`)
    if (timebox !== undefined) {
      this.#clear(timebox)
      this.#timers.delete(`timebox:${taskId}`)
    }
    const task = this.store.get(taskId)
    if (task?.sessionId) this.#sessionToTask.delete(task.sessionId)
    this.#audit.write({ taskId, event: "task.finished", state: task?.state })
    this.#promote()
  }

  async #onTimebox(taskId: string) {
    const task = this.store.get(taskId)
    if (!task || Protocol.TERMINAL_STATES.has(task.state)) return
    this.#audit.write({ taskId, event: "task.timebox", timeboxMs: task.timeboxMs })
    // Flip the state *before* awaiting the engine. Interrupting the run makes
    // the in-flight prompt settle, and if that resolves first the run loop
    // would mark the task "completed" — telling the user it finished when it
    // actually ran out of time.
    this.store.transition(taskId, "failed")
    this.#emit(taskId, "task.failed", {
      summary: "I ran out of time on that one",
      error: "timebox",
      recoverable: true,
    })
    task.error = "timebox"
    this.#promote()
    if (task.sessionId) await this.#engine.cancel(task.sessionId).catch(() => {})
  }

  async cancel(taskId: string, reason = "user") {
    const task = this.store.get(taskId)
    if (!task) return false
    if (Protocol.TERMINAL_STATES.has(task.state)) return false
    // Same ordering rule as the timebox: decide first, then tell the engine.
    // Awaiting the interrupt first lets the settling prompt win the race and
    // report "completed" for a task the user just cancelled.
    this.store.transition(taskId, "cancelled")
    this.#emit(taskId, "task.cancelled", { reason })
    // Promote before awaiting the engine as well as after: if the interrupt
    // never settles, `#finish` never runs and the queue would wait forever on a
    // task that is already over.
    this.#promote()
    if (task.sessionId) await this.#engine.cancel(task.sessionId).catch(() => {})
    return true
  }

  // ── approvals ───────────────────────────────────────────────────────────

  #onPermission(ask: PermissionAsk) {
    const taskId = this.#sessionToTask.get(ask.sessionId)
    if (!taskId) return // an ask from a session we do not own
    const task = this.store.get(taskId)
    if (!task || Protocol.TERMINAL_STATES.has(task.state)) return

    const command = typeof ask.metadata["command"] === "string" ? (ask.metadata["command"] as string) : undefined
    const timeoutMs = this.#options.approvalTimeoutMs ?? Protocol.DEFAULT_APPROVAL_TIMEOUT_MS
    const approval: Store.Approval = {
      id: `a_${ask.id}`,
      taskId,
      engineId: ask.id,
      kind: Translate.approvalKind(ask.permission, command),
      risk: PolicyPresets.risk(ask.permission, ask.patterns, ask.metadata),
      summary: Translate.approvalSummary(ask.permission, ask.patterns, ask.metadata),
      command,
      paths: ask.permission === "edit" ? [...ask.patterns] : undefined,
      timeoutMs,
      askedAt: this.#now(),
    }
    task.approvals.set(approval.id, approval)
    this.store.transition(taskId, "awaiting_approval")

    this.#emit(taskId, "task.approval.requested", {
      approvalId: approval.id,
      kind: approval.kind,
      summary: approval.summary,
      command: approval.command,
      paths: approval.paths,
      risk: approval.risk,
      timeoutMs,
    })

    // The engine waits forever; the façade is what makes silence mean "no".
    const handle = this.#timer(() => void this.resolveApproval(taskId, approval.id, "deny", "timeout"), timeoutMs)
    this.#timers.set(`approval:${approval.id}`, handle)
  }

  async resolveApproval(taskId: string, approvalId: string, decision: "allow" | "deny", by: "voice" | "hud" | "timeout") {
    const task = this.store.get(taskId)
    const approval = task?.approvals.get(approvalId)
    if (!task || !approval) return false

    const handle = this.#timers.get(`approval:${approvalId}`)
    if (handle !== undefined) {
      this.#clear(handle)
      this.#timers.delete(`approval:${approvalId}`)
    }
    task.approvals.delete(approvalId)

    this.#audit.write({
      taskId,
      event: "approval.resolved",
      approvalId,
      decision,
      by,
      risk: approval.risk,
      summary: approval.summary,
      command: approval.command,
    })

    await this.#engine
      .replyPermission(approval.engineId, decision === "allow" ? "once" : "reject", task.sessionId)
      .catch(() => {})

    this.#emit(taskId, "task.approval.resolved", { approvalId, decision, by })
    if (task.approvals.size === 0 && task.questions.size === 0) this.store.transition(taskId, "running")
    return true
  }

  // ── questions ───────────────────────────────────────────────────────────

  #onQuestion(ask: QuestionAsk) {
    const taskId = this.#sessionToTask.get(ask.sessionId)
    if (!taskId) return
    const task = this.store.get(taskId)
    if (!task || Protocol.TERMINAL_STATES.has(task.state)) return

    const first = ask.questions[0]
    if (!first) return
    const question: Store.Question = {
      id: `q_${ask.id}`,
      taskId,
      engineId: ask.id,
      text: first.question,
      options: first.options?.map((option) => option.label),
      askedAt: this.#now(),
    }
    task.questions.set(question.id, question)
    this.store.transition(taskId, "awaiting_answer")

    this.#emit(taskId, "task.question", {
      questionId: question.id,
      text: question.text,
      options: question.options,
    })

    const timeoutMs = this.#options.approvalTimeoutMs ?? Protocol.DEFAULT_APPROVAL_TIMEOUT_MS
    const handle = this.#timer(() => void this.#timeoutQuestion(taskId, question.id), timeoutMs)
    this.#timers.set(`question:${question.id}`, handle)
  }

  async #timeoutQuestion(taskId: string, questionId: string) {
    const task = this.store.get(taskId)
    const question = task?.questions.get(questionId)
    if (!task || !question) return
    task.questions.delete(questionId)
    this.#timers.delete(`question:${questionId}`)
    this.#audit.write({ taskId, event: "question.timeout", questionId })
    await this.#engine.rejectQuestion(question.engineId, task.sessionId).catch(() => {})
    this.#emit(taskId, "task.answered", { questionId, answered: false })
    if (task.approvals.size === 0 && task.questions.size === 0) this.store.transition(taskId, "running")
  }

  async answer(taskId: string, questionId: string, answer: string) {
    const task = this.store.get(taskId)
    const question = task?.questions.get(questionId)
    if (!task || !question) return false

    const handle = this.#timers.get(`question:${questionId}`)
    if (handle !== undefined) {
      this.#clear(handle)
      this.#timers.delete(`question:${questionId}`)
    }
    task.questions.delete(questionId)

    this.#audit.write({ taskId, event: "question.answered", questionId })
    await this.#engine.replyQuestion(question.engineId, [[answer]], task.sessionId).catch(() => {})
    this.#emit(taskId, "task.answered", { questionId, answered: true })
    if (task.approvals.size === 0 && task.questions.size === 0) this.store.transition(taskId, "running")
    return true
  }

  // ── engine events ───────────────────────────────────────────────────────

  #onEngineEvent(event: EngineEvent) {
    const sessionId = typeof event.properties?.["sessionID"] === "string" ? (event.properties["sessionID"] as string) : undefined
    if (!sessionId) return
    const taskId = this.#sessionToTask.get(sessionId)
    if (!taskId) return
    const task = this.store.get(taskId)
    if (!task || Protocol.TERMINAL_STATES.has(task.state)) return

    if (event.type === "session.next.tool.called") task.stats.toolCalls += 1
    if (event.type === "session.next.tool.success") {
      const paths = event.properties["outputPaths"]
      if (Array.isArray(paths)) task.stats.filesTouched += paths.length
    }

    const translated = Translate.event(event)
    if (!translated) return

    if (translated.type === "task.progress") task.lastProgress = String(translated.data.summary ?? "")


    if (translated.type === "task.failed") {
      task.error = String(translated.data.error ?? "")
      this.store.transition(taskId, "failed")
    }

    // Prose long enough to be an *answer* is emitted twice on purpose: the
    // shortened progress line first (the HUD timeline entry), then the whole
    // thing as `task.output` (what actually gets read). Some tasks ARE their
    // output — a status report, a search result — and truncating those throws
    // away the deliverable.
    const prose =
      event.type === "session.next.text.ended" && typeof event.properties["text"] === "string"
        ? (event.properties["text"] as string)
        : ""
    const isAnswer = Boolean(prose) && Translate.isAnswer(prose)

    // `answer: true` tells the backend not to speak this line. Saying half an
    // answer out loud and then saying the answer is worse than either alone,
    // and only the façade knows the full text is one event behind.
    this.#emit(taskId, translated.type, isAnswer ? { ...translated.data, answer: true } : translated.data)

    if (isAnswer) {
      const output = Translate.event({ type: "hannah.output", properties: { text: prose } })
      if (output) {
        task.answer = String(output.data["text"] ?? "")
        this.#emit(taskId, output.type, output.data)
      }
    }
  }

  // ── read models ─────────────────────────────────────────────────────────

  health() {
    return {
      healthy: true,
      version: Protocol.VERSION,
      engineVersion: this.#engine.version(),
      activeTasks: this.store.active() ? 1 : 0,
      queuedTasks: this.store.queued().length,
      // The persona needs the names to offer them, and must not offer a folder
      // that does not exist on this machine.
      workspaces: PolicyWorkspaces.describe(),
      trash: PolicyCommands.trashTool()?.command ?? null,
      // Only what this machine can run. A macro whose tool is missing is absent
      // here, so the persona never learns it exists and cannot promise it.
      macros: Macros.describe(),
    }
  }

  /**
   * Recent tasks, newest first — the live ones plus what the audit log
   * remembers. In-memory wins on overlap: it is the same task, further along.
   */
  history(limit = 25): Audit.HistoryRow[] {
    const rows = new Map<string, Audit.HistoryRow>()
    const directory = this.#audit.path
    if (directory) for (const row of Audit.history(directory, limit)) rows.set(row.taskId, row)

    for (const task of this.store.list()) {
      rows.set(task.id, {
        taskId: task.id,
        title: task.title,
        state: task.state,
        macro: task.macro,
        cwd: task.cwd,
        startedAt: task.startedAt ?? task.createdAt,
        endedAt: task.endedAt,
        summary: task.lastProgress,
        error: task.error,
        stats: task.stats as unknown as Record<string, unknown>,
        ...(rows.get(task.id)?.approvals ? { approvals: rows.get(task.id)!.approvals } : {}),
      })
    }

    return [...rows.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)).slice(0, limit)
  }

  /** The recorded trail for one task — what it actually did, in order. */
  trail(taskId: string, limit = 500): Audit.Entry[] {
    const directory = this.#audit.path
    return directory ? Audit.trail(directory, taskId, limit) : []
  }

  /** Drop day-files past the retention window. Returns how many went. */
  purge(days: number): number {
    const directory = this.#audit.path
    return directory ? Audit.purge(directory, days).length : 0
  }

  describe(task: Store.Task) {
    return {
      taskId: task.id,
      title: task.title,
      state: task.state,
      mode: task.mode,
      cwd: task.cwd,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
      macro: task.macro,
      narration: task.narration,
      // Live, not the one from `task.accepted`: the queue shifts underneath.
      queuePosition: task.queued ? this.store.queued().indexOf(task) + 1 : undefined,
      lastProgress: task.lastProgress,
      answer: task.answer,
      stats: task.stats,
      error: task.error,
      pendingApprovals: [...task.approvals.values()].map((approval) => ({
        approvalId: approval.id,
        summary: approval.summary,
        risk: approval.risk,
        kind: approval.kind,
      })),
      pendingQuestions: [...task.questions.values()].map((question) => ({
        questionId: question.id,
        text: question.text,
        options: question.options,
      })),
    }
  }
}

/**
 * The prompt actually sent to the engine.
 *
 * `context.language` was stored and never read: the agent answered in English
 * no matter who was asking, and the persona then had to relay an English answer
 * in Spanish — a translation round-trip that loses detail and sounds like it.
 * Tool use and file contents stay untouched; only the prose it writes back is
 * constrained, because that prose is what a person hears.
 */
function promptFor(task: Store.Task) {
  const notes: string[] = []

  const language = (task.language || "en").trim()
  if (language && !language.toLowerCase().startsWith("en")) {
    notes.push(
      `Write every message you address to the user in ${language}. `
        + `Commands, code, file paths and tool arguments stay exactly as they must be.`,
    )
  }

  const workspace = PolicyWorkspaces.match(task.cwd)
  if (workspace) notes.push(`You are working in the user's ${workspace.id} folder (${task.cwd}).`)

  // A pointer, not a paste. The skill body lives in one file the user can read
  // and edit; inlining it here would fork it into the prompt every run.
  if (task.macro) {
    const macro = Macros.byId(task.macro)
    if (macro) notes.push(`This is the "${macro.id}" job. Load the \`${macro.skill}\` skill and follow it.`)
  }

  // Preferring the trash is a suggestion to the model, not a rewrite of its
  // commands: silently turning `rm` into something else would make the approval
  // the user sees a lie. `rm` stays available, and stays high risk.
  const trash = PolicyCommands.trashTool()
  if (trash) {
    notes.push(
      `To delete files prefer \`${trash.template}\`, which is reversible, over \`rm\`. `
        + `Use \`rm\` only when the user asked for something to be destroyed permanently.`,
    )
  }

  return notes.length ? `${task.prompt}\n\n[${notes.join(" ")}]` : task.prompt
}

/** Re-exported so callers do not reach past the façade for policy decisions. */
export const policy = Policy
