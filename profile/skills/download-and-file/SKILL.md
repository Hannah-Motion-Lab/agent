---
name: download-and-file
description: Download a URL and save it into the right folder with a sensible name. Use when the user asks to download or fetch something from the web.
---

# Downloading and filing

1. **Show the URL and ask before fetching.** Reaching the network is an approval
   boundary; the user should see the exact address, not a description of it.
2. **Use `curl -fSL -o <path>`** (or `wget -O`). `-f` matters: without it a 404
   page is saved as if it were the file, and the user finds out days later.
3. **Name it from the content, not the URL.** A URL ending in `?id=8134` should
   not become `8134`. Use the `Content-Disposition` filename when present, or
   ask the user what to call it.
4. **Save into the downloads folder** unless the user named somewhere else. Do
   not invent a new folder for one file.
5. **Verify before reporting.** Check the file exists and its size is plausible.
   Reporting a successful download of a zero-byte file is worse than reporting
   a failure.
6. Say the final path and the size.
