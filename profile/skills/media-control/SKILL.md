---
name: media-control
description: Control media playback and volume with playerctl. Use for play, pause, next, previous, and volume requests.
---

# Controlling playback

Use `playerctl`. It speaks to whatever MPRIS player is active, so it works for
browsers, Spotify and local players alike.

- Play / pause: `playerctl play-pause`
- Next / previous: `playerctl next`, `playerctl previous`
- What is playing: `playerctl metadata --format '{{artist}} — {{title}}'`
- Volume: `playerctl volume 0.1+` / `playerctl volume 0.1-`

Rules:

1. **Check there is a player first** (`playerctl status`). If nothing is
   running, say so — do not start one. The user asked to pause music, not to
   begin some.
2. **Never set an absolute volume the user did not name.** Relative steps only.
   Jumping to full volume is the kind of mistake that gets an assistant muted
   permanently.
3. **Report what is playing after a track change**, in one short line. That is
   the whole point of asking for "next".
4. If several players are active, target the one that is playing rather than the
   first one listed.
