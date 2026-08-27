import { beforeEach, describe, expect, test } from "bun:test"
import { Audit } from "@/hannah/facade/audit"
import { Protocol } from "@/hannah/facade/protocol"
import { Routes } from "@/hannah/facade/routes"
import { Facade, type EnginePort, type PermissionAsk, type QuestionAsk } from "@/hannah/facade/service"
import { PolicyCommands } from "@/hannah/policy/commands"

// INTEGRATION §8 contract suite: create / approve / cancel / question / timebox,
// SSE resume after disconnect, 409 on concurrent create, token auth on and off.
// The engine is faked so the whole contract runs without a model or a socket;
// the real engine adapter is exercised separately.

class FakeEngine implements EnginePort {
  sessions: Array<{ sessionId: string; title: string; cwd: string; preset: string }> = []
  prompts: Array<{ sessionId: string; prompt: string }> = []
  cancels: string[] = []
  permissionReplies: Array<{ id: string; reply: string }> = []
  questionReplies: Array<{ id: string; answers: string[][] }> = []
  questionRejects: string[] = []

  #events = new Set<(event: { type: string; properties: Record<string, unknown> }) => void>()
  #permissions = new Set<(ask: PermissionAsk) => void>()
  #questions = new Set<(ask: QuestionAsk) => void>()
  #finish?: () => void
  #fail?: (error: Error) => void

  async createSession(input: { title: string; cwd: string; preset: string }) {
    const sessionId = `ses_${this.sessions.length + 1}`
    this.sessions.push({ sessionId, ...input })
    return { sessionId }
  }

  /** The prompt hangs until the test completes or fails it — like a real run. */
  prompt(input: { sessionId: string; prompt: string }) {
    this.prompts.push(input)
    return new Promise<void>((resolve, reject) => {
      this.#finish = resolve
      this.#fail = reject
    })
  }

  async cancel(sessionId: string) {
    this.cancels.push(sessionId)
    this.#finish?.()
  }

  async replyPermission(id: string, reply: "once" | "always" | "reject") {
    this.permissionReplies.push({ id, reply })
  }
  async replyQuestion(id: string, answers: string[][]) {
    this.questionReplies.push({ id, answers })
  }
  async rejectQuestion(id: string) {
    this.questionRejects.push(id)
  }

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
    return "test-engine"
  }

  // test drivers
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
  crash(message: string) {
    this.#fail?.(new Error(message))
  }
}

/** Manual clock so timeout behavior is tested deterministically, not by waiting. */
class Clock {
  #pending = new Map<number, { fn: () => void; at: number }>()
  #id = 0
  now = 1_000_000

  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.#id
    this.#pending.set(id, { fn, at: this.now + ms })
    return id
  }
  clearTimeout = (handle: unknown) => {
    this.#pending.delete(handle as number)
  }
  advance(ms: number) {
    this.now += ms
    for (const [id, timer] of [...this.#pending]) {
      if (timer.at <= this.now) {
        this.#pending.delete(id)
        timer.fn()
      }
    }
  }
}

let engine: FakeEngine
let clock: Clock
let audit: ReturnType<typeof Audit.memorySink>
let service: Facade.TaskService

function make(token?: string) {
  engine = new FakeEngine()
  clock = new Clock()
  audit = Audit.memorySink()
  service = new Facade.TaskService(engine, {
    audit,
    defaultCwd: "/tmp/hannah-facade-test",
    // Both pinned: the real resolver reads this machine's home directory and
    // the trash detector reads PATH. Neither belongs in a contract suite —
    // they have their own (workspaces.test.ts).
    resolveCwd: ({ cwd, fallback }) => ({ cwd: cwd ?? fallback, reason: cwd ? "explicit" : "default" }),
    resolveMacro: () => undefined,
    approvalTimeoutMs: 120_000,
    now: () => clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  return { deps: { service, token } }
}

function call(deps: Routes.Deps, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return Routes.handle(
    new Request(`http://127.0.0.1:8006${Routes.PREFIX}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", ...headers },
    }),
    deps,
  )
}

const CREATE = { prompt: "Organize ~/Downloads by file type", title: "ordenar descargas", context: { language: "es" } }

beforeEach(() => {
  PolicyCommands.resetTrashTool()
  process.env["PATH"] = ""
  make()
})

describe("health", () => {
  test("reports engine version and active task count", async () => {
    const { deps } = make()
    const before = await (await call(deps, "GET", "/health")).json()
    expect(before).toMatchObject({ healthy: true, version: "hannah.v0", engineVersion: "test-engine", activeTasks: 0 })

    await call(deps, "POST", "/tasks", CREATE)
    const after = await (await call(deps, "GET", "/health")).json()
    expect(after.activeTasks).toBe(1)
  })
})

describe("create", () => {
  test("accepts a task and starts a session with the preset", async () => {
    const { deps } = make()
    const response = await call(deps, "POST", "/tasks", CREATE)
    expect(response.status).toBe(202)
    const created = await response.json()
    expect(created.taskId).toMatch(/^t_/)

    await Bun.sleep(1)
    expect(engine.sessions).toHaveLength(1)
    expect(engine.sessions[0].preset).toBe("companion")
    expect(engine.prompts[0].prompt).toContain("Organize")
  })

  test("rejects a body without a prompt, with usable detail", async () => {
    const { deps } = make()
    const response = await call(deps, "POST", "/tasks", { title: "no prompt" })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.details[0].field).toBe("prompt")
  })

  test("rejects an unknown mode rather than silently downgrading it", async () => {
    const { deps } = make()
    const response = await call(deps, "POST", "/tasks", { prompt: "x", mode: "yolo" })
    expect(response.status).toBe(400)
  })

  // M3.4 replaced "one at a time" with one lane plus a queue. The 409 survives
  // only for a full queue, which is a real refusal rather than "not right now".
  test("a second task queues instead of being refused", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)
    const second = await call(deps, "POST", "/tasks", { prompt: "something else" })

    expect(second.status).toBe(202)
    expect(await second.json()).toMatchObject({ queued: true, position: 1 })
    // Queued means queued: the engine has one session, not two.
    expect(engine.sessions).toHaveLength(1)
  })

  test("the queue is bounded, and a full one is still a 409", async () => {
    const { deps } = make()
    const first = await (await call(deps, "POST", "/tasks", CREATE)).json()
    for (let i = 0; i < Protocol.MAX_QUEUED; i++) {
      expect((await call(deps, "POST", "/tasks", { prompt: `queued ${i}` })).status).toBe(202)
    }
    const overflow = await call(deps, "POST", "/tasks", { prompt: "one too many" })
    expect(overflow.status).toBe(409)
    expect((await overflow.json()).activeTaskId).toBe(first.taskId)
  })

  test("a finished task hands the lane to the next one", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)
    await Bun.sleep(1)
    const second = await (await call(deps, "POST", "/tasks", { prompt: "next" })).json()
    expect(engine.sessions).toHaveLength(1)

    engine.complete()
    await Bun.sleep(5)

    expect(engine.sessions).toHaveLength(2)
    expect((await (await call(deps, "GET", `/tasks/${second.taskId}`)).json()).state).toBe("running")
  })

  test("cancelling the running task promotes the next, not the queue's ghost", async () => {
    const { deps } = make()
    const first = await (await call(deps, "POST", "/tasks", CREATE)).json()
    const second = await (await call(deps, "POST", "/tasks", { prompt: "next" })).json()

    await call(deps, "POST", `/tasks/${first.taskId}/cancel`, { reason: "user" })
    await Bun.sleep(5)

    expect((await (await call(deps, "GET", `/tasks/${first.taskId}`)).json()).state).toBe("cancelled")
    expect((await (await call(deps, "GET", `/tasks/${second.taskId}`)).json()).state).toBe("running")
  })

  test("cancelling a queued task never starts it", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)
    const second = await (await call(deps, "POST", "/tasks", { prompt: "next" })).json()

    await call(deps, "POST", `/tasks/${second.taskId}/cancel`, { reason: "user" })
    engine.complete()
    await Bun.sleep(5)

    expect((await (await call(deps, "GET", `/tasks/${second.taskId}`)).json()).state).toBe("cancelled")
    // One session ever: the cancelled one must not be promoted afterwards.
    expect(engine.sessions).toHaveLength(1)
  })

  test("health separates the lane from the queue", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)
    await call(deps, "POST", "/tasks", { prompt: "next" })

    expect(await (await call(deps, "GET", "/health")).json())
      .toMatchObject({ activeTasks: 1, queuedTasks: 1 })
  })

  test("narration preference rides on the task and its acceptance", async () => {
    const { deps } = make()
    const created = await (await call(deps, "POST", "/tasks", { ...CREATE, narration: "final" })).json()
    const snapshot = await (await call(deps, "GET", `/tasks/${created.taskId}`)).json()
    expect(snapshot.narration).toBe("final")

    const bad = await call(deps, "POST", "/tasks", { prompt: "x", narration: "shouty" })
    expect(bad.status).toBe(400)
  })
})

describe("auth", () => {
  test("without a token configured every route is open", async () => {
    const { deps } = make(undefined)
    expect((await call(deps, "GET", "/tasks")).status).toBe(200)
  })

  test("with a token configured, requests without it are rejected", async () => {
    const { deps } = make("s3cret")
    const denied = await call(deps, "GET", "/tasks")
    expect(denied.status).toBe(401)
    expect(denied.headers.get("www-authenticate")).toBe("Bearer")

    const wrong = await call(deps, "GET", "/tasks", undefined, { authorization: "Bearer nope!!" })
    expect(wrong.status).toBe(401)

    const ok = await call(deps, "GET", "/tasks", undefined, { authorization: "Bearer s3cret" })
    expect(ok.status).toBe(200)
  })

  test("health stays reachable without the token so the backend can detect us", async () => {
    const { deps } = make("s3cret")
    expect((await call(deps, "GET", "/health")).status).toBe(200)
  })
})

describe("approvals", () => {
  async function taskWithApproval(deps: Routes.Deps, risk: "low" | "high" = "low") {
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(1)
    engine.ask({
      id: "per_1",
      sessionId: engine.sessions[0].sessionId,
      permission: risk === "high" ? "bash" : "edit",
      patterns: risk === "high" ? ["rm -rf build"] : ["notes.md"],
      metadata: risk === "high" ? { command: "rm -rf build" } : {},
    })
    return taskId as string
  }

  test("surfaces an approval request with a speakable summary and risk", async () => {
    const { deps } = make()
    const taskId = await taskWithApproval(deps)
    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    expect(status.state).toBe("awaiting_approval")
    expect(status.pendingApprovals[0].summary).toBe("change notes.md")
    expect(status.pendingApprovals[0].risk).toBe("medium")
  })

  test("allow reaches the engine as `once` and returns the task to running", async () => {
    const { deps } = make()
    const taskId = await taskWithApproval(deps)
    const approvalId = (await (await call(deps, "GET", `/tasks/${taskId}`)).json()).pendingApprovals[0].approvalId

    const response = await call(deps, "POST", `/tasks/${taskId}/approvals/${approvalId}`, { decision: "allow", by: "voice" })
    expect(response.status).toBe(200)
    expect(engine.permissionReplies).toEqual([{ id: "per_1", reply: "once" }])
    expect((await (await call(deps, "GET", `/tasks/${taskId}`)).json()).state).toBe("running")
  })

  test("deny reaches the engine as `reject`", async () => {
    const { deps } = make()
    const taskId = await taskWithApproval(deps)
    const approvalId = (await (await call(deps, "GET", `/tasks/${taskId}`)).json()).pendingApprovals[0].approvalId
    await call(deps, "POST", `/tasks/${taskId}/approvals/${approvalId}`, { decision: "deny", by: "voice" })
    expect(engine.permissionReplies).toEqual([{ id: "per_1", reply: "reject" }])
  })

  test("silence denies — the façade owns the timeout the engine lacks", async () => {
    const { deps } = make()
    const taskId = await taskWithApproval(deps)
    expect(engine.permissionReplies).toHaveLength(0)

    clock.advance(120_000)
    await Bun.sleep(1)

    expect(engine.permissionReplies).toEqual([{ id: "per_1", reply: "reject" }])
    const resolved = audit.entries.find((entry) => entry.event === "approval.resolved")
    expect(resolved).toMatchObject({ decision: "deny", by: "timeout" })
  })

  test("a high-risk approval cannot be granted by voice alone (T7)", async () => {
    const { deps } = make()
    const taskId = await taskWithApproval(deps, "high")
    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    expect(status.pendingApprovals[0].risk).toBe("high")

    const spoken = await call(deps, "POST", `/tasks/${taskId}/approvals/${status.pendingApprovals[0].approvalId}`, {
      decision: "allow",
      by: "voice",
    })
    expect(spoken.status).toBe(409)
    expect(engine.permissionReplies).toHaveLength(0)

    const confirmed = await call(deps, "POST", `/tasks/${taskId}/approvals/${status.pendingApprovals[0].approvalId}`, {
      decision: "allow",
      by: "hud",
    })
    expect(confirmed.status).toBe(200)
    expect(engine.permissionReplies).toEqual([{ id: "per_1", reply: "once" }])
  })

  test("denying by voice is always allowed — only granting needs the HUD", async () => {
    const { deps } = make()
    const taskId = await taskWithApproval(deps, "high")
    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    const response = await call(deps, "POST", `/tasks/${taskId}/approvals/${status.pendingApprovals[0].approvalId}`, {
      decision: "deny",
      by: "voice",
    })
    expect(response.status).toBe(200)
  })

  test("an unknown approval is a 404, not a silent success", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    const response = await call(deps, "POST", `/tasks/${taskId}/approvals/a_nope`, { decision: "allow" })
    expect(response.status).toBe(404)
  })
})

describe("an approval is granted once, never remembered", () => {
  // The engine offers `always`, and the ask carries `always: ["*"]` — one such
  // reply would grant every tool on an MCP server for the session (ADR-0012).
  // The façade never sends it. This keeps that true by test rather than by
  // luck: a future "remember this" feature has to be a decision, not a slip.
  test("allow replies once and deny replies reject — nothing else", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(5)

    engine.ask({ id: "per_1", sessionId: engine.sessions[0]!.sessionId, permission: "bash", patterns: ["ls"], metadata: {} })
    engine.ask({ id: "per_2", sessionId: engine.sessions[0]!.sessionId, permission: "bash", patterns: ["ls"], metadata: {} })
    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()

    await call(deps, "POST", `/tasks/${taskId}/approvals/${status.pendingApprovals[0].approvalId}`, {
      decision: "allow",
      by: "hud",
    })
    await call(deps, "POST", `/tasks/${taskId}/approvals/${status.pendingApprovals[1].approvalId}`, {
      decision: "deny",
      by: "hud",
    })

    expect(engine.permissionReplies.map((reply) => reply.reply)).toEqual(["once", "reject"])
    expect(engine.permissionReplies.some((reply) => reply.reply === "always")).toBe(false)
  })
})

describe("questions", () => {
  test("round-trips an answer back to the engine", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(1)
    engine.question({
      id: "que_1",
      sessionId: engine.sessions[0].sessionId,
      questions: [{ question: "Which folder should I use?", options: [{ label: "Downloads" }, { label: "Desktop" }] }],
    })

    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    expect(status.state).toBe("awaiting_answer")
    expect(status.pendingQuestions[0].options).toEqual(["Downloads", "Desktop"])

    const response = await call(deps, "POST", `/tasks/${taskId}/answer`, {
      questionId: status.pendingQuestions[0].questionId,
      answer: "Downloads",
    })
    expect(response.status).toBe(200)
    expect(engine.questionReplies).toEqual([{ id: "que_1", answers: [["Downloads"]] }])
  })

  test("an unanswered question times out into a rejection", async () => {
    const { deps } = make()
    await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(1)
    engine.question({ id: "que_1", sessionId: engine.sessions[0].sessionId, questions: [{ question: "?" }] })
    clock.advance(120_000)
    await Bun.sleep(1)
    expect(engine.questionRejects).toEqual(["que_1"])
  })
})

describe("cancel and timebox", () => {
  test("cancel interrupts the engine and ends the task", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(1)

    const response = await call(deps, "POST", `/tasks/${taskId}/cancel`, { reason: "user" })
    expect(response.status).toBe(200)
    expect(engine.cancels).toEqual([engine.sessions[0].sessionId])
    expect((await (await call(deps, "GET", `/tasks/${taskId}`)).json()).state).toBe("cancelled")
  })

  test("cancelling a finished task is a 409, not a lie", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(1)
    await call(deps, "POST", `/tasks/${taskId}/cancel`, {})
    expect((await call(deps, "POST", `/tasks/${taskId}/cancel`, {})).status).toBe(409)
  })

  test("the timebox fails the task and interrupts the engine", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", { ...CREATE, timeboxMs: 5000 })).json()
    await Bun.sleep(1)

    clock.advance(5000)
    await Bun.sleep(1)

    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    expect(status.state).toBe("failed")
    expect(status.error).toBe("timebox")
    expect(engine.cancels).toHaveLength(1)
  })

  test("an engine crash becomes a recoverable task.failed", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(1)
    engine.crash("provider exploded")
    await Bun.sleep(1)
    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    expect(status.state).toBe("failed")
    expect(status.error).toContain("provider exploded")
  })
})

describe("event stream", () => {
  async function read(response: Response, expected: number, timeoutMs = 1500) {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const frames: string[] = []
    let buffer = ""
    const deadline = Date.now() + timeoutMs
    while (frames.length < expected && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(50).then(() => ({ value: undefined, done: false }) as const),
      ])
      if (chunk.value) buffer += decoder.decode(chunk.value, { stream: true })
      let index = buffer.indexOf("\n\n")
      while (index !== -1) {
        frames.push(buffer.slice(0, index))
        buffer = buffer.slice(index + 2)
        index = buffer.indexOf("\n\n")
      }
    }
    void reader.cancel()
    return frames
  }

  function envelopes(frames: string[]) {
    return frames
      .filter((frame) => frame.startsWith("id: "))
      .map((frame) => JSON.parse(frame.slice(frame.indexOf("data: ") + 6)) as Protocol.Envelope)
  }

  test("streams envelopes with per-task seq and a global cursor id", async () => {
    const { deps } = make()
    const response = (await call(deps, "GET", "/events")) as Response
    expect(response.headers.get("content-type")).toBe("text/event-stream")

    await call(deps, "POST", "/tasks", CREATE)
    const frames = await read(response, 3)
    const events = envelopes(frames)

    expect(events[0]).toMatchObject({ v: "hannah.v0", type: "task.accepted", seq: 1 })
    expect(events[1]).toMatchObject({ type: "task.started", seq: 2 })
    expect(frames.find((frame) => frame.startsWith("id: 1"))).toBeTruthy()
  })

  test("resumes from Last-Event-ID after a disconnect", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)
    await Bun.sleep(1)
    engine.emit("session.next.text.ended", { sessionID: engine.sessions[0].sessionId, text: "sorting files now" })

    // Reconnect having seen only the first event.
    const resumed = (await call(deps, "GET", "/events", undefined, { "last-event-id": "1" })) as Response
    const frames = await read(resumed, 3)

    expect(frames[0]).toContain("hannah.resume from=1")
    expect(frames[0]).toContain("truncated=false")
    const events = envelopes(frames)
    expect(events.map((event) => event.type)).toEqual(["task.started", "task.progress"])
  })

  test("a fresh connection replays nothing", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)
    await Bun.sleep(1)
    const response = (await call(deps, "GET", "/events")) as Response
    const frames = await read(response, 1, 300)
    expect(frames[0]).toContain("hannah.v0 connected")
    expect(envelopes(frames)).toHaveLength(0)
  })

  test("translated engine events use the hannah vocabulary, never engine names", async () => {
    const { deps } = make()
    const response = (await call(deps, "GET", "/events")) as Response
    await call(deps, "POST", "/tasks", CREATE)
    await Bun.sleep(1)
    const session = engine.sessions[0].sessionId
    engine.emit("session.next.tool.called", { sessionID: session, tool: "bash", input: { command: "ls ~/Downloads" } })
    engine.emit("todo.updated", {
      sessionID: session,
      todos: [{ content: "list files", status: "completed" }, { content: "make folders", status: "pending" }],
    })

    const events = envelopes(await read(response, 5))
    const types = events.map((event) => event.type)
    expect(types).toContain("task.tool")
    expect(types).toContain("task.plan")
    for (const type of types) expect(type.startsWith("task.")).toBe(true)
  })

  test("secrets never reach the stream or the audit log", async () => {
    const { deps } = make()
    const response = (await call(deps, "GET", "/events")) as Response
    await call(deps, "POST", "/tasks", CREATE)
    await Bun.sleep(1)
    engine.emit("session.next.text.ended", {
      sessionID: engine.sessions[0].sessionId,
      text: "found ANTHROPIC_API_KEY=sk-ant-api03-SECRETSECRETSECRETSECRET in the env",
    })

    const frames = await read(response, 3)
    expect(frames.join("")).not.toContain("SECRETSECRETSECRETSECRET")
    expect(JSON.stringify(audit.entries)).not.toContain("SECRETSECRETSECRETSECRET")
  })
})

describe("the answer path (M3.0)", () => {
  const LONG = [
    "Revisé los cinco repos de ~/Projects.",
    "",
    "- hannah-backend: limpio, 3 commits por delante de origin",
    "- hannah-frontend: 2 archivos sin commitear",
    "- motion-model: limpio",
    "- agent: rama de trabajo, 11 commits sin subir",
    "",
    "El único que necesita atención hoy es hannah-frontend.",
  ].join("\n")

  test("prose long enough to be an answer is emitted whole, not truncated", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)

    await Bun.sleep(5)
    const before = service.store.list()[0]!
    engine.emit("session.next.text.ended", { sessionID: engine.sessions[0]!.sessionId, text: LONG })

    const task = service.store.get(before.id)!
    // La progresión se recorta porque se habla; la respuesta no, porque se lee.
    expect(task.lastProgress!.length).toBeLessThanOrEqual(121)
    expect(task.answer).toContain("hannah-frontend: 2 archivos sin commitear")
    expect(task.answer).toContain("El único que necesita atención hoy")
  })

  test("a short status line stays progress and produces no answer", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)
    await Bun.sleep(5)
    engine.emit("session.next.text.ended", { sessionID: engine.sessions[0]!.sessionId, text: "moviendo archivos" })

    const task = service.store.list()[0]!
    expect(task.lastProgress).toBe("moviendo archivos")
    expect(task.answer).toBeUndefined()
  })

  test("the answer rides on task.completed and survives a reconcile", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)
    await Bun.sleep(5)
    const taskId = service.store.list()[0]!.id

    engine.emit("session.next.text.ended", { sessionID: engine.sessions[0]!.sessionId, text: LONG })
    engine.complete()
    await Bun.sleep(10)

    const snapshot = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    expect(snapshot.state).toBe("completed")
    expect(snapshot.answer).toContain("hannah-frontend")
  })

  test("an oversized answer is capped, not dropped", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)
    await Bun.sleep(5)
    engine.emit("session.next.text.ended", { sessionID: engine.sessions[0]!.sessionId, text: "x".repeat(9000) })

    const task = service.store.list()[0]!
    expect(task.answer!.length).toBeLessThanOrEqual(4000)
    expect(task.answer!.endsWith("…")).toBe(true)
  })

  test("the task language reaches the engine prompt", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", CREATE)
    await Bun.sleep(5)

    // `context.language` estaba guardado y no lo leía nadie: el agente
    // respondía en inglés preguntara quien preguntara.
    expect(engine.prompts[0]!.prompt).toContain("Organize ~/Downloads by file type")
    expect(engine.prompts[0]!.prompt).toContain("in es")
    expect(engine.prompts[0]!.prompt).toContain("Commands, code, file paths")
  })

  test("an English task gets no language note", async () => {
    const { deps } = make()
    await call(deps, "POST", "/tasks", { prompt: "list my repos", context: { language: "en" } })
    await Bun.sleep(5)

    expect(engine.prompts[0]!.prompt).toBe("list my repos")
    expect(engine.prompts[0]!.prompt).not.toContain("Write every message")
  })
})

describe("history over the wire (M3.5)", () => {
  test("a live task appears in history before it has finished", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(5)

    const { tasks } = await (await call(deps, "GET", "/history")).json()
    expect(tasks[0]).toMatchObject({ taskId, title: "ordenar descargas", state: "running" })
  })

  test("the limit is clamped, so a caller cannot ask for the whole log", async () => {
    const { deps } = make()
    // Not a validation error — an unbounded read is just quietly bounded.
    expect((await call(deps, "GET", "/history?limit=99999")).status).toBe(200)
    expect((await call(deps, "GET", "/history?limit=-4")).status).toBe(200)
    expect((await call(deps, "GET", "/history?limit=nonsense")).status).toBe(200)
  })

  test("a trail is empty rather than absent when nothing was recorded", async () => {
    const { deps } = make()
    const response = await call(deps, "GET", "/tasks/t_nothing/trail")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ taskId: "t_nothing", entries: [] })
  })

  test("history needs the token like everything else", async () => {
    const { deps } = make("secret")
    expect((await call(deps, "GET", "/history")).status).toBe(401)
    expect((await call(deps, "GET", "/tasks/t_1/trail")).status).toBe(401)
  })
})

describe("audit log", () => {
  test("records the decisions that matter, redacted", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(1)
    engine.ask({ id: "per_1", sessionId: engine.sessions[0].sessionId, permission: "edit", patterns: ["a.md"], metadata: {} })
    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    await call(deps, "POST", `/tasks/${taskId}/approvals/${status.pendingApprovals[0].approvalId}`, {
      decision: "allow",
      by: "hud",
    })

    const events = audit.entries.map((entry) => entry.event)
    expect(events).toContain("task.created")
    expect(events).toContain("task.approval.requested")
    expect(events).toContain("approval.resolved")
    const resolved = audit.entries.find((entry) => entry.event === "approval.resolved")
    expect(resolved).toMatchObject({ decision: "allow", by: "hud" })
  })
})

describe("engine errors are explained, not swallowed", () => {
  test("a tagged engine error keeps its message and name", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(1)
    engine.emit("session.error", {
      sessionID: engine.sessions[0].sessionId,
      error: { name: "ProviderAuthError", data: { message: "missing API key for anthropic" } },
    })
    await Bun.sleep(1)

    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    expect(status.state).toBe("failed")
    expect(status.error).toContain("ProviderAuthError")
    expect(status.error).toContain("missing API key")
  })

  test("a prompt that resolves without any work is FAILED, not completed", async () => {
    // Seen live the day Ox Alpha was withdrawn: the provider returned 404, the engine
    // resolved prompt() cleanly, and the façade emitted task.completed {summary:"done"} —
    // so the persona told the user the job was finished when nothing had happened.
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(1)
    engine.complete() // nothing was ever written, no tool ran
    await Bun.sleep(5)

    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    expect(status.state).toBe("failed")
    expect(status.error).toContain("no output")
    expect(audit.entries.map((entry) => entry.event)).toContain("task.failed")
  })

  test("an error with no message still says something useful", async () => {
    const { deps } = make()
    const { taskId } = await (await call(deps, "POST", "/tasks", CREATE)).json()
    await Bun.sleep(1)
    engine.emit("session.error", { sessionID: engine.sessions[0].sessionId, error: { name: "ProviderAuthError" } })
    await Bun.sleep(1)

    const status = await (await call(deps, "GET", `/tasks/${taskId}`)).json()
    expect(status.error).toContain("not signed in")
  })
})

describe("AUDIT block 2: the façade only talks to the backend", () => {
  test("a browser (Origin header) is refused even with the token", async () => {
    const { deps } = make()
    const res = await call(deps, "GET", "/history", undefined, { authorization: `Bearer ${deps.token}`, origin: "http://evil.example" })
    expect(res.status).toBe(403)
  })

  test("non-JSON bodies are refused", async () => {
    const { deps } = make()
    const res = await call(deps, "POST", "/tasks", { prompt: "hi" }, { authorization: `Bearer ${deps.token}`, "content-type": "text/plain" })
    expect(res.status).toBe(415)
  })

  test("a requested mode above the operator's maximum is refused", async () => {
    const { deps } = make()
    const res = await call(deps, "POST", "/tasks", { prompt: "hi", mode: "trusted-project" }, { authorization: `Bearer ${deps.token}` })
    expect(res.status).toBe(403)
  })

  test("a timeout cannot grant an approval", async () => {
    const { deps } = make()
    const res = await call(deps, "POST", "/tasks/nope/approvals/whatever", { decision: "allow", by: "timeout" }, { authorization: `Bearer ${deps.token}` })
    expect(res.status).toBe(400)
  })
})
