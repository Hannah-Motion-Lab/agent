---
name: file-screenshot
description: Move recent screenshots out of Pictures into a project folder. Use when the user asks to file, move or save a screenshot somewhere.
---

# Filing a screenshot

1. **Find the newest screenshots** in the pictures folder by modification time.
   Screenshot filenames vary by desktop (`Screenshot_*`, `Captura*`, `grim_*`),
   so sort by time first and use the name only to confirm.
2. **Take one unless the user said otherwise.** "Save the screenshot" means the
   last one. "The screenshots from today" means today's.
3. **Confirm the target project** the same way `open-project` does, and ask if
   more than one matches.
4. **Put it somewhere conventional** — `docs/`, `assets/` or `screenshots/` if
   one exists; otherwise create `screenshots/`. Do not scatter images in the
   repository root.
5. **Rename it to something meaningful** if the user described what it shows:
   `login-error.png` beats `Screenshot_20260822_101533.png`. Keep the extension.
6. **Move, do not copy.** Filing a screenshot means it stops being in Pictures.
   Say where it ended up, with the path.
