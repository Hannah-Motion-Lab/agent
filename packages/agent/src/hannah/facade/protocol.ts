export * as Protocol from "./protocol"

/**
 * The `hannah.v0` wire vocabulary (INTEGRATION.md §3).
 *
 * This is the *only* thing hannah-backend is allowed to depend on. Engine event
 * names, session ids, and tool internals never cross this seam — the translator
 * maps them into the words below, which are chosen to be speakable: a narrator
 * reads `summary` aloud without post-processing.
 */

export const VERSION = "hannah.v0"

export type TaskState =
  | "accepted"
  | "running"
  | "awaiting_approval"
  | "awaiting_answer"
  | "completed"
  | "failed"
  | "cancelled"

export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set(["completed", "failed", "cancelled"])

export type Preset = "companion" | "trusted-project" | "paranoid"

export type Narration = "full" | "final"

export function isNarration(input: unknown): input is Narration {
  return input === "full" || input === "final"
}

/** How many tasks may wait behind the running one before a create is refused. */
export const MAX_QUEUED = 3

export type Risk = "low" | "medium" | "high"

export type ApprovalKind = "shell" | "edit" | "delete" | "network" | "other"

export type EventType =
  | "task.accepted"
  | "task.started"
  | "task.plan"
  | "task.progress"
  | "task.tool"
  | "task.approval.requested"
  | "task.approval.resolved"
  | "task.question"
  | "task.answered"
  | "task.output"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"

/** Events the backend is expected to speak. Everything else is HUD-only. */
export const NARRATED: ReadonlySet<EventType> = new Set<EventType>([
  "task.accepted",
  "task.plan",
  "task.approval.requested",
  "task.question",
  "task.completed",
  "task.failed",
  "task.cancelled",
])

export type Envelope<T extends EventType = EventType> = {
  readonly v: typeof VERSION
  readonly taskId: string
  /** Per-task, monotonic from 1. The backend dedupes on it. */
  readonly seq: number
  readonly ts: number
  readonly type: T
  readonly data: Record<string, unknown>
}

export type TaskStats = {
  durationMs: number
  toolCalls: number
  filesTouched: number
  tokensIn: number
  tokensOut: number
  costUsd?: number
}

export function emptyStats(): TaskStats {
  return { durationMs: 0, toolCalls: 0, filesTouched: 0, tokensIn: 0, tokensOut: 0 }
}

export type CreateTaskInput = {
  prompt: string
  title?: string
  /** Name a macro explicitly instead of letting the agent guess (M3.2). */
  macro?: string
  /**
   * How much of this task should be spoken (M3.4). `final` is
   * "avísame solo cuando termines" — the HUD still shows everything.
   */
  narration?: Narration
  cwd?: string
  mode?: Preset
  timeboxMs?: number
  context?: { conversationSummary?: string; language?: string }
}

export type CreateTaskError = { field: string; message: string }

/** Defaults chosen in INTEGRATION §2; a task without a timebox cannot exist. */
export const DEFAULT_TIMEBOX_MS = 600_000
export const MAX_TIMEBOX_MS = 3_600_000
export const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000

/**
 * Validate a create-task body. Returns the normalized task input or the list of
 * problems — the backend gets a usable 400 instead of a stack trace.
 */
export function parseCreateTask(input: unknown): { ok: true; value: Required<Pick<CreateTaskInput, "prompt">> & CreateTaskInput } | { ok: false; errors: CreateTaskError[] } {
  const errors: CreateTaskError[] = []
  if (!input || typeof input !== "object") {
    return { ok: false, errors: [{ field: "", message: "body must be a JSON object" }] }
  }
  const body = input as Record<string, unknown>

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  if (!prompt) errors.push({ field: "prompt", message: "prompt is required and must be a non-empty string" })

  const title = body.title === undefined ? undefined : String(body.title).slice(0, 120)
  const macro = body.macro === undefined ? undefined : String(body.macro).slice(0, 64)

  let narration: Narration | undefined
  if (body.narration !== undefined) {
    if (isNarration(body.narration)) narration = body.narration
    else errors.push({ field: "narration", message: "narration must be full or final" })
  }
  const cwd = body.cwd === undefined ? undefined : String(body.cwd)

  let mode: Preset | undefined
  if (body.mode !== undefined) {
    if (body.mode === "companion" || body.mode === "trusted-project" || body.mode === "paranoid") mode = body.mode
    else errors.push({ field: "mode", message: "mode must be companion, trusted-project, or paranoid" })
  }

  let timeboxMs: number | undefined
  if (body.timeboxMs !== undefined) {
    const value = Number(body.timeboxMs)
    if (!Number.isFinite(value) || value <= 0) errors.push({ field: "timeboxMs", message: "timeboxMs must be a positive number" })
    else if (value > MAX_TIMEBOX_MS) errors.push({ field: "timeboxMs", message: `timeboxMs must be <= ${MAX_TIMEBOX_MS}` })
    else timeboxMs = value
  }

  let context: CreateTaskInput["context"]
  if (body.context !== undefined) {
    if (typeof body.context !== "object" || body.context === null) {
      errors.push({ field: "context", message: "context must be an object" })
    } else {
      const raw = body.context as Record<string, unknown>
      context = {
        conversationSummary: raw.conversationSummary === undefined ? undefined : String(raw.conversationSummary),
        language: raw.language === undefined ? undefined : String(raw.language),
      }
    }
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { prompt, title, macro, narration, cwd, mode, timeboxMs, context } }
}

/** Task ids are opaque to the backend but sortable for humans reading logs. */
export function taskId(now: number = Date.now(), random: () => number = Math.random) {
  const stamp = now.toString(36).padStart(9, "0")
  const noise = Math.floor(random() * 0xffffff)
    .toString(36)
    .padStart(5, "0")
  return `t_${stamp}${noise}`
}
