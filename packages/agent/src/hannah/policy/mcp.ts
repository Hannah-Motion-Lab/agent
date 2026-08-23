export * as PolicyMCP from "./mcp"

/**
 * MCP allowlisting (ADR-0012, SECURITY T6).
 *
 * An MCP tool is an **opaque capability**. The engine asks permission for it
 * with `patterns: ["*"]` and no arguments, so the path denylist and the command
 * scanner — the two things that make `read` and `bash` safe — have nothing to
 * inspect. `~/.ssh` is protected from `cat` and not from a filesystem MCP
 * server, and no amount of per-call policy can change that.
 *
 * The only honest place to decide is therefore the **server**, before it is
 * ever reachable: an MCP server is either trusted with a class of capability or
 * it is not connected at all. That is what this module holds.
 */

export type Capability = "browser" | "network" | "filesystem" | "exec" | "read-only"

export type Entry = {
  readonly server: string
  /** What connecting this server hands over. Drives risk, and the ADR review. */
  readonly capabilities: readonly Capability[]
  readonly why: string
}

/**
 * The allowlist. Adding an entry is an ADR-level decision, not a config change:
 * a server here can do things the policy layer cannot see.
 */
const ALLOWED: readonly Entry[] = [
  {
    server: "playwright",
    capabilities: ["browser", "network"],
    why: "browser automation — the first server, ADR-0012. Reaches the network and whatever the browser is already logged into.",
  },
]

/** Extra servers for a run, comma-separated. Same posture: opt-in, explicit. */
function fromEnv(): Entry[] {
  const raw = process.env["HANNAH_AGENT_MCP_ALLOW"]
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((server) => ({
      server,
      // Unknown provenance means unknown capability. Assume the worst so the
      // risk tier does not quietly drop to something a spoken "sí" can grant.
      capabilities: ["network", "filesystem", "exec"] as const,
      why: "allowed for this run via HANNAH_AGENT_MCP_ALLOW",
    }))
}

export function entries(): Entry[] {
  return [...ALLOWED, ...fromEnv()]
}

export function find(server: string): Entry | undefined {
  return entries().find((entry) => entry.server === server)
}

export function allowed(server: string) {
  return Boolean(find(server))
}

/**
 * The server behind a permission request, if it is an MCP tool at all.
 *
 * Read from `metadata.mcp`, which `session/tools.ts` stamps on the ask. It is
 * not derived from the tool key on purpose: the key mangles both names together
 * (`playwright_browser_navigate`), so splitting it back apart is a guess, and a
 * guess in an allowlist is a hole.
 */
export function serverOf(metadata: Record<string, unknown> | undefined): string | undefined {
  const value = metadata?.["mcp"]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * Risk for an MCP tool. Never `low`.
 *
 * `low` is what the backend lets a spoken "sí" grant (T7). Nothing whose
 * arguments policy cannot read belongs in that tier — the whole reason the
 * spoken path is safe for `read` is that the denylist already vetted the path.
 */
export function risk(server: string): "medium" | "high" {
  const entry = find(server)
  if (!entry) return "high"
  const dangerous: readonly Capability[] = ["network", "filesystem", "exec"]
  return entry.capabilities.some((capability) => dangerous.includes(capability)) ? "high" : "medium"
}

/** For `GET /hannah/v0/macros`-style diagnostics and the docs. */
export function describe() {
  return entries().map((entry) => ({
    server: entry.server,
    capabilities: [...entry.capabilities],
    why: entry.why,
  }))
}
