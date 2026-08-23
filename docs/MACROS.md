# Macro library

> Status: **v1 shipped (M3.2, 2026-08-22).** Ten macros, ten skills, six
> sandboxed trials. The ≥9/10 acceptance bar needs a model — see
> [Trials](#trials).

A macro is not code. It is three things:

1. a **name** the persona can offer,
2. a set of **requirements** that decide whether it may be offered at all,
3. a **skill** the agent loads when the task starts.

The instructions live in `profile/skills/<skill>/SKILL.md` and are loaded by the
engine's own skill mechanism. `scripts/install-profile.sh` copies them into
`~/.config/hannah-agent/skill/`, which the engine already scans — there is no
`skills.paths` entry and nothing pointing back at this checkout.

## The rule that shapes everything here

**Never offer what this machine cannot do.** A macro whose tool is missing is
absent from the catalog, so the persona never learns it exists and cannot
promise it. Failing halfway is worse than never offering, because by then Hannah
has already said she would.

That is the same shape as the `[TASK:]` tag (absent from the prompt when the
sidecar is down) and the workspace list (only folders that exist). Degradation
lives in what is offered, not in error handling.

## Matching

The agent guesses the macro from the task prompt, by **word set**: an alias
matches when all of its words appear as whole words anywhere in the prompt. The
literal phrase almost never survives a real request — "Organize ~/Downloads into
folders by file type" contains both words of `organize downloads` and none of
the literal string.

Tuned for **precision, not coverage**: a miss loads no skill and the agent still
does the job from the prompt; a wrong match loads instructions for a different
job. The backend can also name a macro explicitly on the create call, and an
explicit id for an *unavailable* macro resolves to nothing rather than to the
macro — the caller's catalog was stale.

## The library

| Macro | Result | Needs | Trial |
| --- | --- | --- | --- |
| `organize-downloads` | action | Downloads folder | sandboxed |
| `open-project` | action | Projects folder, an editor on PATH | manual |
| `media-control` | action | `playerctl` | manual |
| `file-screenshot` | action | Pictures + Projects folders | sandboxed |
| `system-status` | answer | — | sandboxed |
| `git-housekeeping` | answer | `git`, Projects folder | sandboxed |
| `download-and-file` | action | `curl` or `wget`, Downloads folder | manual |
| `archive-old-files` | action | `tar` | sandboxed |
| `launch-app` | action | `gtk-launch`, `gio` or `xdg-open` | manual |
| `find-file` | answer | `rg` or `grep` | sandboxed |

`result: answer` means the task's output **is** the deliverable, so it travels
the answer path (M3.0): the HUD gets the full text, the voice gets two
sentences.

### organize-downloads
Sorts a downloads folder into subfolders by kind. Never overwrites — a
collision keeps both and suffixes the incoming file, because losing a file to a
tidy-up is the one unrecoverable failure of this job. Files it cannot classify
stay where they are and are named in the report; guessing wrong scatters things
the user knows how to find. Existing subfolders are left alone.

### open-project
Finds the project by loose match, asks when more than one plausibly fits, and
launches the first editor on PATH **detached** so the task does not stay open
for the editor's lifetime. Reports the real folder name, so a wrong guess is
obvious immediately.

### media-control
`playerctl` against whatever MPRIS player is active. Relative volume steps only —
never an absolute level the user did not name. Reports what is playing after a
track change, because that is the point of asking for "next". Does not start a
player if none is running.

### file-screenshot
Finds the newest screenshot by modification time (names vary by desktop), files
it under `docs/`, `assets/` or `screenshots/` in the target project, and renames
it to something meaningful if the user described what it shows. **Moves, not
copies** — filing means it stops being in Pictures.

### system-status
Disk, memory, load, uptime, top processes. Skips `tmpfs`, loop devices and snap
mounts; leads with anything actually wrong and says so in one sentence when
nothing is. Does not editorialise about processes it does not understand —
naming a process a memory hog because it topped a list is how someone kills
their window manager.

### git-housekeeping
Surveys immediate children of the projects folder. **Read-only without
exception**: no pull, fetch, commit or stash. The user asked what the state is,
not for it to change. Reports by exception — a clean repo is one word.

### download-and-file
Shows the URL and waits, because reaching the network is an approval boundary
and the user should see the address rather than a description of it. Uses
`curl -fSL`; the `-f` matters, since without it a 404 page is saved as if it
were the file. Verifies the result before reporting — a successful download of a
zero-byte file is worse than a reported failure.

### archive-old-files
Agrees the cutoff first ("old" is not a measurement), lists what would go and
how much it comes to, then archives, **verifies the archive**, and only then
removes the originals — preferring the trash. Never crosses into the home
directory or hidden folders.

### launch-app
Resolves a `.desktop` entry by `Name=` before launching, and says so when
nothing matches rather than running the user's word as a shell command. Asks
when several match. Launches detached.

### find-file
Two searches, not one: by name and by content, because "the invoice from March"
may describe either. Skips hidden directories, credential stores and
`node_modules` — for noise as much as privacy. At most five candidates, ranked
by plausibility; twenty results is the same as none. An honest empty answer
naming what was searched lets the user correct the description.

## Trials

```bash
bun run scripts/macro-trials.ts --dry              # no model, no sidecar
bun run scripts/macro-trials.ts --runs 10          # the acceptance bar
bun run scripts/macro-trials.ts --macro find-file
```

Each trial builds a disposable sandbox, runs the task against the real façade,
and checks an outcome a wrong answer cannot fake. A check that merely looked for
"the task completed" would pass while the macro did nothing — so
`organize-downloads` counts the files afterwards, `git-housekeeping` asserts the
working tree is *unchanged*, and `file-screenshot` asserts the original is gone
from Pictures.

The bar is 9/10, not 10/10: a model is allowed one bad day, not a habit.

**The full run needs a sidecar and a model.** That is not a gap in the harness —
"≥9/10" is a claim about a model's behaviour and cannot be asserted from source.
`--dry` runs everything around it (availability gating, sandbox construction,
the checks being callable) and runs in CI.

Four macros have no sandboxed trial: `open-project`, `media-control`,
`launch-app` and `download-and-file` act on the live desktop or the network, and
a disposable directory cannot contain them. They are verified by hand against
the sections above.

## Adding one

1. Append to `MACROS` in `packages/agent/src/hannah/macros/catalog.ts` — id,
   summary, aliases (both languages, accent-free lowercase), requirements,
   skill name, `action` or `answer`.
2. Write `profile/skills/<skill>/SKILL.md` with matching frontmatter `name:`.
   `test/hannah/macros.test.ts` fails if the two disagree, because a pointer to
   a skill that does not exist resolves to nothing at runtime and no one notices.
3. Add a trial to `scripts/macro-trials.ts` if a sandbox can contain it.
4. Add a section above.
