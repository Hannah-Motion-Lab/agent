export * as EngineAdapter from "./engine"

import { Effect } from "effect"
import { PermissionV1 } from "@hannah/core/v1/permission"
import { GlobalBus } from "@/bus/global"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { InstallationVersion } from "@hannah/core/installation/version"
import { AppRuntime, type AppServices } from "@/effect/app-runtime"
import { InstanceStore } from "@/project/instance-store"
import { PolicyPresets } from "../policy/presets"
import type { EnginePort, EngineEvent, PermissionAsk, QuestionAsk } from "./service"

/**
 * Binds the façade's `EnginePort` to the real engine services.
 *
 * Everything here is adapter work: Effect in, promises out. The interesting
 * logic lives in service.ts, which is why that file is testable without a
 * model. The one policy decision made here is that a task's preset becomes the
 * session's permission ruleset at creation time — which is what "presets are
 * switchable per task" means in practice (ADR-0010).
 */
/** How an Effect is executed. Injectable so the adapter is testable against a
 * test layer instead of the process-wide app runtime. */
export type Runner = <A, E>(effect: Effect.Effect<A, E, AppServices>) => Promise<A>

export const defaultRunner: Runner = (effect) => AppRuntime.runPromise(effect as never) as never

export function make(run: Runner = defaultRunner): EnginePort {
  /**
   * Engine services are *instance-scoped*: sessions, permissions and the event
   * bus all resolve through the project instance for a directory, and calling
   * them without one dies with "InstanceRef not provided". The HTTP handlers get
   * this from the `x-hannah-agent-directory` header via middleware; the façade
   * has no such header, so it enters the instance for the task's own cwd.
   */
  const inDirectory = <A, E>(directory: string, effect: Effect.Effect<A, E, AppServices>): Promise<A> =>
    run(
      Effect.gen(function* () {
        const store = yield* InstanceStore.Service
        return yield* store.provide({ directory }, effect)
      }) as never,
    ) as Promise<A>

  // Sessions are keyed by directory so later calls (prompt, cancel, replies)
  // re-enter the same instance the session was created in.
  const directories = new Map<string, string>()

  return {
    version: () => InstallationVersion,

    createSession: async (input) => {
      const info = await inDirectory(
        input.cwd,
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          return yield* sessions.create({
            title: input.title,
            // The preset is attached to the session, so every tool call inside
            // this task is gated by the mode the persona chose for it.
            permission: Permission.fromConfig(PolicyPresets.permissions(input.preset)) as PermissionV1.Ruleset,
          })
        }),
      )
      directories.set(info.id, input.cwd)
      return { sessionId: info.id }
    },

    prompt: async (input) => {
      await inDirectory(
        directories.get(input.sessionId) ?? process.cwd(),
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          yield* prompt.prompt({
            sessionID: SessionID.make(input.sessionId),
            parts: [{ type: "text", text: input.prompt }],
          })
        }),
      )
    },

    cancel: async (sessionId) => {
      await inDirectory(
        directories.get(sessionId) ?? process.cwd(),
        Effect.gen(function* () {
          const prompt = yield* SessionPrompt.Service
          yield* prompt.cancel(SessionID.make(sessionId))
        }),
      )
      directories.delete(sessionId)
    },

    replyPermission: async (id, reply, sessionId) => {
      await inDirectory(
        directories.get(sessionId ?? "") ?? process.cwd(),
        Effect.gen(function* () {
          const permission = yield* Permission.Service
          yield* permission.reply({ requestID: PermissionV1.ID.make(id), reply })
        }).pipe(Effect.catchCause(() => Effect.void)),
      ).catch(() => {
        // A reply can arrive after the engine tore the request down (a timeout
        // raced a human, or the instance was disposed). Never let that failure
        // propagate into the task.
      })
    },

    replyQuestion: async (id, answers, sessionId) => {
      await inDirectory(
        directories.get(sessionId ?? "") ?? process.cwd(),
        Effect.gen(function* () {
          const question = yield* Question.Service
          yield* question.reply({ requestID: Question.Request.fields.id.make(id), answers })
        }).pipe(Effect.catchCause(() => Effect.void)),
      ).catch(() => {
        // A reply can arrive after the engine tore the request down (a timeout
        // raced a human, or the instance was disposed). Never let that failure
        // propagate into the task.
      })
    },

    rejectQuestion: async (id, sessionId) => {
      await inDirectory(
        directories.get(sessionId ?? "") ?? process.cwd(),
        Effect.gen(function* () {
          const question = yield* Question.Service
          yield* question.reject(Question.Request.fields.id.make(id))
        }).pipe(Effect.catchCause(() => Effect.void)),
      ).catch(() => {
        // A reply can arrive after the engine tore the request down (a timeout
        // raced a human, or the instance was disposed). Never let that failure
        // propagate into the task.
      })
    },

    subscribe: (listener) => subscribeBus(listener),
    onPermission: (listener) => subscribeAsks("permission.asked", listener as (ask: unknown) => void),
    onQuestion: (listener) => subscribeAsks("question.asked", listener as (ask: unknown) => void),
  }
}

/**
 * Tap the engine's event bus.
 *
 * `GlobalBus` is the process-wide emitter every instance publishes into
 * (`event-v2-bridge.ts`), so it needs no instance scoping and cannot silently
 * fail to attach — which an Effect-side subscription can, since the bridge
 * service only exists inside an instance context.
 */
function subscribeBus(listener: (event: EngineEvent) => void) {
  const handler = (event: { payload?: { type?: string; properties?: unknown } }) => {
    const type = event.payload?.type
    if (typeof type !== "string") return
    listener({ type, properties: (event.payload?.properties ?? {}) as Record<string, unknown> })
  }
  GlobalBus.on("event", handler)
  return () => void GlobalBus.off("event", handler)
}

function subscribeAsks(type: string, listener: (ask: unknown) => void) {
  return subscribeBus((event) => {
    if (event.type !== type) return
    const props = event.properties
    if (type === "permission.asked") {
      listener({
        id: String(props.id),
        sessionId: String(props.sessionID),
        permission: String(props.permission),
        patterns: Array.isArray(props.patterns) ? (props.patterns as string[]) : [],
        metadata: (props.metadata ?? {}) as Record<string, unknown>,
      } satisfies PermissionAsk)
      return
    }
    listener({
      id: String(props.id),
      sessionId: String(props.sessionID),
      questions: Array.isArray(props.questions) ? (props.questions as QuestionAsk["questions"]) : [],
    } satisfies QuestionAsk)
  })
}
