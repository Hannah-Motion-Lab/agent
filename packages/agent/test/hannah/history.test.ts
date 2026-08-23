import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Audit } from "@/hannah/facade/audit"

// M3.5 — history is DERIVED from the audit log, not stored separately. A second
// store would be a second source of truth, and the disagreement would surface
// as Hannah describing a task the log says never happened.

let dir: string

const day = (offsetDays: number) => {
  const date = new Date(Date.now() - offsetDays * 86_400_000)
  return date.toISOString().slice(0, 10)
}

const write = (offsetDays: number, entries: Audit.Entry[]) => {
  const file = path.join(dir, `audit-${day(offsetDays)}.jsonl`)
  fs.appendFileSync(file, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""))
}

const at = (offsetDays: number, hour = 12) => Date.now() - offsetDays * 86_400_000 + hour * 3_600_000

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hannah-history-"))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("reconstructing a task from its trail", () => {
  beforeEach(() => {
    write(0, [
      { ts: at(0, 9), taskId: "t_a", event: "task.created", title: "ordenar descargas", cwd: "/home/u/Downloads", macro: "organize-downloads" },
      { ts: at(0, 9), taskId: "t_a", event: "task.accepted", data: { title: "ordenar descargas" } },
      { ts: at(0, 9), taskId: "t_a", event: "approval.resolved", approvalId: "a_1", decision: "allow", by: "voice" },
      { ts: at(0, 9), taskId: "t_a", event: "approval.resolved", approvalId: "a_2", decision: "deny", by: "timeout" },
      { ts: at(0, 10), taskId: "t_a", event: "task.completed", data: { summary: "23 archivos movidos", stats: { toolCalls: 4 } } },
    ])
  })

  test("one row carries what actually happened", () => {
    const [row] = Audit.history(dir)
    expect(row).toMatchObject({
      taskId: "t_a",
      title: "ordenar descargas",
      state: "completed",
      macro: "organize-downloads",
      summary: "23 archivos movidos",
    })
    expect(row!.stats).toMatchObject({ toolCalls: 4 })
  })

  // Cuántos permisos se pidieron y cuántos se concedieron es la parte
  // interesante de un historial: es donde se ve si la tarea hizo lo que quería.
  test("approvals are counted, allowed and denied apart", () => {
    expect(Audit.history(dir)[0]!.approvals).toEqual({ asked: 2, allowed: 1, denied: 1 })
  })

  test("the trail comes back in order, only for that task", () => {
    write(0, [{ ts: at(0, 9), taskId: "t_other", event: "task.created", title: "otra" }])
    const trail = Audit.trail(dir, "t_a")
    expect(trail.every((entry) => entry.taskId === "t_a")).toBe(true)
    expect(trail.map((entry) => entry.event)).toEqual([
      "task.created", "task.accepted", "approval.resolved", "approval.resolved", "task.completed",
    ])
  })

  test("a failed task keeps its error, not just its state", () => {
    write(0, [
      { ts: at(0, 11), taskId: "t_b", event: "task.created", title: "compilar" },
      { ts: at(0, 12), taskId: "t_b", event: "task.failed", data: { summary: "no compiló", error: "exit 1" } },
    ])
    const row = Audit.history(dir).find((entry) => entry.taskId === "t_b")!
    expect(row).toMatchObject({ state: "failed", error: "exit 1", summary: "no compiló" })
  })
})

describe("reading a log that a crash tore", () => {
  test("a half-written last line is skipped, not fatal", () => {
    write(0, [{ ts: at(0), taskId: "t_c", event: "task.created", title: "x" }])
    fs.appendFileSync(path.join(dir, `audit-${day(0)}.jsonl`), '{"taskId":"t_c","event":"task.comp')

    expect(Audit.history(dir).map((row) => row.taskId)).toEqual(["t_c"])
  })

  test("a missing directory is empty history, not a throw", () => {
    expect(Audit.history(path.join(dir, "nope"))).toEqual([])
    expect(Audit.trail(path.join(dir, "nope"), "t_a")).toEqual([])
  })
})

describe("ordering and limits", () => {
  beforeEach(() => {
    write(2, [{ ts: at(2), taskId: "t_old", event: "task.created", title: "vieja" }])
    write(1, [{ ts: at(1), taskId: "t_mid", event: "task.created", title: "media" }])
    write(0, [{ ts: at(0), taskId: "t_new", event: "task.created", title: "nueva" }])
  })

  test("newest first, across day files", () => {
    expect(Audit.history(dir).map((row) => row.taskId)).toEqual(["t_new", "t_mid", "t_old"])
  })

  test("the limit stops it reading further back than it needs", () => {
    expect(Audit.history(dir, 1).map((row) => row.taskId)).toEqual(["t_new"])
  })
})

describe("retention", () => {
  beforeEach(() => {
    for (const offset of [0, 5, 40, 90]) {
      write(offset, [{ ts: at(offset), taskId: `t_${offset}`, event: "task.created", title: `d${offset}` }])
    }
  })

  test("whole day-files past the window go, and nothing else does", () => {
    const removed = Audit.purge(dir, 30)
    expect(removed).toHaveLength(2)

    const left = Audit.files(dir).map((file) => path.basename(file))
    expect(left).toHaveLength(2)
    expect(left.some((name) => name.includes(day(0)))).toBe(true)
    expect(left.some((name) => name.includes(day(5)))).toBe(true)
  })

  // El nombre del fichero es el día del que ES, no cuándo se tocó por última
  // vez: un fichero del mes pasado al que se le añadió algo parecería fresco.
  test("the file's day decides, not its mtime", () => {
    const stale = path.join(dir, `audit-${day(90)}.jsonl`)
    fs.utimesSync(stale, new Date(), new Date())
    expect(Audit.purge(dir, 30).some((file) => file === stale)).toBe(true)
  })

  test("a nonsensical window deletes nothing", () => {
    expect(Audit.purge(dir, 0)).toEqual([])
    expect(Audit.purge(dir, -1)).toEqual([])
    expect(Audit.files(dir)).toHaveLength(4)
  })
})
