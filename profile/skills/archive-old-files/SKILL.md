---
name: archive-old-files
description: Archive files older than a cutoff into a dated tarball. Use when the user asks to clean up, archive or compress old files.
---

# Archiving old files

1. **Agree the cutoff first.** If the user did not give one, propose ninety days
   and wait. "Old" is not a measurement.
2. **List what would be archived and how much it comes to, before doing it.**
   This is the step that makes the difference between a tidy-up and a loss.
3. **Archive, verify, then remove — in that order.** Create
   `archive-YYYY-MM-DD.tar.gz`, list the archive back (`tar -tzf`) to confirm
   the contents, and only then remove the originals.
4. **Prefer the trash over `rm`** for the originals if a trash tool exists. The
   whole point of archiving is that nothing is lost; deleting irreversibly at
   the last step contradicts the job.
5. **Never archive across the whole home directory**, dotfiles, or anything
   under a hidden folder. Stay inside the folder you were pointed at.
6. Say where the archive is, how big it is, and how many files it holds.
