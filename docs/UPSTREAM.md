# Upstream Policy — relationship to opencode

> Status: policy baseline (formalized as ADR-0004).

## Provenance

- Forked from **opencode v1.18.18** (github.com/anomalyco/opencode, MIT),
  obtained as a **source snapshot on 2026-08-14 — without git history**.
- License obligations: upstream's MIT copyright notice stays verbatim in
  `LICENSE`; the root README credits the origin. That is the entirety of the
  legal requirement; we honor it plus a courtesy mention in release notes.

## Stance: hard fork, frozen base

We are **not** a downstream distribution. We do not track upstream releases,
do not chase their v1→v2 migration, and freely rewrite anything behind the
Hannah façade. Upstream is treated as a *reference implementation and fix
mine*, nothing more.

What we still take from upstream, selectively:

1. **Security fixes** in code paths we run (check at every phase-end checkpoint).
2. **Provider/protocol updates** when a model API change breaks us
   (`@hannah/llm`, auth flows) and porting is cheaper than patching ourselves.
3. Nothing else by default.

## Working without git history

Because the snapshot has no history, "diffing against upstream" needs a
reference clone:

```bash
# one-time, outside this repo
git clone https://github.com/anomalyco/opencode /tmp/upstream-oc
git -C /tmp/upstream-oc checkout v1.18.18

# compare a file we care about (account for our renames)
diff -u /tmp/upstream-oc/packages/opencode/src/session/foo.ts \
        packages/agent/src/session/foo.ts
```

To evaluate an upstream fix: locate it in upstream history
(`git -C /tmp/upstream-oc log --oneline vX..vY -- path`), then re-apply the
*idea* (not the patch) here — automated `git am` will not survive our renames
(`@hannah/*`, `HANNAH_AGENT_*`, `packages/agent`). Translate identifiers per
DEBRANDING.md's rename table, then port by hand.

## Phase-end checkpoint procedure (ROADMAP cross-cutting)

1. Skim upstream releases/advisories since last checkpoint.
2. For each candidate fix: does it touch a file we run (v1 path) or a package
   we deleted/froze? Deleted → ignore. Frozen v2 → usually ignore.
3. Port qualifying fixes as normal PRs with a `ledger` entry below.
4. Update the "last reviewed" line here.

Last reviewed: — (never; first checkpoint due at end of P0).

## Divergence ledger

Every deliberate behavioral divergence from the v1.18.18 base gets a line, so
future-us can answer "is this ours or theirs?" in seconds.

| Date | Area | Divergence | Ref |
| --- | --- | --- | --- |
| 2026-08-14 | repo | Pruned to headless engine (17 packages/surfaces deleted) | ADR-0003 |
| 2026-08-14 | identity | Scope/binary/env renames | ADR-0002 |
| 2026-08-14 | build | Web-UI embedding removed from `script/build.ts` | ADR-0003 |
| — | (next: config dirs, disabled cloud services, façade) | | ADR-0008/0009/0006 |

## What we promise not to break (for our own sanity)

- The engine's session/message/permission data model semantics — the façade
  depends on them.
- `patches/` and their matching source tokens.
- The `bun` + turbo + tsgo toolchain (upgrades allowed, replacements need an ADR).
