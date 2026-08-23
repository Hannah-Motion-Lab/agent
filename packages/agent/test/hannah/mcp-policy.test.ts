import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Policy } from "@/hannah/policy"
import { PolicyMCP } from "@/hannah/policy/mcp"
import { PolicyPresets } from "@/hannah/policy/presets"

// M3.3 / ADR-0012. An MCP tool is an opaque capability: the engine asks with
// `patterns: ["*"]` and no arguments, so the denylist and the command scanner
// have nothing to inspect. Trust is decided per server, before the call.

let saved: string | undefined

beforeEach(() => {
  saved = process.env["HANNAH_AGENT_MCP_ALLOW"]
  delete process.env["HANNAH_AGENT_MCP_ALLOW"]
})

afterEach(() => {
  if (saved === undefined) delete process.env["HANNAH_AGENT_MCP_ALLOW"]
  else process.env["HANNAH_AGENT_MCP_ALLOW"] = saved
})

const ask = (permission: string, metadata: Record<string, unknown> = {}) =>
  Policy.evaluate({ permission, patterns: ["*"], cwd: "/tmp", metadata })

describe("the allowlist decides, and it decides first", () => {
  test("a tool from an allowlisted server passes to the preset gates", () => {
    expect(ask("playwright_browser_navigate", { mcp: "playwright" })).toEqual({ action: "pass" })
  })

  test("a tool from any other server is denied, with a reason a person can hear", () => {
    const decision = ask("filesystem_read_file", { mcp: "filesystem" })
    expect(decision.action).toBe("deny")
    if (decision.action !== "deny") throw new Error("unreachable")
    expect(decision.layer).toBe("mcp-allowlist")
    expect(decision.rule).toBe("mcp:filesystem")
    expect(decision.reason).toContain("filesystem")
  })

  // La clave mezcla los dos nombres (`playwright_browser_navigate` podría ser
  // el servidor `playwright` o `playwright_browser`). Adivinar dentro de una
  // allowlist es un agujero, así que el servidor viaja en la metadata.
  test("the server is read from metadata, never guessed from the tool key", () => {
    expect(PolicyMCP.serverOf({ mcp: "playwright" })).toBe("playwright")
    expect(PolicyMCP.serverOf({})).toBeUndefined()
    expect(PolicyMCP.serverOf(undefined)).toBeUndefined()

    // Sin metadata no es una petición MCP y no se trata como tal.
    expect(ask("playwright_browser_navigate")).not.toMatchObject({ layer: "mcp-allowlist" })
  })

  test("an allowlisted MCP tool still cannot be widened by an approval", () => {
    // El denial es de la capa dura: no llega a ser una pregunta aprobable.
    const decision = ask("notion_search", { mcp: "notion" })
    expect(decision.action).toBe("deny")
  })

  test("HANNAH_AGENT_MCP_ALLOW adds a server for one run", () => {
    expect(PolicyMCP.allowed("scratch")).toBe(false)
    process.env["HANNAH_AGENT_MCP_ALLOW"] = "scratch, other"
    expect(PolicyMCP.allowed("scratch")).toBe(true)
    expect(PolicyMCP.allowed("other")).toBe(true)
  })
})

describe("risk tiering", () => {
  // `low` es el tramo que un "sí" hablado puede conceder (T7). Lo que hace
  // seguro ese camino para `read` es que el denylist ya validó la ruta.
  test("an MCP tool is never low risk", () => {
    for (const server of ["playwright", "anything-else"]) {
      const tier = PolicyPresets.risk("some_tool", ["*"], { mcp: server })
      expect(tier).not.toBe("low")
    }
  })

  test("network, filesystem or exec means high — no spoken grant", () => {
    expect(PolicyPresets.risk("playwright_browser_navigate", ["*"], { mcp: "playwright" })).toBe("high")
  })

  test("an unknown server is treated as the worst case", () => {
    expect(PolicyPresets.risk("x", ["*"], { mcp: "never-heard-of-it" })).toBe("high")

    process.env["HANNAH_AGENT_MCP_ALLOW"] = "scratch"
    expect(PolicyPresets.risk("x", ["*"], { mcp: "scratch" })).toBe("high")
  })

  test("non-MCP permissions are unaffected", () => {
    expect(PolicyPresets.risk("read", ["/tmp/a.txt"])).toBe("low")
    expect(PolicyPresets.risk("bash", ["rm -rf /tmp/x"])).toBe("high")
  })
})

describe("what the allowlist says about itself", () => {
  test("the shipped entry declares what connecting it hands over", () => {
    const playwright = PolicyMCP.describe().find((entry) => entry.server === "playwright")!
    expect(playwright.capabilities).toContain("browser")
    expect(playwright.capabilities).toContain("network")
    expect(playwright.why).toBeTruthy()
  })
})
