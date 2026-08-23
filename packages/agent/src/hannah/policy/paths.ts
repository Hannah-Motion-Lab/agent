export * as PolicyPaths from "./paths"

import os from "os"
import path from "path"
import fs from "fs"

/**
 * Sensitive-path denylist (SECURITY T4). These paths are never readable or
 * writable by the agent, in any preset, and no approval can unlock them —
 * the user cannot meaningfully consent to "read my ssh key" in the middle of
 * a spoken task, and prompt injection (T1) targets exactly this.
 *
 * Matching is done on a *resolved* path (see `classify`), so `~`, `..`, and
 * symlinks into a denied directory are all covered.
 */

/** Directory subtrees that are denied entirely. `~` expands to the user's home. */
const DENIED_DIRECTORIES = [
  // SSH / GPG / signing material
  "~/.ssh",
  "~/.gnupg",
  // Cloud + cluster credentials
  "~/.aws",
  "~/.config/gcloud",
  "~/.azure",
  "~/.kube",
  "~/.docker",
  // OS keyrings and password managers
  "~/.local/share/keyrings",
  "~/.gnome2/keyrings",
  "~/.password-store",
  "~/Library/Keychains",
  // Browser profiles (cookies, saved passwords, session tokens)
  "~/.mozilla",
  "~/.config/google-chrome",
  "~/.config/chromium",
  "~/.config/BraveSoftware",
  "~/.config/microsoft-edge",
  "~/Library/Application Support/Google/Chrome",
  "~/Library/Application Support/Firefox",
  // System secrets
  "/etc/ssh",
  "/etc/sudoers.d",
  "/root",
  // The agent's own credential store: provider keys and OAuth tokens live in
  // the engine's data dir. A task must never be able to read them back out.
  "~/.local/share/hannah-agent",
  "~/.config/hannah-agent",
]

/** Exact files that are denied wherever they live under the home directory. */
const DENIED_HOME_FILES = [
  "~/.netrc",
  "~/.npmrc",
  "~/.pypirc",
  "~/.git-credentials",
  "~/.bash_history",
  "~/.zsh_history",
]

/** Absolute files that are denied outright. */
const DENIED_FILES = ["/etc/shadow", "/etc/gshadow", "/etc/sudoers", "/etc/master.passwd"]

/**
 * Basename patterns denied anywhere on disk. These are the shapes that carry
 * secrets regardless of location — a `.env` inside a project directory is
 * exactly as sensitive as one in `$HOME`.
 */
const DENIED_BASENAMES = [
  /^\.env$/i,
  /^\.env\..+/i, // .env.local, .env.production
  /^id_[a-z0-9]+$/i, // id_rsa, id_ed25519 (public halves handled below)
  /^.*\.pem$/i,
  /^.*\.pfx$/i,
  /^.*\.p12$/i,
  /^.*\.keystore$/i,
  /^credentials\.json$/i,
  /^service-account.*\.json$/i,
  /^\.htpasswd$/i,
]

/** Explicit exceptions to DENIED_BASENAMES — public material is not a secret. */
const ALLOWED_BASENAMES = [/^id_[a-z0-9]+\.pub$/i, /^\.env\.example$/i, /^\.env\.sample$/i, /^\.env\.template$/i]

export type Verdict =
  | { readonly sensitive: false }
  | { readonly sensitive: true; readonly reason: string; readonly rule: string }

function home() {
  return os.homedir()
}

function expand(pattern: string) {
  return pattern.startsWith("~/") ? path.join(home(), pattern.slice(2)) : pattern
}

/** Case-insensitive comparison on platforms with case-insensitive filesystems. */
function comparable(input: string) {
  return process.platform === "linux" ? input : input.toLowerCase()
}

function isInside(child: string, parent: string) {
  const a = comparable(child)
  const b = comparable(parent)
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}

/**
 * Resolve a candidate path the way the filesystem will: expand `~`, make it
 * absolute against `cwd`, normalize `..`, and follow symlinks as far as they
 * exist. Resolving the *existing* prefix matters for writes — the target file
 * may not exist yet, but the directory it lands in usually does, and that
 * directory may be a symlink into a denied tree.
 */
export function resolve(input: string, cwd: string): string {
  const expanded = expand(input)
  const absolute = path.resolve(cwd, expanded)

  let current = absolute
  const trailing: string[] = []
  // Walk up to the nearest existing ancestor, realpath it, then re-apply the
  // parts that do not exist yet.
  for (let i = 0; i < 64; i++) {
    try {
      const real = fs.realpathSync(current)
      return trailing.length ? path.join(real, ...trailing.reverse()) : real
    } catch {
      const parent = path.dirname(current)
      if (parent === current) break
      trailing.push(path.basename(current))
      current = parent
    }
  }
  return absolute
}

/** Decide whether a path is off-limits. `cwd` anchors relative inputs. */
export function classify(input: string, cwd: string = process.cwd()): Verdict {
  if (!input) return { sensitive: false }
  const resolved = resolve(input, cwd)
  const base = path.basename(resolved)

  if (ALLOWED_BASENAMES.some((rule) => rule.test(base))) return { sensitive: false }

  for (const rule of DENIED_BASENAMES) {
    if (rule.test(base)) {
      return { sensitive: true, reason: `"${base}" is a credential-bearing filename`, rule: String(rule) }
    }
  }

  for (const pattern of [...DENIED_FILES, ...DENIED_HOME_FILES]) {
    const target = expand(pattern)
    if (comparable(resolved) === comparable(target)) {
      return { sensitive: true, reason: `${pattern} holds credentials`, rule: pattern }
    }
  }

  for (const pattern of DENIED_DIRECTORIES) {
    const target = expand(pattern)
    if (isInside(resolved, target)) {
      return { sensitive: true, reason: `${pattern} is a protected directory`, rule: pattern }
    }
  }

  return { sensitive: false }
}

/** The denylist as data, for documentation and tests. */
export function rules() {
  return {
    directories: [...DENIED_DIRECTORIES],
    files: [...DENIED_FILES, ...DENIED_HOME_FILES],
    basenames: DENIED_BASENAMES.map(String),
    exceptions: ALLOWED_BASENAMES.map(String),
  }
}

/**
 * Workspace roots (SECURITY §4 layer 3). D3 set the initial list to ["/"],
 * which makes this check inert by design — it stays implemented so the fence
 * can be tightened later without a redesign.
 */
export function insideRoots(input: string, roots: readonly string[], cwd: string = process.cwd()): boolean {
  if (roots.length === 0) return true
  const resolved = resolve(input, cwd)
  return roots.some((root) => isInside(resolved, resolve(root, cwd)))
}
