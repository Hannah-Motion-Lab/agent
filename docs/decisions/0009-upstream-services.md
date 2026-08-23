# ADR-0009 — Disable upstream cloud services

- Status: **Accepted** (M0.5, 2026-08-18, with the M0.1 egress inventory in
  hand; stage 1 executes in M0.2/M1.1)

## Context

The engine ships integrated with opencode-the-company's services: session
**share** (uploads session content to their servers), **account/control-plane**
(their cloud accounts), upgrade checks, mDNS LAN advertisement, and possibly
telemetry/observability sinks. A personal, local-first agent must not talk to
any of them (VISION pillar 3; SECURITY T3/T5).

## Decision

Per service, in two stages — **stage 1 (config-off + verified silent)** in
M0.2/M1.1, **stage 2 (code removal)** opportunistically once stage 1 is proven:

| Service | Fate |
| --- | --- |
| Share (`share/`) | Disable, then remove — it exports user content by design. |
| Account / control-plane / auth-broker for opencode cloud | Disable, then remove. Provider auth flows (Anthropic OAuth etc.) are separate and stay. |
| Upgrade check / installer paths (`installation/`, `upgrade` cmd) | Disable — the fork updates via git. |
| mDNS advertisement (`server/mdns.ts`) | Off by default (flag may remain for debugging). |
| Telemetry/observability export | Off; local logging only. **[M0.1 determines what exists.]** |
| Model catalog fetch | **Resolved in M1.1 (2026-08-19): default changed to `https://models.dev`.** Both endpoints were fetched and byte-compared — upstream's is an exact mirror — so this costs nothing and removes the dependency. Original note follows. **Keep, with a correction from the audit**: the endpoint is `https://models.opencode.ai` — *upstream's proxy* of models.dev, not models.dev itself, so "anonymous third party" was wrong; it is a request to the company we forked from, on every start. Keep for now (it is the only practical catalog source and the response is cached), but the Hannah profile (M1.1) must decide explicitly between: pin a vendored catalog via `HANNAH_AGENT_MODELS_PATH`, point `HANNAH_AGENT_MODELS_URL` at models.dev directly, or disable with `HANNAH_AGENT_DISABLE_MODELS_FETCH`. Document whichever we choose as the one non-provider egress. |
| Websearch tools (`mcp.exa.ai`, `search.parallel.ai`) | **Newly identified by the audit** — the `websearch`/`webfetch` tools send query text to third parties. Not a phone-home, but egress the presets must gate: `ask` or `deny` in every preset (ADR-0010), and the Hannah profile may drop the tools entirely. |
| GitHub/GitLab integrations (`github`, `pr` cmds) | Keep dormant — not wired into Hannah, may serve P3 git macros. |

Acceptance: with the Hannah profile, a deny-all egress test shows exactly two
destination classes — the configured model provider and the catalog endpoint
chosen above.

Audit status (M0.1): the inventory is complete and traced to call sites
(audit §8). Default `serve` already reaches only the catalog and the
configured provider — **share, account/console, upgrade checks, telemetry and
mDNS are all off or unreachable in headless mode without explicit opt-in**
(upgrade checks in particular run only in the TUI worker). Stage 1 is
therefore mostly "keep it that way and prove it"; the profile work in M1.1
adds the explicit switches and the egress test harness.

## Consequences

- Some engine features (session sharing links, cloud account UX in TUI) become
  dead UI in our build; pruning them is cleanup, not urgency.
- The egress test becomes a permanent CI-able guard (re-run at M4.6 gate).
