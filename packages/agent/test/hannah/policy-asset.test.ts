import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import { PolicyPaths } from "@/hannah/policy"
import { ASSET_FILE, serialize } from "../../../../scripts/emit-policy-asset"

// VIGILANCE R2: the sense sidecar classifies every path a watch is armed on, against a rule table
// GENERATED from policy/paths.ts and never hand-copied. A Python copy of the denylist is a
// divergence that gets found by a leak instead of by a test, so the asset is pinned in the tree and
// this file is the thing that notices when it stops matching the code.
//
// Regenerate: bun run scripts/emit-policy-asset.ts

const CWD = "/"
const ENV = PolicyPaths.rules().envVar

type Golden = {
  readonly path: string
  readonly denyDirs?: string
  readonly sensitive: boolean
  readonly reason?: string
  readonly rule?: string
  readonly why: string
}

type Asset = {
  readonly comment: string
  readonly denyDirsEnv: string
  readonly directories: string[]
  readonly files: string[]
  readonly patterns: { source: string; flags: string }[]
  readonly basenames: { source: string; flags: string }[]
  readonly exceptions: { source: string; flags: string }[]
  readonly golden: Golden[]
}

const committed: Asset = JSON.parse(fs.readFileSync(ASSET_FILE, "utf8"))

let saved: string | undefined
beforeEach(() => {
  saved = process.env[ENV]
})
afterEach(() => {
  if (saved === undefined) delete process.env[ENV]
  else process.env[ENV] = saved
})

describe("the committed asset is what paths.ts produces now", () => {
  test("byte for byte", () => {
    // The one assertion that catches a rule added without regenerating. Everything below narrows
    // down *which* rule, but this is the gate: a new entry in DENIED_BASENAMES, a widened pattern,
    // a removed exception — each one changes these bytes, and none of them changes the sidecar
    // until somebody runs the generator and commits the diff.
    expect(fs.readFileSync(ASSET_FILE, "utf8")).toBe(serialize())
  })

  test("the rule table is the rule table, so a stale asset says which list drifted", () => {
    const table = PolicyPaths.rules()
    // `builtinDirectories`, not `directories`: the env additions belong to a machine, not to the
    // asset. The next test proves the difference is real rather than assumed.
    expect(committed.directories).toEqual(table.builtinDirectories)
    expect(committed.files).toEqual(table.files)
    expect(committed.patterns).toEqual(table.patterns)
    expect(committed.basenames).toEqual(table.basenames)
    expect(committed.exceptions).toEqual(table.exceptions)
    expect(committed.denyDirsEnv).toBe(ENV)
  })

  test("this machine's HANNAH_AGENT_DENY_DIRS does not leak into it", () => {
    delete process.env[ENV]
    const clean = serialize()
    process.env[ENV] = "/opt/some-other-machine/backend/data"
    expect(serialize()).toBe(clean)
    expect(clean).not.toContain("some-other-machine")
  })

  test("every regex survived JSON", () => {
    // JSON.stringify(/^\.env$/i) is `{}`. An asset built the obvious way ships one empty rule per
    // line, denies nothing, and reports no error at any point — including here, unless asked.
    const emitted = [...committed.patterns, ...committed.basenames, ...committed.exceptions]
    expect(emitted.length).toBeGreaterThan(0)
    for (const rule of emitted) {
      expect(rule.source.length).toBeGreaterThan(0)
      expect(() => new RegExp(rule.source, rule.flags)).not.toThrow()
    }
    expect(committed.patterns.map((rule) => rule.source)).toContain("^\\/proc\\/[^/]+\\/(environ|cmdline|maps|mem)$")
  })

  test("it says out loud that it is generated, and by what", () => {
    expect(committed.comment).toContain("GENERATED")
    expect(committed.comment).toContain("scripts/emit-policy-asset.ts")
    expect(committed.comment).toContain("policy/paths.ts")
  })
})

describe("the golden cases still classify the way the asset claims", () => {
  for (const entry of committed.golden) {
    const name = entry.denyDirs === undefined ? entry.path : `${entry.path} (with ${ENV})`
    test(`${entry.sensitive ? "denies" : "allows"} ${name}`, () => {
      if (entry.denyDirs === undefined) delete process.env[ENV]
      else process.env[ENV] = entry.denyDirs

      const verdict = PolicyPaths.classify(entry.path, CWD)
      expect(verdict.sensitive).toBe(entry.sensitive)
      // The reason and the rule are asserted too: a path that stays denied by a *different* rule is
      // a change to the denylist that a boolean would hide.
      if (verdict.sensitive) {
        expect(verdict.reason).toBe(entry.reason!)
        expect(verdict.rule).toBe(entry.rule!)
      }
    })
  }

  test("the cases R2 names are all still in the table", () => {
    // Deleting a case is the other way to make this file pass while covering less, and it does not
    // change a single byte anywhere else.
    const paths = committed.golden.map((entry) => entry.path)
    for (const required of [
      "~/.ssh/id_rsa",
      "~/.ssh/id_ed25519.pub",
      "~/Projects/demo/.env",
      "~/Projects/demo/.env.example",
      "/srv/certs/server.pem",
      "/proc/self/environ",
      "~/Projects/demo/memory.db",
      "~/Projects/demo/ui-token",
      "~/hannah-backend/data/settings.json",
    ]) {
      expect(paths).toContain(required)
    }
    expect(committed.golden.some((entry) => entry.denyDirs !== undefined && entry.sensitive)).toBe(true)
    expect(committed.golden.filter((entry) => !entry.sensitive).length).toBeGreaterThanOrEqual(6)
    for (const entry of committed.golden) expect(entry.why.length).toBeGreaterThan(0)
  })
})
