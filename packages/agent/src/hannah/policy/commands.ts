export * as PolicyCommands from "./commands"

import { HannahEnv } from "../env"

/**
 * Danger-command detection (SECURITY T2, §7).
 *
 * Scope, stated honestly: this is a **speed bump against the model doing
 * something catastrophic**, not a sandbox against an adversary. Shell is not
 * a regular language and a determined attacker who already controls the
 * command string can evade any textual scanner. The real containment for
 * autonomous mode is an OS sandbox (ADR-pending, M4.1). What this module buys
 * is that a confused or injected model cannot reach `rm -rf ~`, `curl | sh`,
 * or `sudo` through the ordinary phrasings — including the indirection shapes
 * SECURITY §7 lists (`bash -c`, heredocs, `xargs`, `find -exec`) and `ssh`,
 * which the checklist does not name and which hid an entire remote command
 * line behind a command word of `ssh`.
 */

export type Finding = {
  readonly command: string
  readonly reason: string
  readonly rule: string
}

/** Commands that are never run, in any preset. */
const DENIED_COMMANDS: ReadonlyArray<{ match: RegExp; reason: string }> = [
  { match: /^sudo$/, reason: "privilege escalation" },
  { match: /^doas$/, reason: "privilege escalation" },
  { match: /^su$/, reason: "privilege escalation" },
  { match: /^pkexec$/, reason: "privilege escalation" },
  { match: /^mkfs(\.\w+)?$/, reason: "formats a filesystem" },
  { match: /^fdisk$/, reason: "repartitions a disk" },
  { match: /^parted$/, reason: "repartitions a disk" },
  { match: /^shred$/, reason: "irrecoverable destruction" },
  { match: /^mkswap$/, reason: "reformats swap" },
  { match: /^chpasswd$/, reason: "changes account passwords" },
  { match: /^passwd$/, reason: "changes account passwords" },
  { match: /^useradd$|^userdel$|^usermod$/, reason: "modifies system accounts" },
  { match: /^visudo$/, reason: "edits sudoers" },
  { match: /^systemctl$/, reason: "controls system services" },
  { match: /^shutdown$|^reboot$|^halt$|^poweroff$/, reason: "powers off the machine" },
  { match: /^iptables$|^nft$|^ufw$/, reason: "changes firewall rules" },
]

/** Argument-sensitive rules: the command is fine until it is pointed somewhere. */
const DENIED_INVOCATIONS: ReadonlyArray<{ match: (tokens: readonly string[]) => boolean; reason: string; rule: string }> =
  [
    {
      rule: "dd-to-device",
      reason: "writes directly to a device",
      match: (t) => t[0] === "dd" && t.some((arg) => /^of=\/dev\//.test(arg)),
    },
    {
      rule: "rm-rf-root",
      reason: "recursive delete of a home or system root",
      match: (t) => {
        if (t[0] !== "rm") return false
        const recursive = t.some((arg) => /^-[a-z]*[rR]/.test(arg))
        if (!recursive) return false
        return t.slice(1).some((arg) => {
          if (arg.startsWith("-")) return false
          // Keep a bare "/" — stripping trailing slashes would empty it.
          const target = arg === "/" ? "/" : arg.replace(/\/+$/, "") || "/"
          return (
            target === "/" ||
            target === "~" ||
            target === "$HOME" ||
            target === "/*" ||
            /^~\/?\*?$/.test(target) ||
            /^\/(home|usr|etc|var|bin|sbin|lib|boot|opt|root)(\/\*)?$/.test(target)
          )
        })
      },
    },
    {
      rule: "chmod-777-root",
      reason: "opens permissions on a system tree",
      match: (t) => t[0] === "chmod" && t.some((a) => /^(0?777|a\+rwx)$/.test(a)) && t.some((a) => /^\/(etc|usr|$)/.test(a)),
    },
    {
      rule: "global-package-install",
      reason: "installs software system-wide",
      match: (t) => {
        const [cmd, ...rest] = t
        if (!cmd) return false
        if (/^(apt|apt-get|dnf|yum|pacman|zypper|apk|brew|snap|flatpak)$/.test(cmd)) {
          return rest.some((a) => /^(install|remove|upgrade|-S|-R|-U|add|del)$/.test(a))
        }
        if (/^(npm|pnpm|yarn|bun)$/.test(cmd)) {
          const installing = rest.some((a) => /^(i|install|add|create)$/.test(a))
          return installing && rest.some((a) => a === "-g" || a === "--global")
        }
        if (cmd === "pip" || cmd === "pip3") {
          return rest.some((a) => a === "install") && !rest.some((a) => /^(--user|-t|--target)$/.test(a))
        }
        if (cmd === "cargo") return rest.some((a) => a === "install")
        return false
      },
    },
    {
      rule: "history-wipe",
      reason: "erases shell history",
      match: (t) => t[0] === "history" && t.some((a) => a === "-c"),
    },
  ]

/** `curl … | sh` and friends: fetching code and executing it unread. */
const PIPE_TO_SHELL = /\b(curl|wget|fetch)\b[^|;&\n]*\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/i

/** Shells that take a command string in an argument. */
const SHELL_C = /^(sh|bash|zsh|ksh|dash|fish|busybox|env)$/

/**
 * ssh options that take their value as the *following* token. Everything else
 * starting with `-` is either a boolean flag (`-t`, `-N`, `-4`) or the attached
 * form of one of these (`-p2222`, `-oBatchMode=yes`), which carries its value
 * inside the token and consumes nothing.
 *
 * Erring on the eager side is the expensive mistake: skipping one token too
 * many eats the destination, the remote command shifts left, and `rm -rf /`
 * arrives as `-rf /`, which matches no rule at all. So only the exact
 * two-character forms consume.
 */
const SSH_VALUE_FLAGS = /^-[bcDEeFIiJLlmOopQRSWw]$/

/** Where a new command can begin inside a compound line. */
const SEPARATORS = /(?:\|\||&&|[;|&\n]|\$\(|`)/

function stripQuotes(token: string) {
  const quoted = /^(['"])(.*)\1$/s.exec(token)
  return quoted ? quoted[2] : token
}

/** Split a command line into whitespace tokens, honoring simple quoting. */
export function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quote: string | undefined
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === "\\" && i + 1 < input.length) {
      current += input[++i]
      continue
    }
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

/**
 * Yield every fragment that will be executed as a command line, recursively:
 * the line itself, each `;`/`&&`/`|` segment, the string argument of `sh -c`,
 * the body of a heredoc, whatever `xargs` or `find -exec` will run, the remote
 * command handed to `ssh`, and the inside of `$(…)` / backtick substitutions.
 */
function* fragments(input: string, depth = 0): Generator<string> {
  if (depth > 6 || !input.trim()) return
  yield input

  // Heredoc bodies are executed when fed to a shell, and they hide the payload
  // from any scanner that only looks at the first line.
  const heredoc = /<<-?\s*'?"?(\w+)'?"?\n([\s\S]*?)\n\s*\1\b/g
  for (const match of input.matchAll(heredoc)) {
    yield* fragments(match[2], depth + 1)
  }

  // Command substitution.
  for (const match of input.matchAll(/\$\(([^()]*)\)/g)) yield* fragments(match[1], depth + 1)
  for (const match of input.matchAll(/`([^`]*)`/g)) yield* fragments(match[1], depth + 1)

  for (const raw of input.split(SEPARATORS)) {
    const segment = raw.trim()
    if (!segment || segment === input.trim()) continue
    yield* fragments(segment, depth + 1)
  }

  const tokens = tokenize(input)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    // `sh -c "…"` / `bash -lc "…"` — the payload is the next token.
    if (SHELL_C.test(token)) {
      const flag = tokens.findIndex((t, index) => index > i && /^-[a-z]*c$/.test(t))
      if (flag !== -1 && tokens[flag + 1]) yield* fragments(stripQuotes(tokens[flag + 1]), depth + 1)
    }

    // `xargs rm -rf /` — skip xargs' own flags, then take the rest verbatim.
    // Filtering every `-flag` would strip the target command's flags too, and
    // `rm /` reads far less dangerous than the `rm -rf /` actually being run.
    if (token === "xargs") {
      let j = i + 1
      while (j < tokens.length && tokens[j].startsWith("-")) {
        const flag = tokens[j]
        j++
        if (/^-(I|i|n|P|L|s|d|E|a)$/.test(flag) && j < tokens.length) j++
      }
      const rest = tokens.slice(j)
      if (rest.length) yield* fragments(rest.join(" "), depth + 1)
    }

    // `ssh host rm -rf /` — the payload runs on the far end, but the agent is
    // still the thing that caused it to run, so it goes through the same rules.
    //
    // DECISION: the remote payload is scanned as a full command line, so the
    // argument-sensitive rules judge REMOTE arguments against a LOCAL list.
    // That is deliberate and it is bounded to the rules whose arguments are
    // universal rather than personal: `rm -rf /`, `dd of=/dev/sda`,
    // `chmod 777 /etc` name system roots that mean the same catastrophic thing
    // on any Unix host, so the false positives are shapes worth refusing
    // anyway. The sensitive-path denylist is deliberately NOT extended out
    // here: `~/.aws` over there is somebody else's directory, and a deny at
    // this layer is unappealable, so classifying every remote path against
    // this machine's secrets would refuse ordinary remote work with no way to
    // say yes. (Policy.evaluate tokenizes the raw line for that layer already,
    // so `ssh host cat ~/.ssh/id_rsa` was denied long before this arm existed;
    // recursing here neither adds nor removes that.) The cost of drawing the
    // line where it is drawn is real and accepted: `ssh deploy sudo systemctl
    // restart nginx` is now refused outright.
    //
    // `scp` and `rsync` stay uncovered. Neither carries a remote command in a
    // position that can be parsed with this much confidence (rsync hides one
    // behind `-e` and `--rsync-path`, scp has none at all), and a half-parsed
    // arm that skips the wrong token denies file copies for no benefit.
    if (token.replace(/^.*\//, "") === "ssh") {
      let j = i + 1
      while (j < tokens.length && tokens[j].startsWith("-")) {
        const flag = tokens[j]
        j++
        if (SSH_VALUE_FLAGS.test(flag) && j < tokens.length) j++
      }
      // The first non-flag token is the destination (`user@host` or a config
      // alias); everything after it is the remote command. Nothing after it is
      // an interactive login, which has no payload to scan.
      const rest = tokens.slice(j + 1)
      if (rest.length) yield* fragments(rest.join(" "), depth + 1)
    }

    // `find . -exec rm {} \;` / `-execdir` / `-delete`.
    if (token === "-exec" || token === "-execdir") {
      const rest: string[] = []
      for (let j = i + 1; j < tokens.length && tokens[j] !== ";" && tokens[j] !== "+"; j++) rest.push(tokens[j])
      if (rest.length) yield* fragments(rest.join(" "), depth + 1)
    }
  }
}

/** The leading command word of a fragment, ignoring env assignments. */
function commandWord(tokens: readonly string[]): string | undefined {
  for (const token of tokens) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue // FOO=bar cmd
    if (token === "command" || token === "builtin" || token === "exec" || token === "nohup" || token === "time") continue
    // Use the basename so /usr/bin/sudo and ./sudo are both caught.
    return token.replace(/^.*\//, "")
  }
  return undefined
}

/**
 * Scan a shell command for anything on the never-run list. Returns every
 * distinct finding so the refusal can explain itself.
 */
export function scan(input: string): Finding[] {
  const findings: Finding[] = []
  const seen = new Set<string>()

  const add = (command: string, reason: string, rule: string) => {
    const key = `${rule}:${command}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ command, reason, rule })
  }

  if (PIPE_TO_SHELL.test(input)) {
    add(input.trim(), "downloads and executes a script without review", "pipe-to-shell")
  }

  for (const fragment of fragments(input)) {
    const tokens = tokenize(fragment)
    if (!tokens.length) continue
    const word = commandWord(tokens)
    if (!word) continue

    for (const rule of DENIED_COMMANDS) {
      if (rule.match.test(word)) add(word, rule.reason, `command:${word}`)
    }

    // Argument rules run against the tokens from the command word onward.
    // Only the *leading* `FOO=bar` prefix is an env assignment — dropping every
    // `key=value` token would also eat `dd if=… of=/dev/sda`.
    let start = 0
    while (start < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start])) start++
    const normalized = tokens.slice(start)
    if (normalized.length) {
      normalized[0] = normalized[0].replace(/^.*\//, "")
      for (const rule of DENIED_INVOCATIONS) {
        if (rule.match(normalized)) add(normalized.join(" "), rule.reason, rule.rule)
      }
    }
  }

  return findings
}

/** True when the command must never run. */
export function isDangerous(input: string) {
  return scan(input).length > 0
}

/** The rule set as data, for documentation and tests. */
/**
 * The trash tool available on this machine, if any.
 *
 * `rm` is not reversible and a voice assistant is exactly the wrong thing to
 * hand an irreversible verb: an approval granted by a mishearing costs nothing
 * if the files are recoverable and everything if they are not. When a trash
 * tool exists the agent is told to prefer it (M3.1); when it does not, `rm`
 * stays available and stays high risk. Nothing is silently rewritten — the
 * agent chooses, and the user still approves.
 */
let trash: { command: string; template: string } | null | undefined

const TRASH_TOOLS: ReadonlyArray<{ command: string; template: string }> = [
  { command: "gio", template: "gio trash <path>" },
  { command: "trash-put", template: "trash-put <path>" },
  { command: "trash", template: "trash <path>" },
]

export function trashTool() {
  if (trash !== undefined) return trash
  trash = TRASH_TOOLS.find((tool) => HannahEnv.which(tool.command)) ?? null
  return trash
}

/** Test seam: forget the detected trash tool. */
export function resetTrashTool() {
  trash = undefined
  HannahEnv.reset()
}

/** Does this command move things to the trash rather than destroy them? */
export function isTrashCommand(input: string) {
  const flat = input.trim()
  return /^(gio\s+trash|trash-put|trash)\b/.test(flat)
}

export function rules() {
  return {
    commands: DENIED_COMMANDS.map((rule) => String(rule.match)),
    invocations: DENIED_INVOCATIONS.map((rule) => rule.rule),
    pipeToShell: String(PIPE_TO_SHELL),
  }
}
