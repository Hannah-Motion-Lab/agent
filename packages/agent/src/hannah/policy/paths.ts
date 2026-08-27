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
  // Windows: the same secrets live under the profile dir and AppData. `~` resolves to
  // %USERPROFILE% there (os.homedir()), and comparison is case-insensitive off Linux.
  "~/AppData/Roaming/Microsoft/Credentials",
  "~/AppData/Local/Microsoft/Credentials",
  "~/AppData/Roaming/Microsoft/Protect",
  "~/AppData/Local/Google/Chrome/User Data",
  "~/AppData/Local/Microsoft/Edge/User Data",
  "~/AppData/Roaming/Mozilla/Firefox/Profiles",
  "~/AppData/Local/BraveSoftware/Brave-Browser/User Data",
  "~/AppData/Roaming/hannah-agent",
  "~/.npmrc",
  "~/.pypirc",
  "~/.git-credentials",
  "~/.bash_history",
  "~/.zsh_history",
]

/** Absolute files that are denied outright. */
const DENIED_FILES = ["/etc/shadow", "/etc/gshadow", "/etc/sudoers", "/etc/master.passwd"]

/**
 * Path shapes denied anywhere: the process environment of any process (API keys live there),
 * and Hannah's own data directory — settings.json holds every provider key in plaintext and
 * memory.db the whole conversation history. Matched on the resolved path AND on the raw input,
 * so a spelling that fails to resolve is still caught.
 *
 * `hannah-backend` is the directory site/install.sh clones into. A development checkout keeps the
 * upstream name (`backend/`), which no pattern here can name without denying every unrelated
 * project's `backend/data` too — see HANNAH_AGENT_DENY_DIRS below.
 */
const DENIED_PATTERNS = [
  /^\/proc\/[^/]+\/(environ|cmdline|maps|mem)$/i,
  /[\\/]hannah-backend[\\/]data([\\/]|$)/i,
  /[\\/](memory\.db|ui-token)$/i,
]

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
  // `~/x`, `~user/x`, `$HOME/x`, `${HOME}/x` — all the spellings a shell would honour.
  let p = pattern.replace(/^\$\{HOME\}|^\$HOME(?=\/|$)/, home())
  if (p.startsWith("~/") || p === "~") return path.join(home(), p.slice(2))
  const other = /^~([a-z_][a-z0-9_-]*)(\/|$)/i.exec(p)
  if (other) return path.join(path.dirname(home()), other[1]!, p.slice(other[0].length))
  return p
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

/** The variable `fromEnv` reads. Named once so `rules()` can hand it to a consumer verbatim. */
const DENY_DIRS_ENV = "HANNAH_AGENT_DENY_DIRS"

/**
 * Extra denied directories for this machine: `HANNAH_AGENT_DENY_DIRS`, a comma-separated list of
 * absolute paths. Empty and relative entries are skipped — a relative entry would resolve against
 * whatever cwd the task happens to run in, so it would name a different directory per task.
 *
 * This is env-driven rather than hard-coded because the directory *names* differ per layout: the
 * installed tree has `hannah-backend/`, a development checkout has `backend/`. Hard-coding one of
 * them is exactly how the `hannah-backend` pattern above came to be silently dead in a checkout,
 * with settings.json (every provider key, in plaintext) readable by `read` and `bash`. Widening
 * that pattern is not the alternative: D3 put the workspace root at `/`, so a rule matching a
 * `backend/data` under any parent would hard-deny legitimate work in unrelated projects, and a
 * hard deny is unappealable by design.
 */
function fromEnv(): string[] {
  const raw = process.env[DENY_DIRS_ENV]
  if (!raw?.trim()) return []
  const result: string[] = []
  for (const entry of raw.split(",")) {
    const expanded = expand(entry.trim())
    if (!expanded || !path.isAbsolute(expanded)) continue
    // Resolved once here so a symlinked entry still matches the realpath `classify` compares.
    result.push(resolve(expanded, path.sep))
  }
  return result
}

/** Every denied subtree: the built-in list plus whatever this machine added. */
function deniedDirectories() {
  return [...DENIED_DIRECTORIES, ...fromEnv()]
}

/** Decide whether a path is off-limits. `cwd` anchors relative inputs. */
export function classify(input: string, cwd: string = process.cwd()): Verdict {
  if (!input) return { sensitive: false }
  const resolved = resolve(input, cwd)
  for (const rule of DENIED_PATTERNS) {
    if (rule.test(resolved) || rule.test(expand(input))) {
      return { sensitive: true, reason: "process environment or Hannah's own data", rule: rule.source }
    }
  }
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

  for (const pattern of deniedDirectories()) {
    const target = expand(pattern)
    if (isInside(resolved, target)) {
      return { sensitive: true, reason: `${pattern} is a protected directory`, rule: pattern }
    }
  }

  return { sensitive: false }
}

/**
 * A regular expression as data. `JSON.stringify(/^\.env$/i)` is `{}`: a rule emitted as a bare
 * RegExp disappears from a generated asset silently, with no error anywhere, so the source and the
 * flags are carried explicitly instead.
 */
export type RegexRule = { readonly source: string; readonly flags: string }

const asData = (rule: RegExp): RegexRule => ({ source: rule.source, flags: rule.flags })

/**
 * The denylist as data, for documentation, tests, and the generated asset
 * `docs/fixtures/policy-paths.json` that the sense sidecar classifies against (VIGILANCE R2).
 *
 * `directories` is what this machine enforces, env included — the caller that wants to know what is
 * actually denied here must not have to remember to add the env list itself. The asset ships
 * `builtinDirectories` and `envVar` instead: freezing one machine's `HANNAH_AGENT_DENY_DIRS` into a
 * committed file would deny those directories on every other machine and leave that machine's real
 * ones unlisted, which is worse than both halves of the trade.
 */
export function rules() {
  return {
    envVar: DENY_DIRS_ENV,
    builtinDirectories: [...DENIED_DIRECTORIES],
    directories: deniedDirectories(),
    files: [...DENIED_FILES, ...DENIED_HOME_FILES],
    patterns: DENIED_PATTERNS.map(asData),
    basenames: DENIED_BASENAMES.map(asData),
    exceptions: ALLOWED_BASENAMES.map(asData),
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
