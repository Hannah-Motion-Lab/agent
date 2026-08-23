import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { Audit } from "@/hannah/facade/audit"
import { Protocol } from "@/hannah/facade/protocol"
import { Routes } from "@/hannah/facade/routes"
import { Facade, type EnginePort, type PermissionAsk, type QuestionAsk } from "@/hannah/facade/service"
import { MacroCatalog } from "@/hannah/macros/catalog"

// INTEGRATION §8 asks for canonical event streams shared by both repos: the
// backend's unit tests replay these so they can run with no engine at all.
// Generating them from the real façade (rather than hand-writing JSON) is what
// keeps them honest — if the vocabulary changes, regenerating changes the
// fixtures and the diff is the contract change.
//
// Regenerate: HANNAH_WRITE_FIXTURES=1 bun test test/hannah/fixtures.test.ts

const DIR = path.join(import.meta.dir, "..", "..", "..", "..", "docs", "fixtures")
const WRITE = process.env.HANNAH_WRITE_FIXTURES === "1"

class ScriptedEngine implements EnginePort {
  sessionId = "ses_fixture"
  #events = new Set<(event: { type: string; properties: Record<string, unknown> }) => void>()
  #permissions = new Set<(ask: PermissionAsk) => void>()
  #questions = new Set<(ask: QuestionAsk) => void>()
  #finish?: () => void

  async createSession() {
    return { sessionId: this.sessionId }
  }
  prompt() {
    return new Promise<void>((resolve) => (this.#finish = resolve))
  }
  async cancel() {
    this.#finish?.()
  }
  async replyPermission() {}
  async replyQuestion() {}
  async rejectQuestion() {}
  subscribe(listener: (event: { type: string; properties: Record<string, unknown> }) => void) {
    this.#events.add(listener)
    return () => this.#events.delete(listener)
  }
  onPermission(listener: (ask: PermissionAsk) => void) {
    this.#permissions.add(listener)
    return () => this.#permissions.delete(listener)
  }
  onQuestion(listener: (ask: QuestionAsk) => void) {
    this.#questions.add(listener)
    return () => this.#questions.delete(listener)
  }
  version() {
    return "fixture"
  }
  emit(type: string, properties: Record<string, unknown>) {
    for (const listener of this.#events) listener({ type, properties })
  }
  ask(ask: PermissionAsk) {
    for (const listener of this.#permissions) listener(ask)
  }
  question(ask: QuestionAsk) {
    for (const listener of this.#questions) listener(ask)
  }
  complete() {
    this.#finish?.()
  }
}

/** Deterministic clock and ids so fixtures diff cleanly across runs. */
function harness() {
  let now = 1_800_000_000_000
  const engine = new ScriptedEngine()
  const recorded: Protocol.Envelope[] = []
  const service = new Facade.TaskService(engine, {
    audit: Audit.nullSink(),
    defaultCwd: "/home/user/Downloads",
    // Pinned: the real resolver reads this machine's home directory, and a
    // fixture that differs per developer is not a fixture.
    resolveCwd: ({ fallback }) => ({ cwd: fallback, reason: "default" as const }),
    // Macro availability depends on this machine's PATH, so the harness honours
    // an explicit id and never guesses. Same reason as `resolveCwd`.
    resolveMacro: ({ macro }) => (macro ? MacroCatalog.byId(macro) : undefined),
    now: () => (now += 1000),
    setTimeout: () => 0,
    clearTimeout: () => {},
  })
  service.store.subscribe((event) => recorded.push(event.envelope))
  const deps: Routes.Deps = { service }
  return { engine, service, deps, recorded }
}

function normalize(events: Protocol.Envelope[]) {
  // Task ids are time-derived; fixtures pin a stable one so consumers can
  // assert on them without matching a regex.
  return events.map((event) => ({ ...event, taskId: "t_fixture", ts: 0 }))
}

async function record(name: string, drive: (h: ReturnType<typeof harness>) => Promise<void>) {
  const h = harness()
  await drive(h)
  const events = normalize(h.recorded)
  const file = path.join(DIR, `${name}.jsonl`)
  const content = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`

  if (WRITE) {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(file, content)
  }
  expect(fs.existsSync(file)).toBe(true)
  expect(fs.readFileSync(file, "utf8")).toBe(content)
  return events
}

const call = (deps: Routes.Deps, method: string, url: string, body?: unknown) =>
  Routes.handle(
    new Request(`http://127.0.0.1:8006${Routes.PREFIX}${url}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    deps,
  )

describe("canonical event streams (docs/fixtures)", () => {
  test("organize-downloads: the happy path with one approval", async () => {
    const events = await record("organize-downloads", async ({ engine, deps, service }) => {
      const { taskId } = await (await call(deps, "POST", "/tasks", {
        prompt: "Organize ~/Downloads into folders by file type",
        title: "ordenar descargas",
        macro: "organize-downloads",
        context: { language: "es" },
      })).json()
      await Bun.sleep(1)

      engine.emit("todo.updated", {
        sessionID: engine.sessionId,
        todos: [
          { content: "look at what is in Downloads", status: "completed" },
          { content: "create folders by type", status: "pending" },
          { content: "move the files", status: "pending" },
        ],
      })
      engine.emit("session.next.tool.called", {
        sessionID: engine.sessionId,
        tool: "bash",
        input: { command: "ls ~/Downloads" },
      })
      engine.emit("session.next.tool.success", { sessionID: engine.sessionId, tool: "bash", outputPaths: [] })

      engine.ask({
        id: "per_1",
        sessionId: engine.sessionId,
        permission: "bash",
        patterns: ["mkdir -p ~/Downloads/images"],
        metadata: { command: "mkdir -p ~/Downloads/images" },
      })
      const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
      await call(deps, "POST", `/tasks/${taskId}/approvals/${status.pendingApprovals[0].approvalId}`, {
        decision: "allow",
        by: "hud",
      })

      engine.emit("session.next.text.ended", { sessionID: engine.sessionId, text: "moved 23 files into 4 folders" })
      engine.complete()
      await Bun.sleep(2)
      void service
    })

    expect(events[0].type).toBe("task.accepted")
    expect(events.at(-1)?.type).toBe("task.completed")
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1))
  })

  test("status-report: the task's result IS its answer", async () => {
    const events = await record("status-report", async ({ engine, deps }) => {
      await (await call(deps, "POST", "/tasks", {
        prompt: "Check the git status of every repo under ~/Projects and tell me what needs attention",
        title: "estado de los repos",
        context: { language: "es" },
      })).json()
      await Bun.sleep(1)

      engine.emit("session.next.tool.called", {
        sessionID: engine.sessionId,
        tool: "bash",
        input: { command: "git -C ~/Projects/hannah-backend status --short" },
      })
      engine.emit("session.next.tool.success", { sessionID: engine.sessionId, tool: "bash", outputPaths: [] })

      // Prosa larga: se emite recortada como progreso (se habla) y entera como
      // task.output (se lee). Truncarla sería perder el entregable.
      engine.emit("session.next.text.ended", {
        sessionID: engine.sessionId,
        text: [
          "Revisé los cuatro repos de ~/Projects.",
          "",
          "- hannah-backend: limpio, 3 commits por delante de origin",
          "- hannah-frontend: 2 archivos sin commitear",
          "- motion-model: limpio",
          "- agent: rama de trabajo, 11 commits sin subir",
          "",
          "El único que necesita atención hoy es hannah-frontend.",
        ].join("\n"),
      })
      engine.complete()
      await Bun.sleep(2)
    })

    const output = events.find((event) => event.type === "task.output")
    expect(output).toBeDefined()
    expect(String(output!.data.text)).toContain("hannah-frontend: 2 archivos sin commitear")

    const completed = events.at(-1)!
    expect(completed.type).toBe("task.completed")
    // El resumen se habla y va recortado; la respuesta va completa.
    expect(String(completed.data.summary).length).toBeLessThanOrEqual(121)
    expect(String(completed.data.answer)).toContain("El único que necesita atención")
  })

  test("denied-approval: the user says no and the task ends", async () => {
    const events = await record("denied-approval", async ({ engine, deps }) => {
      const { taskId } = await (await call(deps, "POST", "/tasks", {
        prompt: "Delete the old build folders",
        title: "borrar builds",
        context: { language: "es" },
      })).json()
      await Bun.sleep(1)

      engine.ask({
        id: "per_1",
        sessionId: engine.sessionId,
        permission: "bash",
        patterns: ["rm -rf ./build"],
        metadata: { command: "rm -rf ./build" },
      })
      const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
      await call(deps, "POST", `/tasks/${taskId}/approvals/${status.pendingApprovals[0].approvalId}`, {
        decision: "deny",
        by: "voice",
      })
      engine.emit("session.next.text.ended", { sessionID: engine.sessionId, text: "I left the build folders alone" })
      engine.complete()
      await Bun.sleep(2)
    })

    const approval = events.find((event) => event.type === "task.approval.requested")
    expect(approval?.data.risk).toBe("high")
    expect(events.find((event) => event.type === "task.approval.resolved")?.data).toMatchObject({ decision: "deny" })
  })

  test("cancelled-task: the user interrupts mid-run", async () => {
    const events = await record("cancelled-task", async ({ engine, deps }) => {
      const { taskId } = await (await call(deps, "POST", "/tasks", {
        prompt: "Reindex every project in ~/Projects",
        title: "reindexar proyectos",
      })).json()
      await Bun.sleep(1)
      engine.emit("session.next.text.ended", { sessionID: engine.sessionId, text: "starting with hannah-backend" })
      await call(deps, "POST", `/tasks/${taskId}/cancel`, { reason: "user" })
      await Bun.sleep(2)
    })

    expect(events.at(-1)).toMatchObject({ type: "task.cancelled", data: { reason: "user" } })
  })

  test("failed-task: the engine errors out", async () => {
    const events = await record("failed-task", async ({ engine, deps }) => {
      await (await call(deps, "POST", "/tasks", { prompt: "Build the frontend", title: "compilar" })).json()
      await Bun.sleep(1)
      engine.emit("session.next.tool.called", {
        sessionID: engine.sessionId,
        tool: "bash",
        input: { command: "npm run build" },
      })
      engine.emit("session.next.tool.failed", { sessionID: engine.sessionId, tool: "bash", error: "exit code 1" })
      engine.emit("session.error", { sessionID: engine.sessionId, error: { message: "the build failed" } })
      engine.complete()
      await Bun.sleep(2)
    })

    expect(events.at(-1)?.type).toBe("task.failed")
  })

  test("every fixture uses only the published vocabulary", () => {
    for (const file of fs.readdirSync(DIR).filter((name) => name.endsWith(".jsonl"))) {
      const lines = fs.readFileSync(path.join(DIR, file), "utf8").trim().split("\n")
      for (const line of lines) {
        const event = JSON.parse(line) as Protocol.Envelope
        expect(event.v).toBe("hannah.v0")
        expect(event.type.startsWith("task.")).toBe(true)
        // No engine internals may appear in a fixture the backend codes against.
        expect(JSON.stringify(event)).not.toContain("session.next")
        expect(JSON.stringify(event)).not.toContain("ses_")
      }
    }
  })
})
