export * as MacroCatalog from "./catalog"

/**
 * The macro library (M3.2).
 *
 * A macro is not code. It is a *name* the persona can offer, a set of
 * requirements that decide whether it may be offered at all, and a skill the
 * agent loads when the task starts. The instructions themselves live in
 * `profile/skills/<id>/SKILL.md` and are loaded by the engine's own skill
 * mechanism — reimplementing that here would have been a second, worse one.
 *
 * The load-bearing rule is the same one the rest of this layer follows:
 * **never offer what this machine cannot do.** A macro whose tool is missing is
 * absent from the catalog, so the persona never learns it exists and cannot
 * promise it. Failing halfway is worse than never offering, because by then
 * Hannah has already said she would.
 */

export type Requirement =
  /** Any one of these commands must be on PATH. */
  | { readonly kind: "command"; readonly any: readonly string[]; readonly why: string }
  /** A configured workspace root with this id must exist. */
  | { readonly kind: "workspace"; readonly id: string; readonly why: string }

export type Macro = {
  readonly id: string
  /** What the persona is told it does — one line, user-facing, English. */
  readonly summary: string
  /** Words that mean this macro, in either language, accent-free lowercase. */
  readonly aliases: readonly string[]
  readonly requires: readonly Requirement[]
  /** The skill the agent should load. Matches profile/skills/<skill>/SKILL.md. */
  readonly skill: string
  /**
   * What the user gets back. `answer` macros exist to tell you something, so
   * their output is the deliverable (M3.0); `action` macros change the machine.
   */
  readonly result: "action" | "answer"
}

export const MACROS: readonly Macro[] = [
  {
    id: "organize-downloads",
    summary: "sort the Downloads folder into subfolders by file type",
    aliases: ["organize downloads", "sort downloads", "tidy downloads", "clean downloads", "ordenar descargas", "organizar descargas", "limpiar descargas"],
    requires: [{ kind: "workspace", id: "downloads", why: "there is no Downloads folder on this machine" }],
    skill: "organize-downloads",
    result: "action",
  },
  {
    id: "open-project",
    summary: "open one of the user's projects in their editor",
    aliases: ["open project", "open repo", "open editor", "project editor", "abrir proyecto", "abre proyecto", "abrir editor"],
    requires: [
      { kind: "workspace", id: "projects", why: "there is no Projects folder on this machine" },
      { kind: "command", any: ["code", "zed", "subl", "idea", "nvim", "vim"], why: "no editor was found on PATH" },
    ],
    skill: "open-project",
    result: "action",
  },
  {
    id: "media-control",
    summary: "play, pause, skip or change the volume of whatever is playing",
    aliases: ["pause music", "pause playback", "resume playback", "play music", "next track", "skip track", "previous track", "playback volume", "currently playing", "pausa musica", "siguiente cancion", "sube volumen", "baja volumen", "playerctl"],
    requires: [{ kind: "command", any: ["playerctl"], why: "playerctl is not installed, so there is no way to reach the player" }],
    skill: "media-control",
    result: "action",
  },
  {
    id: "file-screenshot",
    summary: "move the most recent screenshots into a project folder",
    aliases: ["screenshot project", "move screenshot", "file screenshot", "save screenshot", "screenshots project", "captura proyecto", "mover captura", "guardar captura"],
    requires: [
      { kind: "workspace", id: "pictures", why: "there is no Pictures folder on this machine" },
      { kind: "workspace", id: "projects", why: "there is no Projects folder on this machine" },
    ],
    skill: "file-screenshot",
    result: "action",
  },
  {
    id: "system-status",
    summary: "report disk, memory, uptime and what is using the machine",
    aliases: ["system status", "disk space", "disk usage", "memory usage", "machine status", "system report", "estado sistema", "espacio disco", "uso memoria"],
    requires: [],
    skill: "system-status",
    result: "answer",
  },
  {
    id: "git-housekeeping",
    summary: "check every repo under Projects and report what needs attention",
    aliases: ["git status", "git repos", "check repos", "repos attention", "repository status", "git housekeeping", "estado repos", "revisar repos"],
    requires: [
      { kind: "command", any: ["git"], why: "git is not installed" },
      { kind: "workspace", id: "projects", why: "there is no Projects folder on this machine" },
    ],
    skill: "git-housekeeping",
    result: "answer",
  },
  {
    id: "download-and-file",
    summary: "download a URL and put it in the right folder with a sensible name",
    aliases: ["download url", "download file", "download save", "fetch url", "descargar enlace", "descargar archivo", "bajar archivo"],
    requires: [
      { kind: "command", any: ["curl", "wget"], why: "neither curl nor wget is installed" },
      { kind: "workspace", id: "downloads", why: "there is no Downloads folder on this machine" },
    ],
    skill: "download-and-file",
    result: "action",
  },
  {
    id: "archive-old-files",
    summary: "archive files older than a cutoff into a dated tarball",
    aliases: ["archive old", "archive files older", "compress old", "old files archive", "archivar viejos", "archivar antiguos", "comprimir viejos"],
    requires: [{ kind: "command", any: ["tar"], why: "tar is not installed" }],
    skill: "archive-old-files",
    result: "action",
  },
  {
    id: "launch-app",
    summary: "start an installed application",
    aliases: ["launch application", "launch app", "open application", "start application", "abrir aplicacion", "lanzar aplicacion", "gtk-launch"],
    requires: [{ kind: "command", any: ["gtk-launch", "gio", "xdg-open"], why: "no desktop launcher was found on PATH" }],
    skill: "launch-app",
    result: "action",
  },
  {
    id: "find-file",
    summary: "find a file from a vague description of it",
    aliases: ["find file", "locate file", "search file", "which file", "find document", "buscar archivo", "encontrar archivo", "donde archivo"],
    requires: [{ kind: "command", any: ["rg", "grep"], why: "neither ripgrep nor grep is installed" }],
    skill: "find-file",
    result: "answer",
  },
]

export function byId(id: string) {
  return MACROS.find((macro) => macro.id === id)
}
