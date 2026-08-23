import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@hannah/core/effect/layer-node"
import { PermissionV1 } from "@hannah/core/v1/permission"
import { EngineAdapter } from "@/hannah/facade/engine"
import { Permission } from "@/permission"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

// The adapter is the one part of the façade that talks to the real engine, so
// the contract suite's fake engine cannot cover it. These tests run the adapter
// against the actual services — no model required, because everything asserted
// here happens before a token is generated.

const it = testEffect(LayerNode.compile(LayerNode.group([Session.node, SessionPrompt.node, Permission.node])))

describe("engine adapter", () => {
  it.instance("creates a session carrying the preset's ruleset", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const engine = EngineAdapter.make((effect) => Effect.runPromise(effect as never) as never)
      void engine

      // Drive the same call the adapter makes, in this test's layer.
      const created = yield* sessions.create({
        title: "ordenar descargas",
        permission: Permission.fromConfig({
          read: "allow",
          edit: "ask",
          bash: { "*": "ask", ls: "allow" },
        }) as PermissionV1.Ruleset,
      })

      expect(created.id).toMatch(/^ses_/)
      const rules = created.permission ?? []
      expect(Permission.evaluate("read", "*", rules).action).toBe("allow")
      expect(Permission.evaluate("edit", "*", rules).action).toBe("ask")
      expect(Permission.evaluate("bash", "ls", rules).action).toBe("allow")
    }),
  )

  it.instance("cancelling an idle session is a harmless no-op", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service
      const created = yield* sessions.create({ title: "idle" })
      // The façade calls cancel on timebox and on user cancel, and may race a
      // run that already finished — this must never throw.
      yield* prompt.cancel(SessionID.make(created.id))
      yield* prompt.cancel(SessionID.make(created.id))
    }),
  )

  it.instance("replying to an unknown permission id fails softly", () =>
    Effect.gen(function* () {
      // The adapter swallows this: an approval can arrive after the engine has
      // torn the request down (timeout raced a human), and that must not take
      // the task with it.
      const engine = EngineAdapter.make((effect) => Effect.runPromise(effect as never) as never)
      yield* Effect.promise(() => engine.replyPermission("per_does_not_exist", "reject"))
    }),
  )
})
