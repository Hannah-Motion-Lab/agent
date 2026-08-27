export * as Audit from "./audit"

import fs from "fs"
import path from "path"
import { PolicyRedact } from "../policy/redact"

/**
 * Append-only JSONL audit log (SECURITY §6).
 *
 * One line per decision that mattered: task lifecycle, every tool invocation,
 * every approval and how it was answered (voice / hud / timeout), every policy
 * denial. This is the record that answers "what did it actually do", so it is
 * written synchronously — a crash mid-task must not lose the line explaining
 * why the task was doing something.
 *
 * Everything is redacted on the way in. An audit log that leaks the key it was
 * recording is worse than no audit log.
 */

export type Entry = {
  ts?: number
  taskId?: string
  event: string
  [key: string]: unknown
}

export type Sink = { write(entry: Entry): void; path?: string; close?(): void }

/** Discards everything — used in tests and when auditing is disabled. */
export function nullSink(): Sink {
  return { write() {} }
}

/** Keeps entries in memory; useful for assertions. */
export function memorySink(): Sink & { entries: Entry[] } {
  const entries: Entry[] = []
  return {
    entries,
    write(entry) {
      entries.push(PolicyRedact.value({ ts: Date.now(), ...entry }))
    },
  }
}

/**
 * Daily-rotated JSONL under the engine's data directory. Rotation by day keeps
 * the retention policy (SECURITY §6, default 30 days) a matter of deleting
 * whole files rather than rewriting one.
 */
export function fileSink(directory: string): Sink {
  let stream: fs.WriteStream | undefined
  let day = ""

  const open = () => {
    const today = new Date().toISOString().slice(0, 10)
    if (stream && today === day) return stream
    stream?.end()
    day = today
    fs.mkdirSync(directory, { recursive: true })
    stream = fs.createWriteStream(path.join(directory, `audit-${today}.jsonl`), { flags: "a", mode: 0o600 })
    // A full disk or an unwritable directory must not take the process down: an unhandled
    // 'error' on a stream is fatal in Node. Drop the sink and let the next write reopen.
    stream.on("error", () => { stream = undefined })
    return stream
  }

  return {
    path: directory,
    write(entry) {
      try {
        open().write(`${JSON.stringify(PolicyRedact.value({ ts: Date.now(), ...entry }))}\n`)
      } catch {
        // Auditing must never take the task down with it.
      }
    },
    close() {
      stream?.end()
      stream = undefined
    },
  }
}

// ── reading it back ─────────────────────────────────────────────────────────

/**
 * History is **derived from the audit log**, not stored separately.
 *
 * The log already records every task's whole life, is append-only, and already
 * has a retention policy. A second store would be a second source of truth that
 * can disagree with the first — and the disagreement would surface as Hannah
 * telling you about a task the audit log says never happened.
 */

export type HistoryRow = {
  taskId: string
  title?: string
  state?: string
  macro?: string
  cwd?: string
  startedAt?: number
  endedAt?: number
  summary?: string
  error?: string
  stats?: Record<string, unknown>
  /** Approvals asked, and how many were granted. The interesting part. */
  approvals?: { asked: number; allowed: number; denied: number }
}

const DAY_FILE = /^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/

/** Log files, newest day first. */
export function files(directory: string): string[] {
  try {
    return fs
      .readdirSync(directory)
      .filter((name) => DAY_FILE.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(directory, name))
  } catch {
    return []
  }
}

function* lines(file: string): Generator<Entry> {
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch {
    return
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    try {
      yield JSON.parse(line) as Entry
    } catch {
      // A torn last line after a crash is expected; skipping it is the point of
      // reading line by line rather than parsing the file as a whole.
    }
  }
}

/** Every recorded entry for one task, oldest first. */
export function trail(directory: string, taskId: string, limit = 500): Entry[] {
  const found: Entry[] = []
  // Newest file first, but a task's own entries stay in order within a day, and
  // a task never spans more days than it ran.
  for (const file of files(directory)) {
    const day = [...lines(file)].filter((entry) => entry.taskId === taskId)
    found.unshift(...day)
    if (found.length >= limit) break
  }
  return found.slice(-limit)
}

/**
 * One row per task, newest first. Reads only as many day-files as it needs.
 */
export function history(directory: string, limit = 25): HistoryRow[] {
  const rows = new Map<string, HistoryRow>()

  for (const file of files(directory)) {
    for (const entry of lines(file)) {
      const taskId = typeof entry.taskId === "string" ? entry.taskId : undefined
      if (!taskId) continue
      const row = rows.get(taskId) ?? { taskId }
      apply(row, entry)
      rows.set(taskId, row)
    }
    // Files are read newest-first, so once enough distinct tasks have been seen
    // the older days cannot add a newer one.
    if (rows.size >= limit) break
  }

  return [...rows.values()]
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, limit)
}

function apply(row: HistoryRow, entry: Entry) {
  const data = (entry.data ?? {}) as Record<string, unknown>
  const str = (value: unknown) => (typeof value === "string" ? value : undefined)

  switch (entry.event) {
    case "task.created":
      row.title = str(entry.title) ?? row.title
      row.cwd = str(entry.cwd) ?? row.cwd
      row.macro = str(entry.macro) ?? row.macro
      row.startedAt = typeof entry.ts === "number" ? entry.ts : row.startedAt
      row.state = row.state ?? "accepted"
      break
    case "task.accepted":
      row.title = str(data.title) ?? row.title
      break
    case "task.completed":
    case "task.failed":
    case "task.cancelled":
      row.state = entry.event.slice("task.".length)
      row.endedAt = typeof entry.ts === "number" ? entry.ts : row.endedAt
      row.summary = str(data.summary) ?? row.summary
      row.error = str(data.error) ?? row.error
      if (data.stats && typeof data.stats === "object") row.stats = data.stats as Record<string, unknown>
      break
    case "approval.resolved": {
      const counts = row.approvals ?? { asked: 0, allowed: 0, denied: 0 }
      counts.asked += 1
      if (entry.decision === "allow") counts.allowed += 1
      else counts.denied += 1
      row.approvals = counts
      break
    }
    default:
      break
  }
}

/**
 * Delete whole day-files older than `days`. Rotation by day is what makes this
 * a delete rather than a rewrite — a log you have to rewrite to trim is a log
 * you can corrupt while trimming.
 *
 * Runs on startup rather than waiting for a command: a retention policy nobody
 * remembers to run is not a retention policy.
 */
export function purge(directory: string, days: number, now = Date.now()): string[] {
  if (!Number.isFinite(days) || days <= 0) return []
  const cutoff = now - days * 86_400_000
  const removed: string[] = []
  for (const file of files(directory)) {
    const match = DAY_FILE.exec(path.basename(file))
    if (!match) continue
    // Compare the day the file is *for*, not its mtime: an appended-to file
    // from last month would otherwise look fresh.
    const day = Date.parse(`${match[1]}T23:59:59.999Z`)
    if (Number.isNaN(day) || day >= cutoff) continue
    try {
      fs.rmSync(file)
      removed.push(file)
    } catch {
      // A file we cannot delete is not a reason to stop deleting the rest.
    }
  }
  return removed
}
