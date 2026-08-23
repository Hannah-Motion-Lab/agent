# hannah-agent documentation

The bases of the project. Code comes after these; when code and docs disagree,
one of them is a bug — fix it in the same change.

## Reading order (first time)

1. [VISION.md](VISION.md) — what this is, the two-brains model, pillars,
   scenarios, non-goals.
2. [ARCHITECTURE.md](ARCHITECTURE.md) — the engine we forked (verified anatomy
   + audit checklist), the target system, where new code lives.
3. [ROADMAP.md](ROADMAP.md) — phases P0–P4, milestones with acceptance
   criteria, risks, open decision queue. **The working document.**
4. [INTEGRATION.md](INTEGRATION.md) — the `/hannah/v0` contract: API, event
   vocabulary, backend/WS mappings, approval & barge-in flows.
5. [SECURITY.md](SECURITY.md) — threat model, permission architecture,
   audit/privacy rules, hardening checklists.

Reference, as needed:

- [PROFILE.md](PROFILE.md) — the Hannah profile: the agent brain, the
  `companion` preset, catalog egress, and the boot matrix that verifies a machine.
- [COEXISTENCE.md](COEXISTENCE.md) — how this sidecar sits next to the other
  four repos, what it overlaps with, and what to change where. **Read before
  enabling it on a machine that already runs Hannah.**
- [KNOWN-GAPS.md](KNOWN-GAPS.md) — what is knowingly incomplete, why, and the
  approach for closing each one. Reviewed at every phase boundary.
- [MACROS.md](MACROS.md) — the macro library, its availability rule, and trials.
- [DEBRANDING.md](DEBRANDING.md) — rename ledger: done / remaining / never.
- [UPSTREAM.md](UPSTREAM.md) — fork policy, sync procedure, divergence ledger.
- [GLOSSARY.md](GLOSSARY.md) — the words and what they mean here.
- [decisions/](decisions/README.md) — ADRs 0001–0012, **all accepted**.
- [audit/](audit/) — M0.1 engine audit (verified anatomy, egress inventory,
  façade seams) and M0.4 test baseline (suite results, quarantine policy).

## Status at a glance

- **Phase 0 complete (2026-08-18)** — engine audited, de-branding finished,
  version reset to `0.1.0`, CI added, test baseline green with nothing
  quarantined, and **all 11 ADRs accepted**. The one open P0 item is the
  GitHub upload itself (M0.3), which is the owner's step.
- **M1.1 done (2026-08-19)**: the Hannah profile ships in
  [`profile/`](../profile/) with an installer, a guard test, and a four-case
  boot matrix — see [PROFILE.md](PROFILE.md). The model catalog now defaults to
  models.dev instead of the fork parent's mirror (ADR-0009's open question).
- **M1.2 done (2026-08-19)**: the policy layer in
  `packages/agent/src/hannah/policy/` — sensitive-path denylist, danger-command
  scanner (all SECURITY §7 bypass shapes), the three presets, and secret
  redaction. Hooked into `Permission.ask`, so it denies even when a preset says
  allow. See [SECURITY.md](SECURITY.md) §4 and §7.
- **M1.3 done (2026-08-19)**: the `/hannah/v0` façade is implemented and
  mounted — routes, SSE with resume, approval/question timeouts, timebox, 409
  guard, bearer auth, audit log, and the event translator. Canonical streams in
  [`fixtures/`](fixtures/). One acceptance item is deferred: the end-to-end run
  against a real model needs an API key.
- **M1.4 done (2026-08-21)**: `scripts/hannah-smoke.ts` drives the façade from
  the README alone. Running it against the real engine found two defects unit
  tests could not — a missing instance context that killed every task, and an
  event subscription that failed silently — both fixed.
- **Phase 1 complete**, except the end-to-end run against a real model (needs an
  API key). **Next: Phase 2** — the backend bridge in `hannah-backend`.
- **Owner decisions D1–D5: resolved 2026-08-17.** Note D3: workspace roots =
  `/`, so the sensitive-path denylist and preset gates are the effective
  boundary (SECURITY §4).
- Audit reports live in [audit/](audit/): the engine audit answers "what does
  this engine actually do", the test baseline answers "what is our regression
  net".

## Conventions for these docs

- Milestones are referenced as `M<phase>.<n>` (e.g. M1.3), scenarios as
  `S<n>` (VISION), threats as `T<n>` (SECURITY), decisions as `D<n>`
  (ROADMAP queue) and `ADR-xxxx`.
- Unverified engine claims are marked **[VERIFY]** and may not be built upon
  until M0.1 resolves them.
- Diagrams are Mermaid (rendered by GitHub).
