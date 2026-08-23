import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { HannahEnv } from "@/hannah/env"
import { Macros } from "@/hannah/macros"
import { MacroCatalog } from "@/hannah/macros/catalog"
import { PolicyWorkspaces } from "@/hannah/policy/workspaces"

// M3.2 — the macro library. The rule under test is the one the whole layer
// follows: never offer what this machine cannot do. A macro that fails halfway
// is worse than one that was never offered, because by then Hannah has said
// she would do it.

let root: string
let bin: string
let saved: { PATH?: string; WORKSPACES?: string }

const install = (...commands: string[]) => {
  for (const command of commands) fs.writeFileSync(path.join(bin, command), "#!/bin/sh\n", { mode: 0o755 })
  HannahEnv.reset()
}

const workspaces = (...ids: string[]) => {
  const entries = ids.map((id) => {
    const dir = path.join(root, id)
    fs.mkdirSync(dir, { recursive: true })
    return `${id}=${dir}`
  })
  // Un valor vacío haría caer el descubrimiento a los XDG reales de la máquina
  // y el test dependería de quién lo corre. El centinela parsea y no existe.
  process.env["HANNAH_AGENT_WORKSPACES"] = entries.join(",") || "none=/nonexistent-hannah-test"
  PolicyWorkspaces.reset()
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hannah-macros-"))
  bin = path.join(root, "bin")
  fs.mkdirSync(bin, { recursive: true })
  saved = { PATH: process.env["PATH"], WORKSPACES: process.env["HANNAH_AGENT_WORKSPACES"] }
  process.env["PATH"] = bin
  workspaces()
  HannahEnv.reset()
})

afterEach(() => {
  if (saved.PATH === undefined) delete process.env["PATH"]
  else process.env["PATH"] = saved.PATH
  if (saved.WORKSPACES === undefined) delete process.env["HANNAH_AGENT_WORKSPACES"]
  else process.env["HANNAH_AGENT_WORKSPACES"] = saved.WORKSPACES
  PolicyWorkspaces.reset()
  HannahEnv.reset()
  fs.rmSync(root, { recursive: true, force: true })
})

describe("the catalog itself", () => {
  test("every macro ships the skill it names", () => {
    const skills = path.join(import.meta.dir, "..", "..", "..", "..", "profile", "skills")
    for (const macro of MacroCatalog.MACROS) {
      const file = path.join(skills, macro.skill, "SKILL.md")
      expect(fs.existsSync(file)).toBe(true)

      // The engine discovers skills by frontmatter name, so a mismatch here
      // means the pointer in the prompt resolves to nothing at runtime.
      const body = fs.readFileSync(file, "utf8")
      expect(body).toContain(`name: ${macro.skill}`)
      expect(body).toMatch(/^description: \S/m)
    }
  })

  test("ids and skill names are unique", () => {
    const ids = MacroCatalog.MACROS.map((macro) => macro.id)
    const skills = MacroCatalog.MACROS.map((macro) => macro.skill)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(skills).size).toBe(skills.length)
  })

  test("the library is the ten macros the roadmap promised", () => {
    expect(MacroCatalog.MACROS).toHaveLength(10)
  })
})

describe("never offer what this machine cannot do", () => {
  test("a macro with no requirements is always available", () => {
    expect(Macros.describe().map((macro) => macro.id)).toEqual(["system-status"])
  })

  test("a missing command keeps its macro out of the catalog, with a reason", () => {
    const before = Macros.survey().find((entry) => entry.macro.id === "media-control")!
    expect(before.available).toBe(false)
    expect(before.missing[0]).toContain("playerctl")

    install("playerctl")
    expect(Macros.describe().map((macro) => macro.id)).toContain("media-control")
  })

  test("a missing folder keeps its macro out too", () => {
    install("git")
    expect(Macros.describe().map((macro) => macro.id)).not.toContain("git-housekeeping")

    workspaces("projects")
    expect(Macros.describe().map((macro) => macro.id)).toContain("git-housekeeping")
  })

  test("all requirements must be met, not just one", () => {
    workspaces("projects")   // editor still missing
    const entry = Macros.survey().find((item) => item.macro.id === "open-project")!
    expect(entry.available).toBe(false)
    expect(entry.missing).toHaveLength(1)
    expect(entry.missing[0]).toContain("editor")
  })

  test("any one of the listed commands is enough", () => {
    workspaces("downloads")
    install("wget")   // curl absent
    expect(Macros.describe().map((macro) => macro.id)).toContain("download-and-file")
  })

  test("a file on PATH that is not executable does not count", () => {
    fs.writeFileSync(path.join(bin, "playerctl"), "not a program", { mode: 0o644 })
    HannahEnv.reset()
    expect(Macros.describe().map((macro) => macro.id)).not.toContain("media-control")
  })
})

describe("matching a prompt to a macro", () => {
  beforeEach(() => {
    workspaces("downloads", "projects", "pictures")
    install("git", "code", "tar", "rg", "curl", "playerctl", "gtk-launch")
  })

  // La frase literal casi nunca sobrevive al contacto con una petición real.
  test.each([
    ["Organize ~/Downloads into folders by file type", "organize-downloads"],
    ["Check the git status of every repo under ~/Projects", "git-housekeeping"],
    ["Report disk space and memory usage for this machine", "system-status"],
    ["Pause the music that is playing right now", "media-control"],
    ["Find the file where I wrote about retarget offsets", "find-file"],
    ["Open the hannah-motion-lab project in the editor", "open-project"],
    ["Move the latest screenshot into the frontend project", "file-screenshot"],
  ])("%s → %s", (prompt, id) => {
    expect(Macros.match(prompt)?.id).toBe(id)
  })

  test("a request that is not a macro matches nothing", () => {
    expect(Macros.match("Tell me a joke about compilers")).toBeUndefined()
    expect(Macros.match("")).toBeUndefined()
  })

  // Un fallo cuesta calidad; una macro EQUIVOCADA carga instrucciones de otro
  // trabajo. Por eso se afina a precisión, no a cobertura.
  test("a single stray word does not drag in a macro", () => {
    expect(Macros.match("what did you download yesterday")?.id).not.toBe("download-and-file")
    expect(Macros.match("play along with me")?.id).not.toBe("media-control")
  })

  test("the more specific alias wins", () => {
    // "open project" y "open application" comparten "open".
    expect(Macros.match("open the notes application")?.id).toBe("launch-app")
    expect(Macros.match("open the agent project")?.id).toBe("open-project")
  })
})

describe("resolving the macro for a task", () => {
  beforeEach(() => {
    workspaces("downloads")
    install("tar")
  })

  test("an explicit id wins over the prompt", () => {
    expect(Macros.resolve({ macro: "archive-old-files", prompt: "organize my downloads" })?.id)
      .toBe("archive-old-files")
  })

  // El catálogo del que llama puede estar caducado. Correr sin skill es mejor
  // que correr con instrucciones para una herramienta que no está.
  test("an explicit id for an unavailable macro resolves to nothing", () => {
    expect(Macros.resolve({ macro: "media-control", prompt: "pause the music" })).toBeUndefined()
  })

  test("an unknown id resolves to nothing rather than throwing", () => {
    expect(Macros.resolve({ macro: "no-such-macro", prompt: "organize my downloads" })).toBeUndefined()
  })

  test("without an id it falls back to the prompt", () => {
    expect(Macros.resolve({ prompt: "organize my downloads please" })?.id).toBe("organize-downloads")
  })
})
