export * as Policy from "./index"

import { PolicyCommands } from "./commands"
import { PolicyMCP } from "./mcp"
import { PolicyPaths } from "./paths"
import { PolicyPresets } from "./presets"
import { PolicyRedact } from "./redact"

export { PolicyCommands, PolicyMCP, PolicyPaths, PolicyPresets, PolicyRedact }
export type { Finding } from "./commands"
export type { Name as Preset, Risk } from "./presets"

/**
 * The hard policy layer (SECURITY §4 layer 1).
 *
 * Evaluated *before* the preset gates on every permission request, including
 * ones a preset would auto-allow. A `deny` here is final: it is not shown to
 * the model as a negotiable choice, and no approval — voice, HUD, or config —
 * can unlock it. That is the whole point. The user cannot meaningfully consent
 * to "read my ssh key" mid-sentence, and prompt injection (T1) aims squarely
 * at getting them to.
 */

export type Request = {
  /** Engine permission id: "read", "edit", "bash", "external_directory", … */
  readonly permission: string
  /** Patterns the engine is asking about: file paths, or shell command lines. */
  readonly patterns: readonly string[]
  /** Working directory the task runs in; anchors relative paths. */
  readonly cwd: string
  /** Workspace roots from the profile. `["/"]` (D3) makes the fence inert. */
  readonly roots?: readonly string[]
  /** Extra context the tool supplied (shell puts the raw command here). */
  readonly metadata?: Record<string, unknown>
}

export type Decision =
  | { readonly action: "pass" }
  | {
      readonly action: "deny"
      /** One sentence, safe to narrate to the user. */
      readonly reason: string
      /** Machine-readable rule id for the audit log. */
      readonly rule: string
      readonly layer: "sensitive-path" | "danger-command" | "workspace-root" | "mcp-allowlist"
    }

/** Permissions whose patterns are filesystem paths rather than command lines. */
const PATH_PERMISSIONS = new Set(["read", "edit", "write", "glob", "grep", "list", "external_directory", "patch"])

function commandsFrom(request: Request): string[] {
  const found: string[] = []
  const raw = request.metadata?.["command"]
  if (typeof raw === "string" && raw.trim()) found.push(raw)
  // Shell asks with the command source as its patterns, so scan those too —
  // metadata is a convenience, not a guarantee.
  for (const pattern of request.patterns) if (pattern && pattern !== "*") found.push(pattern)
  return found
}

/**
 * Evaluate the hard policy. Returns `pass` when the request should continue to
 * the preset gates — `pass` is *not* an approval.
 */
export function evaluate(request: Request): Decision {
  const cwd = request.cwd || process.cwd()

  // MCP first, because for an MCP tool none of the checks below can run: the
  // engine asks with `patterns: ["*"]` and no arguments, so there is no path to
  // classify and no command to scan. The decision has to be about the server
  // (ADR-0012), and it has to be made before anything else looks at this and
  // concludes there is nothing to object to.
  const server = PolicyMCP.serverOf(request.metadata)
  if (server) {
    if (!PolicyMCP.allowed(server)) {
      return {
        action: "deny",
        reason: `I'm not allowed to use the ${server} integration.`,
        rule: `mcp:${server}`,
        layer: "mcp-allowlist",
      }
    }
    return { action: "pass" }
  }

  if (request.permission === "bash" || request.permission === "shell") {
    for (const command of commandsFrom(request)) {
      const [finding] = PolicyCommands.scan(command)
      if (finding) {
        return {
          action: "deny",
          reason: `I won't run that — ${finding.reason}.`,
          rule: finding.rule,
          layer: "danger-command",
        }
      }
    }
    // A shell command may still name a protected file (`cat ~/.ssh/id_rsa`).
    for (const command of commandsFrom(request)) {
      for (const token of PolicyCommands.tokenize(command)) {
        if (!token || token.startsWith("-")) continue
        if (!token.includes("/") && !token.startsWith("~") && !token.startsWith(".")) continue
        const verdict = PolicyPaths.classify(token, cwd)
        if (verdict.sensitive) {
          return {
            action: "deny",
            reason: `I won't touch that path — ${verdict.reason}.`,
            rule: verdict.rule,
            layer: "sensitive-path",
          }
        }
      }
    }
    return { action: "pass" }
  }

  if (PATH_PERMISSIONS.has(request.permission)) {
    for (const pattern of request.patterns) {
      if (!pattern || pattern === "*") continue
      const verdict = PolicyPaths.classify(pattern, cwd)
      if (verdict.sensitive) {
        return {
          action: "deny",
          reason: `I won't touch that path — ${verdict.reason}.`,
          rule: verdict.rule,
          layer: "sensitive-path",
        }
      }
      const roots = request.roots ?? []
      if (roots.length && !PolicyPaths.insideRoots(pattern, roots, cwd)) {
        return {
          action: "deny",
          reason: "That path is outside the folders I'm allowed to work in.",
          rule: "workspace-roots",
          layer: "workspace-root",
        }
      }
    }
  }

  return { action: "pass" }
}

/** Convenience for callers that only need a boolean. */
export function denies(request: Request) {
  return evaluate(request).action === "deny"
}
