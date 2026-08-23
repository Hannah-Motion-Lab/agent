import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { PolicyCommands } from "@/hannah/policy/commands"
import { PolicyWorkspaces } from "@/hannah/policy/workspaces"
import { Translate } from "@/hannah/facade/translate"

// M3.1 — where Hannah works, and how she deletes. This is ergonomics, not
// security: D3 made the workspace root `/`, so a root grants nothing. What is
// under test is that a task lands somewhere sensible and that an irreversible
// verb is distinguishable from a reversible one when the user is asked to
// approve it out loud.

let root: string
let downloads: string
let projects: string
let saved: { PATH?: string; WORKSPACES?: string }

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hannah-ws-"))
  downloads = path.join(root, "Descargas")
  projects = path.join(root, "Projects", "hannah")
  fs.mkdirSync(downloads, { recursive: true })
  fs.mkdirSync(projects, { recursive: true })

  saved = { PATH: process.env["PATH"], WORKSPACES: process.env["HANNAH_AGENT_WORKSPACES"] }
  process.env["HANNAH_AGENT_WORKSPACES"] = `downloads=${downloads},projects=${path.dirname(projects)}`
  PolicyWorkspaces.reset()
  PolicyCommands.resetTrashTool()
})

afterEach(() => {
  if (saved.PATH === undefined) delete process.env["PATH"]
  else process.env["PATH"] = saved.PATH
  if (saved.WORKSPACES === undefined) delete process.env["HANNAH_AGENT_WORKSPACES"]
  else process.env["HANNAH_AGENT_WORKSPACES"] = saved.WORKSPACES
  PolicyWorkspaces.reset()
  PolicyCommands.resetTrashTool()
  fs.rmSync(root, { recursive: true, force: true })
})

describe("which directory a task runs in", () => {
  test("a named folder in the prompt wins over the fallback", () => {
    const result = PolicyWorkspaces.resolveCwd({ prompt: "ordena mis descargas por tipo", fallback: root })
    expect(result).toMatchObject({ cwd: fs.realpathSync(downloads), reason: "alias" })
    expect(result.workspace?.id).toBe("downloads")
  })

  test("accents and case do not matter", () => {
    expect(PolicyWorkspaces.resolveCwd({ prompt: "REVISA MIS PROYECTOS", fallback: root }).workspace?.id)
      .toBe("projects")
  })

  test("a real path in the prompt beats a name", () => {
    const result = PolicyWorkspaces.resolveCwd({
      prompt: `mira en ${projects} aunque hable de descargas`,
      fallback: root,
    })
    expect(result).toMatchObject({ cwd: fs.realpathSync(projects), reason: "prompt-path" })
  })

  test("a path that does not exist yet walks up to one that does", () => {
    const result = PolicyWorkspaces.resolveCwd({
      prompt: `guarda el informe en ${path.join(downloads, "informes", "2026")}`,
      fallback: root,
    })
    expect(result.cwd).toBe(fs.realpathSync(downloads))
  })

  test("an explicit cwd from the caller wins over everything", () => {
    const result = PolicyWorkspaces.resolveCwd({ cwd: projects, prompt: "ordena mis descargas", fallback: root })
    expect(result).toMatchObject({ cwd: fs.realpathSync(projects), reason: "explicit" })
  })

  test("a prompt about nothing in particular stays in the fallback", () => {
    expect(PolicyWorkspaces.resolveCwd({ prompt: "cuéntame un chiste", fallback: root }))
      .toMatchObject({ cwd: fs.realpathSync(root), reason: "default" })
  })

  // Un root no es una frontera de seguridad, pero elegir cwd DENTRO de un sitio
  // protegido sería empezar la tarea con el pie en el sitio equivocado.
  test("a sensitive directory is never chosen as the working directory", () => {
    const result = PolicyWorkspaces.resolveCwd({ prompt: "mira en ~/.ssh a ver qué hay", fallback: root })
    expect(result.cwd).not.toContain(".ssh")

    const explicit = PolicyWorkspaces.resolveCwd({ cwd: "~/.gnupg", prompt: "x", fallback: root })
    expect(explicit.reason).toBe("default")
  })

  test("a misspelled folder falls back instead of failing the task", () => {
    // Aterrizar en el sitio por defecto se arregla; negarse a arrancar, no.
    expect(PolicyWorkspaces.resolveCwd({ cwd: path.join(root, "no-existe"), prompt: "x", fallback: root }))
      .toMatchObject({ reason: "default" })
  })

  test("only directories that exist are offered as roots", () => {
    process.env["HANNAH_AGENT_WORKSPACES"] = `real=${downloads},fantasma=${path.join(root, "nope")}`
    PolicyWorkspaces.reset()
    expect(PolicyWorkspaces.describe().map((entry) => entry.id)).toEqual(["real"])
  })
})

describe("deleting reversibly", () => {
  const fakeTool = (name: string) => {
    const bin = path.join(root, "bin")
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, name), "#!/bin/sh\n", { mode: 0o755 })
    process.env["PATH"] = bin
    PolicyCommands.resetTrashTool()
  }

  test("the trash tool is detected from PATH", () => {
    process.env["PATH"] = ""
    PolicyCommands.resetTrashTool()
    expect(PolicyCommands.trashTool()).toBeNull()

    fakeTool("gio")
    expect(PolicyCommands.trashTool()).toMatchObject({ command: "gio", template: "gio trash <path>" })
  })

  test("an approval says which of the two it is", () => {
    // La diferencia importa justo cuando se pregunta en voz alta: conceder por
    // error algo reversible no cuesta nada, y algo irreversible lo cuesta todo.
    expect(Translate.approvalSummary("bash", ["rm -rf ./build"], { command: "rm -rf ./build" }))
      .toContain("permanently delete")
    expect(Translate.approvalSummary("bash", ["gio trash ./build"], { command: "gio trash ./build" }))
      .toContain("move")
    expect(Translate.approvalSummary("bash", ["gio trash ./build"], { command: "gio trash ./build" }))
      .toContain("trash")
  })

  test("moving to the trash is still a delete, and still asked about", () => {
    expect(Translate.approvalKind("bash", "gio trash ./build")).toBe("delete")
    expect(Translate.approvalKind("bash", "rm -rf ./build")).toBe("delete")
  })

  test("but it is not treated as the same risk", () => {
    expect(Translate.risk("bash", ["rm -rf ./build"])).toBe("high")
    expect(Translate.risk("bash", ["gio trash ./build"])).toBe("medium")
  })
})
