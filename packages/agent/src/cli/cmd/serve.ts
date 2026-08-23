import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@hannah/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts the headless hannah-agent server",
  // Server loads instances per-request via x-hannah-agent-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.HANNAH_AGENT_SERVER_PASSWORD) {
      console.log("Warning: HANNAH_AGENT_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`hannah-agent server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
