export * as BusEvents from "./bus-events"

import type { EngineEvent } from "./translate"

/**
 * Normalize what the engine's global bus actually carries into the event
 * vocabulary the façade translates.
 *
 * `translate.ts` was written against the runner's `session.next.*` events
 * (`session.next.tool.called`, `session.next.text.ended`, …). Those exist inside
 * the engine, but the bridge that feeds `GlobalBus` (`event-v2-bridge.ts`)
 * only sees what reaches it — and the runner's LLM events are projected by
 * `message-updater.ts` into the v1 message vocabulary before that: what
 * arrives on the bus is `message.part.updated` (a tool part changing status, a
 * text part getting its end time) and `message.updated` (the assistant message
 * with its token counts). Verified by tapping `/global/event` during a real
 * task: not a single `session.next.*` event, and the façade reported "the model
 * produced no output" for a task that had run three commands.
 *
 * This module is the shim. It is stateful on purpose: a v1 part is re-emitted
 * on every change, so "tool called" and "text ended" have to be derived once
 * per part, not once per update. Anything it does not recognize passes through
 * untouched, so `permission.asked`, `question.asked`, `todo.updated` and
 * `session.error` keep working exactly as before.
 */

type Props = Record<string, unknown>

const MAX_REMEMBERED = 4096

export type Normalizer = (event: EngineEvent) => EngineEvent[]

export function normalizer(): Normalizer {
  // Part ids whose "called" / "ended" / "done" transition was already emitted.
  const seen = new Set<string>()
  // Assistant message ids: only their text parts are the model's prose; the
  // user's prompt is a text part too and must never be narrated back.
  const assistant = new Set<string>()

  const once = (key: string): boolean => {
    if (seen.has(key)) return false
    if (seen.size >= MAX_REMEMBERED) seen.clear()
    seen.add(key)
    return true
  }

  return (event) => {
    const props = event.properties ?? {}

    if (event.type === "message.updated") {
      const info = rec(props.info)
      if (!info) return [event]
      if (info.role !== "assistant") return [event]
      const id = str(info.id)
      if (id) {
        if (assistant.size >= MAX_REMEMBERED) assistant.clear()
        assistant.add(id)
      }
      const tokens = rec(info.tokens)
      const output = typeof tokens?.output === "number" ? tokens.output : 0
      const sessionID = str(info.sessionID)
      if (!sessionID || output <= 0) return [event]
      return [event, { type: "hannah.tokens", properties: { sessionID, output } }]
    }

    if (event.type !== "message.part.updated") return [event]

    const part = rec(props.part)
    if (!part) return [event]
    const sessionID = str(part.sessionID)
    const partID = str(part.id)
    if (!sessionID || !partID) return [event]

    if (part.type === "text") {
      if (!assistant.has(str(part.messageID) ?? "")) return [event]
      const time = rec(part.time)
      const text = str(part.text)
      if (!time?.end || !text || !once(`${partID}:ended`)) return [event]
      return [event, { type: "session.next.text.ended", properties: { sessionID, text } }]
    }

    if (part.type === "tool") {
      const state = rec(part.state) ?? {}
      const tool = str(part.tool) ?? "tool"
      const callID = str(part.callID) ?? partID
      const status = str(state.status)
      const out: EngineEvent[] = [event]
      const called = () => {
        if (once(`${partID}:called`)) {
          out.push({
            type: "session.next.tool.called",
            properties: { sessionID, tool, callID, input: rec(state.input) ?? {} },
          })
        }
      }
      if (status === "running") called()
      if (status === "completed" && once(`${partID}:done`)) {
        called() // a fast tool can skip "running" on the bus; the count must not skip it
        const paths = Array.isArray(state.outputPaths) ? state.outputPaths : []
        out.push({ type: "session.next.tool.success", properties: { sessionID, tool, callID, outputPaths: paths } })
      }
      if (status === "error" && once(`${partID}:done`)) {
        called()
        const error = rec(state.error)
        const message = str(error?.message) ?? str(state.error) ?? `${tool} failed`
        out.push({ type: "session.next.tool.failed", properties: { sessionID, tool, callID, error: message } })
      }
      return out
    }

    return [event]
  }
}

function rec(value: unknown): Props | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Props) : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined
}
