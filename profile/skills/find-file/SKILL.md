---
name: find-file
description: Find a file from a vague description of it. Use when the user cannot remember a filename but knows something about the file.
---

# Finding a file from a description

The result of this task **is** the answer. Read, never modify.

1. **Turn the description into two searches, not one.** Name-based
   (`find … -iname`) and content-based (`rg -l`). A user who says "the invoice
   from March" may be describing either.
2. **Search where it plausibly is, then widen.** Start with the folder you were
   given; only expand if nothing turns up, and say that you widened.
3. **Never search inside hidden directories, credential stores, or
   `node_modules`.** Not just for privacy — the noise buries the answer.
4. **Rank by plausibility, not by filesystem order.** Recency and folder
   relevance beat alphabetical.
5. **Report at most five candidates**, each with its path, size and modification
   date, best first. Twenty results is the same as none.
6. If nothing matches, say what you searched and where. An honest empty answer
   lets the user correct the description; a silent one does not.
