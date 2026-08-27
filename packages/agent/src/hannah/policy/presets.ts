export * as PolicyPresets from "./presets"

import type { ConfigPermissionV1 } from "@hannah/core/v1/config/permission"
import { PolicyMCP } from "./mcp"

/**
 * The three permission presets (ADR-0010, SECURITY §4 layer 2), expressed as
 * engine permission config so they can be attached to a session at creation
 * time — that is what "switchable per task" means.
 *
 * These are convenience gates. The hard policy in ./index.ts runs first and
 * cannot be widened by any preset, so a bug here cannot open `~/.ssh` or
 * `sudo`.
 */

export const NAMES = ["companion", "trusted-project", "paranoid"] as const
export type Name = (typeof NAMES)[number]

/** Ordered from most to least restrictive: paranoid < companion < trusted-project. */
const WIDTH: Record<Name, number> = { paranoid: 0, companion: 1, "trusted-project": 2 }
/** Is `candidate` a wider (more permissive) preset than `ceiling`? */
export function wider(candidate: Name, ceiling: Name): boolean {
  return WIDTH[candidate] > WIDTH[ceiling]
}

export function isName(input: unknown): input is Name {
  return typeof input === "string" && (NAMES as readonly string[]).includes(input)
}

/**
 * Read-only shell commands that carry no side effects. Kept deliberately short:
 * every entry is a command whose worst outcome is showing the user something
 * they did not ask for.
 */
const SHELL_SAFE_LIST = [
  "ls",
  "pwd",
  "cat",
  "head",
  "tail",
  "wc",
  "file",
  "stat",
  "du",
  "df",
  "which",
  "echo",
  "date",
  "uname",
  "whoami",
  // `env`/`printenv` used to be here: they dump the process environment, API keys included.
  "git status",
  "git log",
  "git diff",
  "git show",
  "git branch",
  "git remote",
  "git config --get",
]

/** Commands that stay `ask` even where the preset otherwise allows shell. */
const SHELL_ALWAYS_ASK = [
  "rm",
  "rmdir",
  "mv",
  "chmod",
  "chown",
  "ln",
  "kill",
  "killall",
  "curl",
  "wget",
  "ssh",
  "scp",
  "rsync",
  "nc",
  "dd",
  "git push",
  "git reset",
  "git clean",
  "docker",
  "make install",
]

function shellRules(base: "allow" | "ask"): Record<string, ConfigPermissionV1.Action> {
  const rules: Record<string, ConfigPermissionV1.Action> = { "*": base }
  if (base === "ask") for (const command of SHELL_SAFE_LIST) rules[command] = "allow"
  // Dangerous shapes are re-asserted last so they win under last-match-wins.
  for (const command of SHELL_ALWAYS_ASK) rules[command] = "ask"
  return rules
}

/**
 * Build the engine permission config for a preset.
 *
 * `companion` — the default. Hannah is a companion poking at your files while
 * you talk to her: reading is free, anything that changes the world asks.
 *
 * `trusted-project` — you have pointed her at one project and want her to work
 * in it without narrating every write. Shell and edits run free *inside that
 * project*; the hard policy and the always-ask list still apply.
 *
 * `paranoid` — everything asks. For demos, for debugging, and for the days
 * when you want to watch every step.
 */
export function permissions(preset: Name): ConfigPermissionV1.Info {
  switch (preset) {
    case "companion":
      return {
        read: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        lsp: "allow",
        skill: "allow",
        todowrite: "allow",
        edit: "ask",
        task: "ask",
        question: "allow",
        external_directory: "ask",
        webfetch: "deny",
        websearch: "deny",
        bash: shellRules("ask"),
      }
    case "trusted-project":
      return {
        read: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        lsp: "allow",
        skill: "allow",
        todowrite: "allow",
        edit: "allow",
        task: "ask",
        question: "allow",
        // Still ask before touching anything outside the pinned project.
        external_directory: "ask",
        webfetch: "deny",
        websearch: "deny",
        bash: shellRules("allow"),
      }
    case "paranoid":
      return {
        read: "ask",
        glob: "ask",
        grep: "ask",
        list: "ask",
        lsp: "ask",
        skill: "ask",
        todowrite: "allow", // bookkeeping only; asking about it is pure noise
        edit: "ask",
        task: "ask",
        question: "allow",
        external_directory: "ask",
        webfetch: "deny",
        websearch: "deny",
        bash: { "*": "ask" },
      }
  }
}

/**
 * Risk tier for an approval request (SECURITY §4): the backend escalates `high`
 * to a HUD button instead of accepting a spoken "sí" (T7).
 */
export type Risk = "low" | "medium" | "high"

export function risk(permission: string, patterns: readonly string[], metadata?: Record<string, unknown>): Risk {
  // An MCP tool never lands in `low`. `low` is the tier a spoken "sí" can grant
  // (T7), and what makes that safe for `read` is that the denylist already
  // vetted the path. Nothing whose arguments policy cannot read has earned it.
  const server = PolicyMCP.serverOf(metadata)
  if (server) return PolicyMCP.risk(server)

  if (permission === "edit") {
    // Touching many files at once, or anything that reads like a mass rewrite.
    return patterns.length > 5 ? "high" : "medium"
  }
  if (permission === "bash") {
    const text = patterns.join(" ")
    if (/\b(rm|mv|dd|chmod|chown|kill|killall|truncate|shred|mkfs)\b/.test(text)) return "high"
    if (/\b(curl|wget|ssh|scp|rsync|nc|ncat|socat|git push)\b/.test(text)) return "high"
    // Interpreters and `-c`/`-e` one-liners are unbounded: whatever the regexes above would
    // catch can be spelled inside them. Same for output redirection and in-place deletes.
    if (/\b(python[23]?|node|deno|bun|perl|ruby|php|osascript|powershell|pwsh|bash|sh|zsh|eval|exec|source)\b/.test(text)) return "high"
    if (/(^|[^>])>{1,2}\s*[^&\s]|\|\s*(tee|xargs)\b/.test(text)) return "high"
    if (/\bfind\b.*\s-(delete|exec)\b|\bgit\s+(reset\s+--hard|clean|checkout\s+--|push\s+--force)/.test(text)) return "high"
    return "medium"
  }
  if (permission === "external_directory") return "high"
  if (permission === "webfetch" || permission === "websearch") return "high"
  if (permission === "task") return "medium"
  return "low"
}

export function safeList() {
  return [...SHELL_SAFE_LIST]
}

export function alwaysAsk() {
  return [...SHELL_ALWAYS_ASK]
}
