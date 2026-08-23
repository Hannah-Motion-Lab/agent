import { run as runTui, type TuiInput } from "@hannah/tui"
import { Global } from "@hannah/core/global"
import { AppNodeBuilder } from "@hannah/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
