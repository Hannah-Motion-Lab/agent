---
name: launch-app
description: Start an installed desktop application. Use when the user asks to open or launch an app by name.
---

# Launching an application

1. **Find the desktop entry before launching.** Search
   `/usr/share/applications` and `~/.local/share/applications` for a `.desktop`
   file whose `Name=` matches what the user said.
2. **If nothing matches, say so.** Do not fall back to running the word the user
   said as a shell command — that is how "open notes" becomes an unpredictable
   binary.
3. **If several match, ask.** "Open the browser" with three installed is a
   question, not a guess.
4. **Launch detached** with `gtk-launch <id>` (or `gio launch`), so the task
   ends immediately. Never hold the task open for the lifetime of the app.
5. Confirm by the application's real name, not the id.
