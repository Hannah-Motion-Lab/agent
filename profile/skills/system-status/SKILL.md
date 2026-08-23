---
name: system-status
description: Report disk, memory, load and uptime for this machine. Use when the user asks how the computer is doing or about disk space.
---

# Reporting system status

The result of this task **is** the report, so write it for a person, not a
terminal.

Gather: `df -h` for the real filesystems, `free -h`, `uptime`, and the top few
processes by memory (`ps -eo comm,pmem,rss --sort=-rss | head`).

Rules:

1. **Skip the noise.** No `tmpfs`, no loop devices, no snap mounts. A person
   asking about disk space means their disk.
2. **Lead with anything that is actually a problem** — a filesystem over 90%,
   swap in use, an absurd uptime. If nothing is wrong, say that first and
   briefly; a clean machine deserves one sentence, not a table.
3. **Use units a person reads.** "38 GB free of 500" beats "393216 blocks".
4. **Do not editorialise about processes you do not understand.** Naming a
   process as a memory hog because it is at the top of a list is how you get
   someone to kill their window manager.
5. Keep it under ten lines. The detail is on screen; the voice gets two
   sentences of it.
