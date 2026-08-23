export * as HannahEnv from "./env"

import fs from "fs"
import path from "path"

/**
 * What this machine can actually do.
 *
 * Capability detection is a recurring need across the Hannah layer — the trash
 * tool, the macro requirements — and it earns a single home because the rule is
 * always the same: **never offer something that is not installed.** A macro
 * that fails halfway through is worse than one that was never offered, because
 * by then Hannah has already said she would do it.
 */

const cache = new Map<string, string | null>()

/** Absolute path to `command` on `PATH`, or undefined. No subprocess. */
export function which(command: string): string | undefined {
  if (command.includes(path.sep)) {
    return isExecutable(command) ? command : undefined
  }

  const hit = cache.get(command)
  if (hit !== undefined) return hit ?? undefined

  const dirs = (process.env["PATH"] ?? "").split(path.delimiter).filter(Boolean)
  const found = dirs.map((dir) => path.join(dir, command)).find(isExecutable)
  cache.set(command, found ?? null)
  return found
}

/** The first of `commands` that exists — for "any editor will do" checks. */
export function whichFirst(commands: readonly string[]): string | undefined {
  for (const command of commands) {
    const found = which(command)
    if (found) return command
  }
  return undefined
}

function isExecutable(candidate: string) {
  try {
    const stat = fs.statSync(candidate)
    // The mode check is what separates "a file called git" from "the git binary".
    return stat.isFile() && (stat.mode & 0o111) !== 0
  } catch {
    return false
  }
}

/** Test seam: forget what was found on PATH. */
export function reset() {
  cache.clear()
}
