export * as PolicyWorkspaces from "./workspaces"

import fs from "fs"
import os from "os"
import path from "path"
import { PolicyPaths } from "./paths"

/**
 * Where Hannah works.
 *
 * This is **ergonomics, not security**. D3 set the workspace root to `/`, so a
 * root here grants nothing — the sensitive-path denylist and the preset gates
 * are the whole boundary (SECURITY §4). What this buys is a task that runs in
 * the right place: until M3.1 every task inherited `process.cwd()`, so
 * "ordena mis descargas" and "revisa mis repos" both ran wherever the sidecar
 * happened to be launched from.
 *
 * Roots are also the vocabulary the persona is given, so she can say *where*
 * she is about to work instead of guessing, and cannot offer to tidy a folder
 * that does not exist on this machine.
 */

export type Workspace = {
  /** Stable id used on the wire and in the persona prompt. */
  readonly id: string
  readonly path: string
  /** Words that mean this place, in either language the avatar speaks. */
  readonly aliases: readonly string[]
}

/**
 * Defaults are the XDG user directories, because they are what a person means
 * by "my downloads". Only directories that actually exist are offered: a root
 * Hannah cannot reach is worse than no root, since she would promise to use it.
 */
const DEFAULTS: ReadonlyArray<{ id: string; xdg?: string; dir: string; aliases: string[] }> = [
  { id: "downloads", xdg: "XDG_DOWNLOAD_DIR", dir: "Downloads", aliases: ["downloads", "descargas", "bajadas"] },
  { id: "documents", xdg: "XDG_DOCUMENTS_DIR", dir: "Documents", aliases: ["documents", "documentos", "docs"] },
  { id: "desktop", xdg: "XDG_DESKTOP_DIR", dir: "Desktop", aliases: ["desktop", "escritorio"] },
  { id: "pictures", xdg: "XDG_PICTURES_DIR", dir: "Pictures", aliases: ["pictures", "images", "imagenes", "fotos", "capturas", "screenshots"] },
  { id: "music", xdg: "XDG_MUSIC_DIR", dir: "Music", aliases: ["music", "musica", "canciones"] },
  { id: "videos", xdg: "XDG_VIDEOS_DIR", dir: "Videos", aliases: ["videos", "peliculas"] },
  { id: "projects", dir: "Projects", aliases: ["projects", "proyectos", "repos", "repositorios", "code", "codigo"] },
]

/** Strip accents and case so "descargas" and "Descargas" are one word. */
export function normalize(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function existingDirectory(candidate: string) {
  try {
    return fs.statSync(candidate).isDirectory() ? fs.realpathSync(candidate) : undefined
  } catch {
    return undefined
  }
}

function expand(input: string) {
  const trimmed = input.trim()
  if (trimmed === "~") return os.homedir()
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2))
  return trimmed
}

/**
 * Parse `HANNAH_AGENT_WORKSPACES`: `id=path` pairs separated by commas.
 * An entry whose directory does not exist is dropped, not invented.
 */
function fromEnv(value: string): Workspace[] {
  const result: Workspace[] = []
  for (const entry of value.split(",")) {
    const [rawId, ...rest] = entry.split("=")
    const id = normalize((rawId ?? "").trim())
    const target = rest.join("=").trim()
    if (!id || !target) continue
    const resolved = existingDirectory(expand(target))
    if (!resolved) continue
    const known = DEFAULTS.find((entry) => entry.id === id)
    result.push({
      id,
      path: resolved,
      aliases: unique([id, normalize(path.basename(resolved)), ...(known?.aliases ?? [])]),
    })
  }
  return result
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

let cached: Workspace[] | undefined

/** The configured roots. Computed once — the filesystem does not move mid-run. */
export function list(): Workspace[] {
  if (cached) return cached
  const configured = process.env["HANNAH_AGENT_WORKSPACES"]
  if (configured && configured.trim()) {
    cached = fromEnv(configured)
    return cached
  }

  const home = os.homedir()
  cached = DEFAULTS.flatMap((entry) => {
    const fromXdg = entry.xdg ? process.env[entry.xdg] : undefined
    const resolved =
      (fromXdg && existingDirectory(expand(fromXdg))) || existingDirectory(path.join(home, entry.dir))
    if (!resolved) return []
    return [{ id: entry.id, path: resolved, aliases: unique([entry.id, normalize(entry.dir), ...entry.aliases]) }]
  })
  return cached
}

/** Test seam: forget the discovered roots. */
export function reset() {
  cached = undefined
}

/** A directory is usable if it exists and is not inside the denylist. */
export function usable(candidate: string, cwd: string): string | undefined {
  const resolved = PolicyPaths.resolve(candidate, cwd)
  if (PolicyPaths.classify(resolved, cwd).sensitive) return undefined
  return existingDirectory(resolved)
}

/**
 * A path written literally in the prompt. Only absolute or `~`-anchored ones
 * count: a bare word like "build" is far more likely to be prose than a
 * directory, and guessing wrong sends the task somewhere unexpected.
 */
function pathInPrompt(prompt: string, cwd: string): string | undefined {
  const matches = prompt.match(/(?:~|\/)[\w.~\-/]*[\w~]/g) ?? []
  for (const raw of matches) {
    // Walk up: "~/Downloads/report.pdf" should land in ~/Downloads.
    let candidate = expand(raw)
    for (let i = 0; i < 8; i++) {
      const found = usable(candidate, cwd)
      if (found) return found
      const parent = path.dirname(candidate)
      if (parent === candidate) break
      candidate = parent
    }
  }
  return undefined
}

/** The first root whose name is spoken in the prompt, as a whole word. */
function aliasInPrompt(prompt: string, roots: readonly Workspace[]): Workspace | undefined {
  const text = normalize(prompt)
  let best: { workspace: Workspace; at: number; length: number } | undefined
  for (const workspace of roots) {
    for (const alias of workspace.aliases) {
      const at = text.search(new RegExp(`(?<![\\p{L}\\d])${escape(alias)}(?![\\p{L}\\d])`, "u"))
      if (at === -1) continue
      // Earliest mention wins; a longer alias breaks a tie ("capturas" over "fotos").
      if (!best || at < best.at || (at === best.at && alias.length > best.length)) {
        best = { workspace, at, length: alias.length }
      }
    }
  }
  return best?.workspace
}

function escape(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export type Resolution = {
  readonly cwd: string
  readonly workspace?: Workspace
  /** How it was chosen — carried into the audit log so a surprise is explainable. */
  readonly reason: "explicit" | "prompt-path" | "alias" | "default"
}

/**
 * Pick the directory a task should run in.
 *
 * Order matters and is deliberately most-specific-first: an explicit `cwd` from
 * the caller, then a real path written in the prompt, then a named root, then
 * the fallback. Anything that fails validation falls through rather than
 * failing the task — landing in the default directory is recoverable; refusing
 * to start because a folder was misspelled is not.
 */
export function resolveCwd(input: {
  cwd?: string
  prompt?: string
  fallback: string
  roots?: readonly Workspace[]
}): Resolution {
  const roots = input.roots ?? list()
  const anchor = input.fallback

  if (input.cwd) {
    const explicit = usable(input.cwd, anchor)
    if (explicit) return { cwd: explicit, workspace: match(explicit, roots), reason: "explicit" }
  }

  if (input.prompt) {
    const fromPath = pathInPrompt(input.prompt, anchor)
    if (fromPath) return { cwd: fromPath, workspace: match(fromPath, roots), reason: "prompt-path" }

    const named = aliasInPrompt(input.prompt, roots)
    if (named) return { cwd: named.path, workspace: named, reason: "alias" }
  }

  const fallback = usable(anchor, anchor) ?? anchor
  return { cwd: fallback, workspace: match(fallback, roots), reason: "default" }
}

/** The root a directory belongs to, if any. */
export function match(directory: string, roots: readonly Workspace[] = list()): Workspace | undefined {
  const resolved = path.resolve(directory)
  return roots.find(
    (workspace) => resolved === workspace.path || resolved.startsWith(workspace.path + path.sep),
  )
}

/** What the backend shows the persona: names and where they point. */
export function describe(roots: readonly Workspace[] = list()) {
  return roots.map((workspace) => ({ id: workspace.id, path: workspace.path }))
}
