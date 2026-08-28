#!/usr/bin/env bun
/**
 * Emit the sensitive-path denylist as a JSON asset, for consumers that are not this process.
 *
 *   bun run scripts/emit-policy-asset.ts            # write docs/fixtures/policy-paths.json
 *   bun run scripts/emit-policy-asset.ts --check    # exit 1 if the committed file is stale
 *
 * VIGILANCE rule R2: the sense sidecar classifies every path a watch is armed on before it stats,
 * tails or journals it, because a sidecar that accepts free-form paths is a read primitive that
 * bypasses this denylist entirely — a watch could tail `~/.ssh/id_rsa`. The sidecar is Python, so
 * it needs the table as data. A second hand-written copy of the rules over there is a divergence
 * that gets discovered by a leak instead of by a test, which is the same argument §9 makes for
 * `redact.ts`. So the table is generated from the one implementation and pinned in the tree, and
 * `policy-asset.test.ts` fails the moment the committed bytes stop matching `paths.ts`.
 *
 * Determinism is the whole contract, because that test compares bytes on whatever machine runs it.
 * Every field here is either compiled into `paths.ts` or a *verdict* over a path that classifies
 * the same way everywhere: no resolved path, no home directory and no `hannah-motion-lab` checkout
 * path is ever written out. This machine's own `HANNAH_AGENT_DENY_DIRS` is deliberately not baked
 * in either — the asset names the variable and the consumer reads it for itself.
 */

import fs from "fs"
import path from "path"
import { PolicyPaths } from "../packages/agent/src/hannah/policy/paths"

export const ASSET_FILE = path.join(import.meta.dir, "..", "docs", "fixtures", "policy-paths.json")

/** Absolute inputs only, so the anchor never decides an answer. */
const CWD = path.sep

/** The variable `fromEnv` reads, taken from the table so the name is never spelled twice. */
const ENV = PolicyPaths.rules().envVar

/** A directory a machine would name in `HANNAH_AGENT_DENY_DIRS`, chosen to exist on no machine. */
const MACHINE_DENIED = "/opt/hannah-motion-lab/backend/data"

type Case = {
  readonly path: string
  /** `HANNAH_AGENT_DENY_DIRS` for this one case. Absent means "a machine that set nothing". */
  readonly denyDirs?: string
  /** Why this case is in the table at all. Read by a human deciding whether a diff is a bug. */
  readonly why: string
}

/**
 * The decided cases. Every rule family is represented, and so is every boundary that has already
 * cost something: the public half of a key pair, the example env file, the residual B2 left behind.
 * A case whose verdict a change flips is a change to what Hannah may read, and it should have to be
 * argued for in a diff rather than discovered later.
 */
const GOLDEN: readonly Case[] = [
  {
    path: "~/.ssh/id_rsa",
    why: "the private half of a key pair: the exact read R2 exists to stop a watch from making",
  },
  {
    path: "~/.ssh/id_ed25519.pub",
    why: "the public half is not a secret, and the exception fires before the ~/.ssh directory rule",
  },
  {
    path: "/srv/keys/id_rsa",
    why: "a key outside ~/.ssh is denied by basename, wherever somebody copied it to",
  },
  { path: "~/Projects/demo/.env", why: "a project .env carries the same keys as one in $HOME" },
  {
    path: "~/Projects/demo/.env.production",
    why: "the suffixed shapes (.env.local, .env.production) are the ones people actually deploy",
  },
  {
    path: "~/Projects/demo/.env.example",
    why: "the committed template holds placeholders; denying it would deny reading half the repos on disk",
  },
  { path: "/srv/certs/server.pem", why: "private key material by extension, anywhere on disk" },
  {
    path: "/proc/self/environ",
    why: "every provider key of every running process, and the one rule that also matches the raw input",
  },
  {
    path: "~/Projects/demo/memory.db",
    why: "the whole conversation history, denied by basename wherever the backend put it",
  },
  { path: "~/Projects/demo/ui-token", why: "the HUD bearer token, denied by basename for the same reason" },
  {
    path: "~/hannah-backend/data/settings.json",
    why: "the installed layout: every provider key in plaintext, denied by the path pattern",
  },
  {
    path: "~/.local/share/hannah-sense/watches.json",
    why: "the sense sidecar's own state: the label the user spoke, the sensor spec and the watched path",
  },
  {
    path: "~/.local/share/hannah-sense/grants.json",
    why: "P5.4 puts the pre-authorised command in here, so a watch on it reads the standing grants",
  },
  {
    path: "~/.local/share/hannah-sense/portal-token",
    why: "P5.5's portal restore_token: a standing, no-dialog grant to capture the screen",
  },
  {
    path: "~/.local/share/hannah-sense/watches.json.tmp",
    why: "the atomic-write sibling holds the same bytes and matches no filename rule: the directory entry is what covers it",
  },
  {
    path: "~/.config/hannah-sense/settings.json",
    why: "the config half of the sidecar's state, denied before anything writes there rather than after",
  },
  {
    path: "~/backups/hannah-sense/grants.json",
    why: "a copy that kept the directory name, the shape a backup of ~/.local/share has: what the anchored rule buys over the directory entries",
  },
  {
    path: `${MACHINE_DENIED}/settings.json`,
    denyDirs: MACHINE_DENIED,
    why: "the development layout (B2): denied only because the machine named it in the env var",
  },
  {
    path: `${MACHINE_DENIED}/settings.json`,
    why: "the residual, stated out loud: with nothing in the env var, no compiled-in rule covers a checkout named backend/",
  },
  { path: "/etc/shadow", why: "an absolute denied file, so the DENIED_FILES arm is covered too" },
  { path: "~/.netrc", why: "a home-relative denied file, the DENIED_HOME_FILES arm" },
  { path: "~/.aws/credentials", why: "a denied directory that is not ~/.ssh, so one rule failing is visible" },
  { path: "~/Projects/demo/README.md", why: "ordinary source tree: a watch on a repo must stay possible" },
  { path: "~/Projects/demo/src/train.py", why: "the training script the user asks Hannah to watch" },
  {
    path: "~/Projects/demo/checkpoints/epoch-12.pt",
    why: "R2 watches checkpoint mtime; denying it would kill the rung",
  },
  { path: "~/Projects/demo/backend/src/index.js", why: "a sibling of a denied data/ directory stays readable" },
  {
    path: "~/Projects/demo/watches.json",
    why: "the decision §9 left open: no bare basename rule, because a file-watcher config is not the sidecar's state and a deny is unappealable",
  },
  {
    path: "~/Projects/demo/grants.json",
    why: "same call for the higher-value name: an IAM fixture in somebody's repo stays readable, the sidecar's own copy is denied by directory",
  },
  {
    path: `${MACHINE_DENIED}/../logs/train.log`,
    denyDirs: MACHINE_DENIED,
    why: "the env entry denies its subtree and nothing above it, with traversal normalised first",
  },
  { path: "/var/log/training.log", why: "a system log outside home: R3 tails these" },
  { path: "~/Downloads/report.pdf", why: "an ordinary document, the macro catalog's own working ground" },
]

/**
 * Classify one case under exactly the environment it declares. The variable is restored rather than
 * left set: a leaked entry would silently change every case after it, and the asset would still
 * look plausible.
 */
function decide(entry: Case): PolicyPaths.Verdict {
  const saved = process.env[ENV]
  if (entry.denyDirs === undefined) delete process.env[ENV]
  else process.env[ENV] = entry.denyDirs
  try {
    return PolicyPaths.classify(entry.path, CWD)
  } finally {
    if (saved === undefined) delete process.env[ENV]
    else process.env[ENV] = saved
  }
}

/** The asset, as the object that gets serialised. */
export function asset() {
  const table = PolicyPaths.rules()
  return {
    comment:
      "GENERATED from packages/agent/src/hannah/policy/paths.ts by scripts/emit-policy-asset.ts. " +
      "Do not edit by hand: change paths.ts, run `bun run scripts/emit-policy-asset.ts`, commit the diff.",
    version: 1,
    source: "packages/agent/src/hannah/policy/paths.ts",
    generator: "scripts/emit-policy-asset.ts",
    // The name, not this machine's value. A consumer reads the variable itself, splits on commas,
    // skips empty and relative entries, and denies each subtree — see `fromEnv` in paths.ts.
    denyDirsEnv: table.envVar,
    directories: table.builtinDirectories,
    files: table.files,
    // `{source, flags}` and never a bare RegExp: JSON.stringify(/^\.env$/i) is `{}`, so an asset
    // built the obvious way would ship an empty rule per line and deny nothing, with no error.
    patterns: table.patterns,
    basenames: table.basenames,
    exceptions: table.exceptions,
    golden: GOLDEN.map((entry) => {
      const verdict = decide(entry)
      return {
        path: entry.path,
        ...(entry.denyDirs === undefined ? {} : { denyDirs: entry.denyDirs }),
        ...verdict,
        why: entry.why,
      }
    }),
  }
}

/** The exact bytes on disk. Trailing newline so the file is a well-formed text file. */
export function serialize() {
  return `${JSON.stringify(asset(), undefined, 2)}\n`
}

if (import.meta.main) {
  const next = serialize()
  const current = fs.existsSync(ASSET_FILE) ? fs.readFileSync(ASSET_FILE, "utf8") : ""

  if (process.argv.includes("--check")) {
    if (current === next) {
      console.log(`up to date: ${ASSET_FILE}`)
      process.exit(0)
    }
    console.error(`stale: ${ASSET_FILE}\nrun: bun run scripts/emit-policy-asset.ts`)
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(ASSET_FILE), { recursive: true })
  fs.writeFileSync(ASSET_FILE, next)
  const table = asset()
  console.log(
    current === next
      ? `unchanged: ${ASSET_FILE}`
      : `wrote ${ASSET_FILE}\n` +
          `  ${table.directories.length} directories, ${table.files.length} files, ` +
          `${table.patterns.length} patterns, ${table.basenames.length} basenames, ` +
          `${table.exceptions.length} exceptions, ${table.golden.length} golden cases`,
  )
}
