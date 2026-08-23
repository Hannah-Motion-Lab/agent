---
name: organize-downloads
description: Sort a downloads folder into subfolders by file type. Use when the user asks to tidy, organise or clean up their Downloads.
---

# Organising a downloads folder

Work in the folder you were given. Do not touch anything outside it.

1. **Look first.** List the folder with sizes and modification times before
   moving anything. Report how many files there are and roughly what they are.
2. **Group by kind, not by extension alone.** Images, documents, archives,
   installers, media, code. A `.gz` inside a folder of source tarballs is an
   archive; the same file next to installers is an installer. Use judgement.
3. **Create only the folders you will actually fill.** An empty `Videos/` the
   user has to delete later is a small betrayal of the request.
4. **Never overwrite.** If the destination exists, keep both and suffix the
   incoming one — `report.pdf` becomes `report (2).pdf`. Losing a file to a
   tidy-up is the one unrecoverable failure of this job.
5. **Leave the ambiguous ones alone.** Files you cannot classify stay where they
   are. Say which they were and why. Guessing wrong scatters things the user
   knows how to find.
6. **Do not descend into existing subfolders.** They are already organised, by
   the user, in a way you do not know.

Report the counts per folder and anything you deliberately left behind.
