import { describe, expect, test } from "bun:test"
import path from "path"
import { ConfigV1 } from "@hannah/core/v1/config/config"
import { Permission } from "@/permission"
import { ConfigParse } from "@/config/parse"

// Guards the shipped Hannah profiles (profile/*.jsonc): they must parse against
// the engine's own config schema, and the `companion` preset they encode must
// keep the posture SECURITY.md §4 promises. A profile edit that quietly widens
// permissions should fail here rather than in someone's home directory.

const ROOT = path.join(import.meta.dir, "..", "..", "..", "..")

async function loadProfile(file: string) {
  const filepath = path.join(ROOT, "profile", file)
  const text = await Bun.file(filepath).text()
  return ConfigParse.schema(ConfigV1.Info, ConfigParse.jsonc(text, filepath), filepath)
}

const profiles = ["hannah-agent.jsonc", "hannah-agent.local.jsonc"]

describe.each(profiles)("Hannah profile %s", (file) => {
  test("parses against the engine config schema", async () => {
    const config = await loadProfile(file)
    expect(config.model).toBeTruthy()
    expect(config.small_model).toBeTruthy()
  })

  test("keeps upstream services off and the server on loopback", async () => {
    const config = await loadProfile(file)
    expect(config.share).toBe("disabled")
    expect(config.autoupdate).toBe(false)
    expect(config.server?.hostname).toBe("127.0.0.1")
    expect(config.server?.port).toBe(8006)
    expect(config.server?.mdns).toBe(false)
    expect(config.server?.cors).toEqual([])
  })

  test("bounds blast radius", async () => {
    const config = await loadProfile(file)
    expect(config.subagent_depth).toBe(1)
    expect(config.snapshot).toBe(true)
    expect(config.tools?.webfetch).toBe(false)
    expect(config.tools?.websearch).toBe(false)
  })

  test("companion preset: reads free, writes ask, network denied", async () => {
    const ruleset = Permission.fromConfig((await loadProfile(file)).permission ?? {})
    const action = (permission: string, pattern = "*") => Permission.evaluate(permission, pattern, ruleset).action

    expect(action("read")).toBe("allow")
    expect(action("glob")).toBe("allow")
    expect(action("grep")).toBe("allow")

    expect(action("edit")).toBe("ask")
    expect(action("task")).toBe("ask")
    expect(action("external_directory")).toBe("ask")

    expect(action("webfetch")).toBe("deny")
    expect(action("websearch")).toBe("deny")
  })

  test("companion preset: shell safe-list runs free, everything else asks", async () => {
    const ruleset = Permission.fromConfig((await loadProfile(file)).permission ?? {})
    const bash = (command: string) => Permission.evaluate("bash", command, ruleset).action

    for (const safe of ["ls", "pwd", "cat", "git status", "git log", "git diff"]) {
      expect(bash(safe)).toBe("allow")
    }
    // Unknown commands and dangerous shapes must never fall through to allow.
    for (const gated of ["rm", "sudo", "curl", "ssh", "dd", "mkfs", "chmod", "npm install", "python"]) {
      expect(bash(gated)).toBe("ask")
    }
  })

  test("an unmatched permission never defaults to allow", async () => {
    const ruleset = Permission.fromConfig((await loadProfile(file)).permission ?? {})
    expect(Permission.evaluate("some_future_tool", "*", ruleset).action).toBe("ask")
  })
})

test("the local profile declares Ollama itself and needs no catalog", async () => {
  const config = await loadProfile("hannah-agent.local.jsonc")
  expect(config.enabled_providers).toEqual(["ollama"])
  expect(config.provider?.ollama?.options?.baseURL).toBe("http://127.0.0.1:11434/v1")
  expect(Object.keys(config.provider?.ollama?.models ?? {}).length).toBeGreaterThan(0)
})
