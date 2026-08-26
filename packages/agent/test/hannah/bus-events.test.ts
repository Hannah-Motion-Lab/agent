import { describe, expect, test } from "bun:test"
import { BusEvents } from "@/hannah/facade/bus-events"

// Shapes copied from a real `/global/event` tap (Sonnet 5, 2026-08-26), trimmed
// to the fields the shim reads. The point of these tests is that the façade
// derives exactly one "called" / "ended" / "done" per part, no matter how many
// times the bus re-emits that part.

const SID = "ses_fc0b387a2ffeZSmzX0M71JcTMM"
const ASSISTANT = "msg_03f4c78fa001uGNk93yABtVFxG"
const USER = "msg_03f4c7864001PAlv6GRLFTyC69"

const assistantMessage = (tokens?: { output: number }) => ({
  type: "message.updated",
  properties: {
    info: { id: ASSISTANT, sessionID: SID, role: "assistant", ...(tokens ? { tokens: { input: 2, ...tokens } } : {}) },
  },
})

const textPart = (messageID: string, text: string, ended: boolean, id = "prt_text") => ({
  type: "message.part.updated",
  properties: {
    part: { id, sessionID: SID, messageID, type: "text", text, time: ended ? { start: 1, end: 2 } : { start: 1 } },
  },
})

const toolPart = (status: string, extra: Record<string, unknown> = {}, id = "prt_tool") => ({
  type: "message.part.updated",
  properties: {
    part: {
      id,
      sessionID: SID,
      messageID: ASSISTANT,
      type: "tool",
      tool: "bash",
      callID: "call_1",
      state: { status, input: { command: "ls" }, ...extra },
    },
  },
})

const types = (events: ReadonlyArray<{ type: string }>) => events.map((e) => e.type)

describe("bus event normalizer", () => {
  test("assistant prose ends once, however many times the part is re-emitted", () => {
    const norm = BusEvents.normalizer()
    norm(assistantMessage())
    expect(types(norm(textPart(ASSISTANT, "", false)))).toEqual(["message.part.updated"])
    const ended = norm(textPart(ASSISTANT, "moved 23 files", true))
    expect(types(ended)).toEqual(["message.part.updated", "session.next.text.ended"])
    expect(ended[1]?.properties).toEqual({ sessionID: SID, text: "moved 23 files" })
    expect(types(norm(textPart(ASSISTANT, "moved 23 files", true)))).toEqual(["message.part.updated"])
  })

  test("the user's own prompt is never turned into progress", () => {
    const norm = BusEvents.normalizer()
    norm(assistantMessage())
    expect(types(norm(textPart(USER, "organize my downloads", true)))).toEqual(["message.part.updated"])
  })

  test("a tool is called once and finished once", () => {
    const norm = BusEvents.normalizer()
    expect(types(norm(toolPart("pending")))).toEqual(["message.part.updated"])
    const running = norm(toolPart("running"))
    expect(types(running)).toEqual(["message.part.updated", "session.next.tool.called"])
    expect(running[1]?.properties).toMatchObject({ sessionID: SID, tool: "bash", callID: "call_1", input: { command: "ls" } })
    expect(types(norm(toolPart("running")))).toEqual(["message.part.updated"])
    const done = norm(toolPart("completed", { outputPaths: ["/tmp/a"], output: "117\n" }))
    expect(types(done)).toEqual(["message.part.updated", "session.next.tool.success"])
    expect(done[1]?.properties).toMatchObject({ tool: "bash", outputPaths: ["/tmp/a"], output: "117\n" })
    expect(types(norm(toolPart("completed", { outputPaths: ["/tmp/a"] })))).toEqual(["message.part.updated"])
  })

  test("a tool that skips 'running' on the bus is still counted as called", () => {
    const norm = BusEvents.normalizer()
    expect(types(norm(toolPart("completed")))).toEqual([
      "message.part.updated",
      "session.next.tool.called",
      "session.next.tool.success",
    ])
  })

  test("a failed tool carries the engine's message", () => {
    const norm = BusEvents.normalizer()
    const failed = norm(toolPart("error", { error: { name: "UnknownError", message: "permission denied" } }))
    expect(types(failed)).toEqual(["message.part.updated", "session.next.tool.called", "session.next.tool.failed"])
    expect(failed[2]?.properties).toMatchObject({ tool: "bash", error: "permission denied" })
  })

  test("assistant token counts become a façade-internal event", () => {
    const norm = BusEvents.normalizer()
    expect(types(norm(assistantMessage()))).toEqual(["message.updated"]) // no tokens yet
    const counted = norm(assistantMessage({ output: 4 }))
    expect(types(counted)).toEqual(["message.updated", "hannah.tokens"])
    expect(counted[1]?.properties).toEqual({ sessionID: SID, output: 4 })
  })

  test("everything else passes through untouched", () => {
    const norm = BusEvents.normalizer()
    for (const type of ["permission.asked", "question.asked", "todo.updated", "session.error", "session.idle"]) {
      const event = { type, properties: { sessionID: SID, id: "x" } }
      expect(norm(event)).toEqual([event])
    }
  })
})
