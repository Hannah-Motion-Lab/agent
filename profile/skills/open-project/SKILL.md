---
name: open-project
description: Open one of the user's projects in their editor. Use when the user asks to open, launch or start work on a project or repository.
---

# Opening a project

1. **Find the project before launching anything.** List the immediate children
   of the projects folder and match against what the user said. Match loosely —
   "the motion one" should find `hannah-motion-lab`.
2. **If two or more plausibly match, ask.** Do not pick the first. Opening the
   wrong project is a small annoyance the first time and an erosion of trust the
   third.
3. **Pick the editor already on PATH** — check `code`, `zed`, `subl`, `idea`,
   then `nvim`. Prefer one the user has mentioned before if you know it.
4. **Launch detached.** The editor must not hold the task open: start it in the
   background and return. A task that never ends looks like a hung one.
5. **Say what you opened**, by its real folder name, so a wrong guess is obvious
   immediately rather than ten minutes later.
