// Block-letter wordmark, drawn in two differently shaded halves ("HAN" | "NAH").
// Mark characters are resolved by the renderers: `_` filled space, `^` foreground
// half-block, `~` shadow half-block. Every row must stay the same width.
export const logo = {
  left: ["              ", "█__█ █▀▀█ █▀▀▄", "█^^█ █^^█ █__█", "▀__▀ ▀__▀ ▀~~▀"],
  right: ["           ▄  ", "█▀▀▄ █▀▀█ █__█", "█__█ █^^█ █^^█", "▀~~▀ ▀__▀ ▀__▀"],
}

export const go = {
  left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
}

export const marks = "_^~,"
