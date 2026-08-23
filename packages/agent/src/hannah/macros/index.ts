export * as Macros from "./index"

import { HannahEnv } from "../env"
import { PolicyWorkspaces } from "../policy/workspaces"
import { MacroCatalog, type Macro, type Requirement } from "./catalog"

export type { Macro, Requirement }
export const all = MacroCatalog.MACROS
export const byId = MacroCatalog.byId

export type Availability = {
  readonly macro: Macro
  readonly available: boolean
  /** Why not, in words a person could hear. Empty when available. */
  readonly missing: readonly string[]
}

function unmet(requirement: Requirement): string | undefined {
  if (requirement.kind === "command") {
    return HannahEnv.whichFirst(requirement.any) ? undefined : requirement.why
  }
  const roots = PolicyWorkspaces.list()
  return roots.some((root) => root.id === requirement.id) ? undefined : requirement.why
}

/** Every macro with a verdict — the full picture, for docs and diagnostics. */
export function survey(): Availability[] {
  return MacroCatalog.MACROS.map((macro) => {
    const missing = macro.requires.map(unmet).filter((reason): reason is string => Boolean(reason))
    return { macro, available: missing.length === 0, missing }
  })
}

/**
 * Only what this machine can actually do.
 *
 * This is what the persona is shown. A macro missing its tool is not listed at
 * all — she cannot offer it, so she cannot fail at it. Degradation happens in
 * the catalog, exactly as it happens in the prompt for the `[TASK:]` tag.
 */
export function available(): Macro[] {
  return survey()
    .filter((entry) => entry.available)
    .map((entry) => entry.macro)
}

/** The compact shape the backend puts in the persona's system prompt. */
export function describe() {
  return available().map((macro) => ({ id: macro.id, summary: macro.summary, result: macro.result }))
}

/**
 * Guess which macro a task prompt is asking for.
 *
 * **A match is a hint, not a gate.** Hitting one loads better instructions;
 * missing one costs quality, not correctness — the agent still does the job
 * from the prompt alone. Matching the *wrong* one, on the other hand, loads
 * instructions for a different job. So this is tuned for precision: an alias
 * matches when all of its words appear, as whole words, anywhere in the prompt.
 *
 * Word-set rather than phrase matching, because the phrase almost never
 * survives contact with a real request: "Organize ~/Downloads into folders by
 * file type" contains both words of `organize downloads` and none of the
 * literal string.
 *
 * Only *available* macros are candidates — matching an unavailable one would
 * load a skill for a tool that is not installed.
 */
export function match(prompt: string): Macro | undefined {
  if (!prompt) return undefined
  const text = PolicyWorkspaces.normalize(prompt)
  let best: { macro: Macro; score: number } | undefined
  for (const macro of available()) {
    for (const alias of macro.aliases) {
      const words = alias.split(/\s+/).filter(Boolean)
      if (!words.every((word) => hasWord(text, word))) continue
      // A more specific alias wins: more words first, then more characters.
      const score = words.length * 1000 + alias.length
      if (!best || score > best.score) best = { macro, score }
    }
  }
  return best?.macro
}

function hasWord(text: string, word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![\\p{L}\\d])${escaped}(?![\\p{L}\\d])`, "u").test(text)
}

/**
 * Resolve the macro for a task: an explicit id if the caller knew one, else a
 * guess from the prompt. An explicit id that is *unavailable* resolves to
 * nothing rather than to the macro — the caller's catalog was stale, and
 * running without the skill is better than running against a missing tool.
 */
export function resolve(input: { macro?: string; prompt?: string }): Macro | undefined {
  if (input.macro) {
    const named = MacroCatalog.byId(input.macro)
    if (named && available().some((macro) => macro.id === named.id)) return named
    return undefined
  }
  return match(input.prompt ?? "")
}
