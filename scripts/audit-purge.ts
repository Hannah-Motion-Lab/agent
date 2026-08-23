#!/usr/bin/env bun
/**
 * Trim the audit log to its retention window (M3.5, SECURITY §6).
 *
 *   bun run scripts/audit-purge.ts                 # dry run, 30 days
 *   bun run scripts/audit-purge.ts --days 7 --yes
 *
 * **The sidecar already does this at startup.** A retention policy that depends
 * on someone remembering to run a command is not a retention policy. This exists
 * for the two cases the automatic pass does not cover: trimming harder than the
 * configured window without restarting, and seeing what *would* go before it
 * goes.
 *
 * Rotation is by day, so trimming is deleting whole files. A log you have to
 * rewrite to trim is a log you can corrupt while trimming.
 */

import fs from "fs"
import path from "path"
import { Audit } from "../packages/agent/src/hannah/facade/audit"
import { Global } from "../packages/core/src/global"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}

const days = Number(flag("days") ?? 30)
const confirmed = args.includes("--yes")
const directory = flag("dir") ?? path.join(Global.Path.data, "audit")

if (!Number.isFinite(days) || days <= 0) {
  console.error("--days must be a positive number")
  process.exit(2)
}

const present = Audit.files(directory)
if (!present.length) {
  console.log(`no audit log at ${directory}`)
  process.exit(0)
}

const size = (file: string) => {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

const cutoff = Date.now() - days * 86_400_000
const doomed = present.filter((file) => {
  const day = Date.parse(`${path.basename(file).slice(6, 16)}T23:59:59.999Z`)
  return !Number.isNaN(day) && day < cutoff
})

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`
console.log(`${directory}\n${present.length} day-file(s), ${mb(present.reduce((sum, f) => sum + size(f), 0))}`)

if (!doomed.length) {
  console.log(`nothing older than ${days} days`)
  process.exit(0)
}

console.log(`\n${doomed.length} file(s) older than ${days} days (${mb(doomed.reduce((sum, f) => sum + size(f), 0))}):`)
for (const file of doomed) console.log(`  ${path.basename(file)}`)

if (!confirmed) {
  console.log("\ndry run — pass --yes to delete")
  process.exit(0)
}

const removed = Audit.purge(directory, days)
console.log(`\ndeleted ${removed.length} file(s)`)
