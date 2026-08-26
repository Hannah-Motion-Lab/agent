export * as Translate from "./translate"

import { PolicyCommands } from "../policy/commands"
import { PolicyPresets } from "../policy/presets"
import { PolicyRedact } from "../policy/redact"
import { Protocol } from "./protocol"

/**
 * Engine bus → `hannah.v0`.
 *
 * Two jobs, both load-bearing:
 *
 * 1. **Insulation.** Engine event names never cross the seam (ADR-0006). The
 *    backend codes against 13 stable event types instead of the engine's 89.
 * 2. **Speakability.** `summary` is read aloud by a voice. That rules out
 *    paths, ids, markdown, and stack traces — the HUD gets detail, the
 *    narrator gets a sentence.
 *
 * Everything user-visible passes through `PolicyRedact` on the way out. Tool
 * output is the most likely place for a key to surface (an `env` dump, a
 * config file echoed by `cat`), and events are forwarded and logged.
 */

export type EngineEvent = { readonly type: string; readonly properties: Record<string, unknown> }

export type Translated = {
  readonly type: Protocol.EventType
  readonly data: Record<string, unknown>
}

/** Engine tool names → a verb a person would use. */
const TOOL_VERBS: Record<string, string> = {
  bash: "running a command",
  shell: "running a command",
  read: "reading a file",
  edit: "editing a file",
  write: "writing a file",
  apply_patch: "applying changes",
  glob: "looking for files",
  grep: "searching files",
  list: "listing files",
  webfetch: "fetching a page",
  websearch: "searching the web",
  task: "delegating a sub-task",
  todowrite: "updating its plan",
  skill: "loading instructions",
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function shorten(input: string, max = 120) {
  const flat = input.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * Ceiling for a full answer. Unlike `shorten` this keeps line structure — an
 * answer is *read*, not spoken, so its shape carries meaning. The cap exists
 * only so one runaway response cannot blow up an SSE frame or the resume ring.
 */
export const MAX_OUTPUT_CHARS = 4000

function clamp(input: string, max = MAX_OUTPUT_CHARS) {
  const trimmed = input.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** Prose long enough to be an answer rather than a status line. */
export function isAnswer(text: string) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > 120 || /\n/.test(text.trim())
}

/** Map an engine permission id to the coarse class the HUD renders. */
export function approvalKind(permission: string, command?: string): Protocol.ApprovalKind {
  if (permission === "bash" || permission === "shell") {
    // Moving to the trash is still a delete — the HUD should show it as one.
    // It differs in *risk*, not in kind, and risk is decided by policy.
    if (command && PolicyCommands.isTrashCommand(command)) return "delete"
    if (command && /\b(rm|rmdir|shred|truncate)\b/.test(command)) return "delete"
    if (command && /\b(curl|wget|scp|rsync|ssh|nc)\b/.test(command)) return "network"
    return "shell"
  }
  if (permission === "edit" || permission === "write" || permission === "patch") return "edit"
  if (permission === "webfetch" || permission === "websearch") return "network"
  if (permission === "external_directory") return "other"
  return "other"
}

/** A one-sentence, speakable description of what is being asked for. */
export function approvalSummary(permission: string, patterns: readonly string[], metadata: Record<string, unknown>) {
  const command = str(metadata["command"])
  if (permission === "bash" || permission === "shell") {
    if (!command) return "run a command"
    // The difference matters most in the one place it used to be invisible: a
    // question asked out loud. `rm -rf ./build` and `gio trash ./build` both
    // read as "run a command", so the user approved the irreversible one on the
    // same evidence as the reversible one.
    const target = deleteTarget(command)
    if (target && PolicyCommands.isTrashCommand(command)) return `move ${target} to the trash`
    if (target) return `permanently delete ${target}`
    return `run \`${shorten(command, 80)}\``
  }
  if (permission === "edit" || permission === "write" || permission === "patch") {
    const count = patterns.length
    if (count === 1) return `change ${basename(patterns[0])}`
    return `change ${count} files`
  }
  if (permission === "external_directory") {
    const dirs = metadata["directories"]
    const first = Array.isArray(dirs) ? str(dirs[0]) : undefined
    return first ? `work in ${basename(first)}` : "work outside this folder"
  }
  if (permission === "webfetch" || permission === "websearch") return "reach the internet"
  if (permission === "task") return `start a sub-task (${patterns[0] ?? "helper"})`
  return `use ${permission}`
}

/** What a delete command is pointed at, phrased for a sentence. */
function deleteTarget(command: string) {
  const flat = command.trim()
  const isDelete = PolicyCommands.isTrashCommand(flat) || /^(sudo\s+)?(rm|rmdir|shred)\b/.test(flat)
  if (!isDelete) return undefined
  const operands = flat
    .split(/\s+/)
    .slice(1)
    .filter((part) => part && !part.startsWith("-") && part !== "trash")
  if (!operands.length) return "some files"
  if (operands.length === 1) return `\`${shorten(operands[0]!, 60)}\``
  return `${operands.length} paths`
}

function basename(input: string) {
  const trimmed = input.replace(/\/+$/, "")
  const parts = trimmed.split("/")
  return parts[parts.length - 1] || trimmed
}

/**
 * Translate one engine event. Returns `undefined` for the ~76 event types the
 * backend has no use for — dropping them is the point, not an omission.
 *
 * Approval and question events are *not* produced here: they need façade-owned
 * ids and timeout bookkeeping, so the service builds them (see service.ts).
 */
export function event(input: EngineEvent): Translated | undefined {
  const props = input.properties ?? {}

  switch (input.type) {
    case "todo.updated": {
      const todos = Array.isArray(props.todos) ? (props.todos as Array<Record<string, unknown>>) : []
      if (!todos.length) return undefined
      const steps = todos.map((todo) => shorten(String(todo.content ?? ""), 80)).filter(Boolean)
      const done = todos.filter((todo) => todo.status === "completed").length
      return {
        type: "task.plan",
        data: {
          summary: PolicyRedact.text(`plan: ${steps.length} step${steps.length === 1 ? "" : "s"}`),
          steps: steps.map((step) => PolicyRedact.text(step)),
          completed: done,
        },
      }
    }

    case "session.next.tool.called": {
      const tool = str(props.tool) ?? "tool"
      // `target` is the 80-char label for the HUD pill; `command` is the whole thing, for the
      // terminal panel, which echoes what the hands run so the person can read it like their
      // own shell history. Both go through the redactor.
      const command = isShell(tool) ? str((props.input as Record<string, unknown> | undefined)?.command) : undefined
      return {
        type: "task.tool",
        data: {
          tool,
          status: "started",
          target: PolicyRedact.value(toolTarget(tool, props.input)),
          ...(command ? { command: PolicyRedact.text(shorten(command, 400)) } : {}),
          summary: TOOL_VERBS[tool] ?? `using ${tool}`,
        },
      }
    }

    case "session.next.tool.success": {
      const tool = str(props.tool) ?? "tool"
      // The first lines of a command's output, for the same terminal echo. Never the whole
      // thing: the deliverable travels as `task.output`; this is a glance.
      const output = str(props.output)
      return {
        type: "task.tool",
        data: {
          tool,
          status: "done",
          ...(output ? { preview: PolicyRedact.text(shorten(output, 600)) } : {}),
          summary: TOOL_VERBS[tool] ?? `used ${tool}`,
        },
      }
    }

    case "session.next.tool.failed": {
      const tool = str(props.tool) ?? "tool"
      return {
        type: "task.tool",
        data: {
          tool,
          status: "failed",
          summary: PolicyRedact.text(shorten(str(props.error) ?? `${tool} failed`)),
        },
      }
    }

    case "session.next.text.ended": {
      // The model's own prose is the most human progress signal available.
      const text = str(props.text)
      if (!text) return undefined
      return { type: "task.progress", data: { summary: PolicyRedact.text(shorten(text)) } }
    }

    case "hannah.output": {
      // Not an engine event — the service re-feeds assistant prose here when it
      // is long enough to be an *answer* rather than a status line. Progress is
      // capped at 120 characters because it is read aloud; an answer must not
      // be, because losing it is losing the whole point of the task.
      const text = str(props.text)
      if (!text) return undefined
      return {
        type: "task.output",
        data: {
          text: PolicyRedact.text(clamp(text)),
          summary: PolicyRedact.text(shorten(text)),
        },
      }
    }

    case "session.next.step.started":
      return undefined // too granular to narrate; the tool events carry it

    case "session.error": {
      // Engine errors are tagged: `{ name, data: { message, … } }`. Reading only
      // `error.message` yields "the task hit an error", which is useless to the
      // person listening — and to whoever reads the audit log afterwards.
      const error = props.error as { name?: unknown; data?: Record<string, unknown> } | undefined
      const detail = str(error?.data?.["message"]) ?? str((error as Record<string, unknown>)?.["message"])
      const name = str(error?.name)
      const message = detail ?? (name ? humanizeErrorName(name) : undefined) ?? "the task hit an error"
      return {
        type: "task.failed",
        data: {
          summary: PolicyRedact.text(shorten(message)),
          error: PolicyRedact.text(name ? `${name}: ${message}` : message),
          // Auth and config problems are fixable by the user and worth retrying;
          // an unknown crash is not.
          recoverable: name === "ProviderAuthError" || name === "ConfigInvalidError",
        },
      }
    }

    default:
      return undefined
  }
}

/** Turn `ProviderAuthError` into something speakable when there is no message. */
function humanizeErrorName(name: string) {
  if (name === "ProviderAuthError") return "I'm not signed in to the model provider"
  if (name === "ConfigInvalidError") return "the configuration is invalid"
  if (name === "MessageAbortedError") return "the run was interrupted"
  return name.replace(/Error$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
}

/** A short, redacted description of what a tool is pointed at. */
const isShell = (tool: string) => tool === "bash" || tool === "shell"

function toolTarget(tool: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  const record = input as Record<string, unknown>
  if (tool === "bash" || tool === "shell") return shorten(str(record.command) ?? "", 80) || undefined
  const file = str(record.filePath) ?? str(record.path) ?? str(record.pattern)
  return file ? basename(file) : undefined
}

/** Risk tiering is policy, not translation — re-exported so callers use one source. */
export const risk = PolicyPresets.risk
