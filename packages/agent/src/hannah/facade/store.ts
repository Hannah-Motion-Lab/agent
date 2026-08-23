export * as Store from "./store"

import { Protocol } from "./protocol"

/**
 * In-memory task and event store.
 *
 * The engine's own SSE stream is live-only — no `Last-Event-ID`, no replay
 * (M0.1 audit §3). So the façade owns durability for the window that matters:
 * it assigns the per-task `seq` the backend dedupes on, stamps a **global**
 * cursor used as the SSE event id, and keeps a ring buffer so a backend that
 * reconnects mid-task can catch up instead of losing the approval it was about
 * to speak.
 *
 * Two counters, deliberately: `seq` is per task (INTEGRATION §3 — the backend
 * reasons per task), while resume needs a single ordering across all tasks.
 * Conflating them would make resume ambiguous the moment two tasks overlap.
 */

export type Approval = {
  readonly id: string
  readonly taskId: string
  readonly kind: Protocol.ApprovalKind
  readonly risk: Protocol.Risk
  readonly summary: string
  readonly command?: string
  readonly paths?: readonly string[]
  readonly timeoutMs: number
  readonly askedAt: number
  /** Engine-side id this maps back to, so a reply can be routed. */
  readonly engineId: string
}

export type Question = {
  readonly id: string
  readonly taskId: string
  readonly text: string
  readonly options?: readonly string[]
  readonly askedAt: number
  readonly engineId: string
}

export type Task = {
  id: string
  title: string
  prompt: string
  cwd: string
  mode: Protocol.Preset
  language: string
  timeboxMs: number
  state: Protocol.TaskState
  createdAt: number
  startedAt?: number
  endedAt?: number
  /** Engine session backing this task. Never crosses the seam. */
  sessionId?: string
  /** The macro this task is running, if it matched one (M3.2). */
  macro?: string
  /** How much of it should be spoken (M3.4). */
  narration: Protocol.Narration
  /** Set while the task is waiting for the lane; cleared when it starts. */
  queued: boolean
  lastProgress?: string
  /** The last substantive prose the agent wrote — the task's answer, if it has one. */
  answer?: string
  stats: Protocol.TaskStats
  error?: string
  approvals: Map<string, Approval>
  questions: Map<string, Question>
}

export type StoredEvent = {
  /** Global monotonic cursor — the SSE `id:` field, used for resume. */
  readonly cursor: number
  readonly envelope: Protocol.Envelope
}

export type Listener = (event: StoredEvent) => void

const DEFAULT_BUFFER = 2000

export class TaskStore {
  #tasks = new Map<string, Task>()
  #order: string[] = []
  #events: StoredEvent[] = []
  #listeners = new Set<Listener>()
  #cursor = 0
  #seq = new Map<string, number>()

  constructor(
    private readonly options: { bufferSize?: number; historySize?: number; now?: () => number } = {},
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now()
  }

  /** The one active (non-terminal) task, if any — the v0 concurrency rule. */
  /** The task holding the lane — not counting the ones waiting behind it. */
  active(): Task | undefined {
    for (const id of this.#order) {
      const task = this.#tasks.get(id)
      if (task && !task.queued && !Protocol.TERMINAL_STATES.has(task.state)) return task
    }
    return undefined
  }

  /** Waiting for the lane, in the order they were asked for. */
  queued(): Task[] {
    const waiting: Task[] = []
    for (const id of this.#order) {
      const task = this.#tasks.get(id)
      if (task && task.queued && !Protocol.TERMINAL_STATES.has(task.state)) waiting.push(task)
    }
    return waiting
  }

  get(id: string) {
    return this.#tasks.get(id)
  }

  /** Most recent first, for `GET /tasks`. */
  list(limit = 20): Task[] {
    return this.#order
      .slice(-limit)
      .reverse()
      .map((id) => this.#tasks.get(id)!)
      .filter(Boolean)
  }

  create(input: {
    id: string
    prompt: string
    title?: string
    macro?: string
    narration?: Protocol.Narration
    queued?: boolean
    cwd: string
    mode: Protocol.Preset
    timeboxMs: number
    language: string
  }): Task {
    const task: Task = {
      id: input.id,
      title: input.title?.trim() || defaultTitle(input.prompt),
      prompt: input.prompt,
      macro: input.macro,
      narration: input.narration ?? "full",
      queued: input.queued ?? false,
      cwd: input.cwd,
      mode: input.mode,
      language: input.language,
      timeboxMs: input.timeboxMs,
      state: "accepted",
      createdAt: this.now(),
      stats: Protocol.emptyStats(),
      approvals: new Map(),
      questions: new Map(),
    }
    this.#tasks.set(task.id, task)
    this.#order.push(task.id)

    const historySize = this.options.historySize ?? 200
    while (this.#order.length > historySize) {
      const dropped = this.#order.shift()
      if (dropped) this.#tasks.delete(dropped)
    }
    return task
  }

  /**
   * Move a task to a new state. Terminal states are final: a late engine event
   * must never resurrect a task the user was already told had finished.
   */
  transition(id: string, state: Protocol.TaskState): boolean {
    const task = this.#tasks.get(id)
    if (!task) return false
    if (Protocol.TERMINAL_STATES.has(task.state)) return false
    if (task.state === state) return true
    task.state = state
    if (state === "running" && !task.startedAt) task.startedAt = this.now()
    if (Protocol.TERMINAL_STATES.has(state)) {
      task.endedAt = this.now()
      task.stats.durationMs = task.endedAt - (task.startedAt ?? task.createdAt)
      // Nothing is pending once a task is over.
      task.approvals.clear()
      task.questions.clear()
    }
    return true
  }

  /** Append an event, assigning both counters. Returns the stored form. */
  publish(taskId: string, type: Protocol.EventType, data: Record<string, unknown>): StoredEvent {
    const seq = (this.#seq.get(taskId) ?? 0) + 1
    this.#seq.set(taskId, seq)
    this.#cursor += 1

    const stored: StoredEvent = {
      cursor: this.#cursor,
      envelope: { v: Protocol.VERSION, taskId, seq, ts: this.now(), type, data },
    }

    this.#events.push(stored)
    const bufferSize = this.options.bufferSize ?? DEFAULT_BUFFER
    if (this.#events.length > bufferSize) this.#events.splice(0, this.#events.length - bufferSize)

    for (const listener of this.#listeners) {
      try {
        listener(stored)
      } catch {
        // A broken subscriber must not stop the task or the other subscribers.
      }
    }
    return stored
  }

  /**
   * Events after `cursor`, for `Last-Event-ID` resume.
   *
   * `truncated` tells the caller the buffer had already dropped part of what
   * they missed — the backend then refetches task state instead of assuming
   * the replay was complete. Silence would be the dangerous answer here.
   */
  since(cursor: number): { events: StoredEvent[]; truncated: boolean } {
    if (this.#events.length === 0) return { events: [], truncated: false }
    const oldest = this.#events[0].cursor
    const truncated = cursor > 0 && cursor < oldest - 1
    return { events: this.#events.filter((event) => event.cursor > cursor), truncated }
  }

  cursor() {
    return this.#cursor
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  subscriberCount() {
    return this.#listeners.size
  }
}

/** A short human label when the persona did not supply one. */
function defaultTitle(prompt: string) {
  const firstLine = prompt.split("\n")[0].trim()
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine
}
