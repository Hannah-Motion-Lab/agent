export * as Routes from "./routes"

import { Macros } from "../macros"
import { Protocol } from "./protocol"
import type { Store } from "./store"
import type { TaskService } from "./service"

/**
 * `/hannah/v0` over plain HTTP, written against the Web `Request`/`Response`
 * types so the whole contract is testable without a socket — the fixture suite
 * calls `handle()` directly, and the mount in the engine's router is a thin
 * adapter over the same function.
 *
 * Deliberately *not* an Effect HttpApi group: the façade is versioned
 * separately from the engine's 188-route API (ADR-0006) and must not leak into
 * the engine's OpenAPI spec or SDK.
 */

export const PREFIX = "/hannah/v0"

export type Deps = {
  readonly service: TaskService
  /** When set, every request must carry `Authorization: Bearer <token>`. */
  readonly token?: string
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  })
}

/**
 * Constant-time-ish comparison. Bearer tokens are compared on every request and
 * a naive `===` leaks length and prefix through timing; this is cheap insurance
 * on a localhost socket that may one day not be localhost.
 */
function tokenMatches(expected: string, provided: string) {
  if (expected.length !== provided.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  return diff === 0
}

function authorized(request: Request, token?: string) {
  if (!token) return true
  const header = request.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? tokenMatches(token, match[1]) : false
}

/** A caller-supplied limit, clamped. An unbounded read of the log is a DoS. */
function clampLimit(raw: string | null, fallback: number, max: number) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}

export function handle(request: Request, deps: Deps): Response | Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.slice(PREFIX.length) || "/"

  // Health is unauthenticated on purpose: the backend polls it to decide
  // whether the sidecar exists at all, and a 401 there is indistinguishable
  // from "misconfigured" at exactly the moment you need the difference.
  if (path === "/health" && request.method === "GET") return json(deps.service.health())

  if (!authorized(request, deps.token)) {
    return json({ error: "unauthorized" }, 401, { "www-authenticate": "Bearer" })
  }

  if (path === "/events" && request.method === "GET") return events(request, deps)
  if (path === "/tasks" && request.method === "POST") return createTask(request, deps)
  if (path === "/history" && request.method === "GET") {
    const limit = clampLimit(url.searchParams.get("limit"), 25, 200)
    return json({ tasks: deps.service.history(limit) })
  }

  const trail = /^\/tasks\/([^/]+)\/trail$/.exec(path)
  if (trail && request.method === "GET") {
    // The recorded truth for one task, straight from the audit log. Redaction
    // already happened on the way in, so this is safe to show.
    return json({ taskId: trail[1], entries: deps.service.trail(trail[1]!, clampLimit(url.searchParams.get("limit"), 500, 2000)) })
  }

  if (path === "/macros" && request.method === "GET") {
    // The full picture, unavailable ones included with the reason. `health`
    // carries only the runnable list, because that is what the persona is
    // allowed to offer; this is for the operator asking "why not?".
    return json({
      macros: Macros.survey().map((entry) => ({
        id: entry.macro.id,
        summary: entry.macro.summary,
        result: entry.macro.result,
        skill: entry.macro.skill,
        available: entry.available,
        missing: entry.missing,
      })),
    })
  }

  if (path === "/tasks" && request.method === "GET") {
    return json({ tasks: deps.service.store.list().map((task) => deps.service.describe(task)) })
  }

  const task = /^\/tasks\/([^/]+)$/.exec(path)
  if (task && request.method === "GET") {
    const found = deps.service.store.get(task[1])
    return found ? json(deps.service.describe(found)) : json({ error: "task not found" }, 404)
  }

  const approval = /^\/tasks\/([^/]+)\/approvals\/([^/]+)$/.exec(path)
  if (approval && request.method === "POST") return resolveApproval(request, deps, approval[1], approval[2])

  const answer = /^\/tasks\/([^/]+)\/answer$/.exec(path)
  if (answer && request.method === "POST") return answerQuestion(request, deps, answer[1])

  const cancel = /^\/tasks\/([^/]+)\/cancel$/.exec(path)
  if (cancel && request.method === "POST") return cancelTask(request, deps, cancel[1])

  return json({ error: "not found" }, 404)
}

async function body(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function createTask(request: Request, deps: Deps) {
  const payload = await body(request)
  if (payload === undefined) return json({ error: "invalid JSON" }, 400)

  const parsed = Protocol.parseCreateTask(payload)
  if (!parsed.ok) return json({ error: "invalid request", details: parsed.errors }, 400)

  const result = await deps.service.create(parsed.value)
  if (!result.ok) {
    // Still a 409, but it now means "the queue is full", not "one at a time".
    return json({ error: "too many tasks queued", activeTaskId: result.activeTaskId }, 409)
  }
  return json(
    {
      taskId: result.task.id,
      title: result.task.title,
      // Present only when the task is waiting: its absence means it started.
      ...(result.position ? { queued: true, position: result.position } : {}),
    },
    202,
  )
}

async function resolveApproval(request: Request, deps: Deps, taskId: string, approvalId: string) {
  const payload = (await body(request)) as { decision?: unknown; by?: unknown } | undefined
  if (payload === undefined) return json({ error: "invalid JSON" }, 400)

  const decision = payload.decision
  if (decision !== "allow" && decision !== "deny") {
    return json({ error: "decision must be allow or deny" }, 400)
  }
  const by = payload.by === "hud" || payload.by === "timeout" ? payload.by : "voice"

  // A `high`-risk approval may not be granted by voice alone (SECURITY T7):
  // someone else in the room can say "sí". The HUD button is the second factor.
  const task = deps.service.store.get(taskId)
  const pending = task?.approvals.get(approvalId)
  if (pending && decision === "allow" && pending.risk === "high" && by === "voice") {
    return json(
      { error: "high-risk approvals require confirmation in the HUD", risk: pending.risk, approvalId },
      409,
    )
  }

  const ok = await deps.service.resolveApproval(taskId, approvalId, decision, by)
  return ok ? json({ ok: true }) : json({ error: "approval not found" }, 404)
}

async function answerQuestion(request: Request, deps: Deps, taskId: string) {
  const payload = (await body(request)) as { questionId?: unknown; answer?: unknown } | undefined
  if (payload === undefined) return json({ error: "invalid JSON" }, 400)
  const questionId = typeof payload.questionId === "string" ? payload.questionId : undefined
  const answer = typeof payload.answer === "string" ? payload.answer : undefined
  if (!questionId || answer === undefined) return json({ error: "questionId and answer are required" }, 400)

  const ok = await deps.service.answer(taskId, questionId, answer)
  return ok ? json({ ok: true }) : json({ error: "question not found" }, 404)
}

async function cancelTask(request: Request, deps: Deps, taskId: string) {
  const payload = (await body(request)) as { reason?: unknown } | undefined
  const reason = payload && typeof payload.reason === "string" ? payload.reason : "user"
  const ok = await deps.service.cancel(taskId, reason)
  if (ok) return json({ ok: true })
  return deps.service.store.get(taskId)
    ? json({ error: "task already finished" }, 409)
    : json({ error: "task not found" }, 404)
}

/**
 * The global SSE stream. One connection carries every task.
 *
 * `Last-Event-ID` (or `?after=`) replays from the façade's ring buffer — the
 * engine cannot do this, so a backend that reconnects mid-task would otherwise
 * miss the approval request it was about to speak. When the buffer has already
 * dropped part of the gap we say so explicitly with a `hannah.resume` comment
 * rather than pretending the replay was complete.
 */
function events(request: Request, deps: Deps): Response {
  const url = new URL(request.url)
  const header = request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? ""
  const after = Number.parseInt(header, 10)
  const cursor = Number.isFinite(after) && after > 0 ? after : 0

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          unsubscribe?.()
        }
      }

      const frame = (event: Store.StoredEvent) =>
        `id: ${event.cursor}\ndata: ${JSON.stringify(event.envelope)}\n\n`

      const replay = deps.service.store.since(cursor)
      if (cursor > 0) {
        send(`: hannah.resume from=${cursor} replayed=${replay.events.length} truncated=${replay.truncated}\n\n`)
      } else {
        send(`: hannah.v0 connected cursor=${deps.service.store.cursor()}\n\n`)
      }
      for (const event of replay.events) send(frame(event))

      unsubscribe = deps.service.store.subscribe((event) => send(frame(event)))

      // Keep-alive: proxies and idle detection kill silent connections, and a
      // task can legitimately think for minutes without emitting anything.
      const heartbeat = setInterval(() => send(`: keep-alive ${Date.now()}\n\n`), 15_000)

      request.signal?.addEventListener("abort", () => {
        clearInterval(heartbeat)
        unsubscribe?.()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
    cancel() {
      unsubscribe?.()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}
