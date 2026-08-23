---
name: git-housekeeping
description: Survey every git repository under the projects folder and report what needs attention. Use for "check my repos" or "git status" across projects.
---

# Git housekeeping

The result of this task **is** the report. Read, never write.

For each immediate subdirectory of the projects folder that contains `.git`:

- `git -C <repo> status --short --branch`
- `git -C <repo> log --oneline @{u}.. 2>/dev/null` for unpushed commits

Rules:

1. **Read-only, without exception.** Do not pull, fetch, commit, stash, or touch
   a branch. The user asked what the state is, not for it to be changed. If
   something clearly wants doing, say so and let them ask.
2. **Report by exception.** A clean repo is one word. Spend the space on the
   ones with uncommitted changes, unpushed commits, or a detached HEAD.
3. **Do not recurse.** Immediate children only — a `node_modules` full of
   vendored git repos is not the user's work.
4. **A missing upstream is not a problem**, it is a local branch. Say it
   neutrally.
5. End with the one repo that most needs attention, or say that none do.
