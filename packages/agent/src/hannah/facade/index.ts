export * as Hannah from "./index"

import { Effect } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import path from "path"
import { Global } from "@hannah/core/global"
import { Audit } from "./audit"
import { EngineAdapter } from "./engine"
import { Protocol } from "./protocol"
import { Routes } from "./routes"
import { Facade } from "./service"

export { Audit, Protocol, Routes, Facade, EngineAdapter }

/**
 * The `/hannah/v0` façade, mounted into the engine's router.
 *
 * Kept off the Effect HttpApi surface on purpose (ADR-0006): the façade is
 * versioned independently of the engine's 188-route API and must not leak into
 * its OpenAPI spec or generated SDK. A raw route is also the honest shape —
 * this is one prefix owned end to end by us.
 */

let instance: Facade.TaskService | undefined

/** Lazily built so nothing starts until the first request touches the façade. */
export function service(): Facade.TaskService {
  if (!instance) {
    instance = new Facade.TaskService(EngineAdapter.make(), {
      audit: Audit.fileSink(path.join(Global.Path.data, "audit")),
      defaultCwd: process.cwd(),
      // SECURITY §6 default. Enforced at construction, not by a command.
      retentionDays: Number(process.env["HANNAH_AGENT_AUDIT_RETENTION_DAYS"] ?? 30),
    })
  }
  return instance
}

/** Test seam: replace the singleton. */
export function setService(next: Facade.TaskService | undefined) {
  instance?.dispose()
  instance = next
}

export function token() {
  const value = process.env["HANNAH_AGENT_TOKEN"]
  return value && value.trim() ? value.trim() : undefined
}

export const route = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("*", `${Routes.PREFIX}/*`, (request) =>
      Effect.gen(function* () {
        // Effect gives the request path, not an absolute URL; `new Request`
        // needs an absolute one. The host is irrelevant — the façade routes on
        // the path — but it must parse.
        const url = new URL(request.url, `http://127.0.0.1${request.url.startsWith("/") ? "" : "/"}`)
        const method = request.method
        const body =
          method === "GET" || method === "HEAD" ? undefined : yield* Effect.orDie(request.text)

        const web = new Request(url, {
          method,
          headers: new Headers(request.headers as Record<string, string>),
          body,
        })

        const response = yield* Effect.promise(async () =>
          Routes.handle(web, { service: service(), token: token() }),
        )
        return HttpServerResponse.fromWeb(response)
      }),
    )
  }),
)
