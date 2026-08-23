# De-branding Ledger

> Status: structural pass done 2026-08-14; **functional pass (M0.2) done
> 2026-08-18**. This file is the single source of truth for what has been
> renamed, what remains, and what is deliberately kept.

## Done

| Upstream | Now | Pass |
| --- | --- | --- |
| repo contents inside `opencode-dev/` | repo root | structural |
| ~100 MB of company surfaces (console, enterprise, stats, slack, web, docs, desktop, app, storybook, identity, containers, function, VS Code ext, infra, CI, installers, nix, husky) | deleted | structural |
| `packages/opencode` | `packages/agent` | structural |
| npm scope `@opencode-ai/*` | `@hannah/*` | structural |
| package/binary `opencode` | `hannah-agent` | structural |
| env prefix `OPENCODE_*` | `HANNAH_AGENT_*` | structural |
| **Global dirs** `~/.config/opencode`, `~/.local/share/opencode`, `~/.cache/opencode`, `~/.local/state/opencode`, `$TMPDIR/opencode` | `…/hannah-agent` (one constant: `packages/core/src/global.ts`) | M0.2 |
| **Project dir** `.opencode/` | `.hannah-agent/` | M0.2 |
| **Config filenames** `opencode.json[c]` | `hannah-agent.json[c]` — including the base-name arguments `ConfigPaths.files("…")` / `fileInDirectory(…)` and the plugin-patch target | M0.2 |
| **Managed config dirs** `/etc/opencode`, `/Library/Application Support/opencode`, `%ProgramData%\opencode` | `…/hannah-agent` | M0.2 |
| **SQLite db** `opencode.db` / `opencode-<channel>.db` | `hannah-agent.db` / `hannah-agent-<channel>.db` | M0.2 |
| **Log file** `opencode.log` | `hannah-agent.log` | M0.2 |
| **Project marker file** `<git-common-dir>/opencode` | `…/hannah-agent` | M0.2 |
| **Wire header** `x-opencode-directory` (+ `-ticket`) | `x-hannah-agent-*` | M0.2 |
| **Basic-auth default username** `opencode` (v1 + v2 servers) | `hannah-agent` | M0.2 |
| **User-Agent / client identity** `opencode/<version>` (providers, webfetch, models fetch), MCP client name, OAuth `client_name` | `hannah-agent…` | M0.2 |
| **Provider attribution headers** `X-Title`/`X-Source`/`x-title` = `opencode` | `hannah-agent`; upstream's `HTTP-Referer: https://opencode.ai/` **removed** | M0.2 |
| **Worktree branch prefix** `opencode/<name>` | `hannah-agent/<name>` | M0.2 |
| **mDNS** service `opencode-<port>` / domain `opencode.local` | `hannah-agent-*` | M0.2 |
| **CLI identity** `scriptName`, serve banner, `--help` text, ACP auth-method id, error hints | `hannah-agent` | M0.2 |
| **ASCII wordmark** (OPENCODE, shown in every `--help`) | HANNAH — `packages/tui/src/logo.ts`, its duplicate in `util/presentation.ts`, and the plain-text form in `cli/ui.ts` | M0.2 |
| **TUI theme** `opencode` | `hannah` (asset `theme/assets/hannah.json`); sound pack `hannah-agent.default`; window title | M0.2 |
| **Built-in skill** `customize-opencode` | `customize-hannah-agent` (body rewritten; hosted-schema section replaced by in-repo schema pointer) | M0.2 |
| **OpenAPI spec title** | `hannah-agent`; reference regenerated at `packages/sdk/openapi.json` (188 routes, no drift) | M0.2 |
| Session-share promo tips in the TUI, docs-link command pointing at `opencode.ai/docs`, config `$schema` injection into user files | removed | M0.2 |

**Deliberate exceptions (never rename):**

- `LICENSE` — upstream MIT copyright notice must remain verbatim.
- `__OPENCODE_PHOTON_WASM_PATH` (2 source sites) — must match
  `patches/@silvia-odwyer%2Fphoton-node@0.3.4.patch` byte-for-byte.
- `patches/*` content — vendored third-party diffs.
- Third-party package names (`opencode-gitlab-auth`, `opencode-poe-auth`,
  `@gitlab/opencode-gitlab-auth`) and upstream's published artifacts
  (`sst-dev.opencode` VS Code extension id; brew/scoop/choco package names in
  `installation/` and `uninstall`) — real third-party identifiers.
- **Provider id `opencode`** — upstream's model-gateway provider in the
  catalog (`ProviderV2.ID.opencode`, `provider.id === "opencode"` checks,
  `providerOptions.opencode`, `plugin/provider/opencode.ts`, the Go upsell
  path in `session/retry.ts`, provider-icon ids). It names *their service*,
  not us; renaming would silently break anyone configuring it.
- **Vendor-registered integration keys** (commented in place):
  `X-Cerebras-3rd-Party-Integration`, OpenAI Codex `originator`,
  xAI `referrer`. These are values the vendor allowlists, not identity claims.
- ~~`https://models.opencode.ai`~~ — **no longer used.** M1.1 repointed the
  catalog at `https://models.dev`, the origin upstream mirrors byte-for-byte.
  The string survives only in comments explaining that history.

## Third pass (2026-08-21) — identifiers, API surface, and one security fix

| Upstream | Now |
| --- | --- |
| **131 Effect service tags** `"@opencode/Config"`, `"@opencode/Storage"`, … | `"@hannah/*"` |
| `HttpApi.make("opencode"/"opencode-root"/"opencode-instance")`, `OpenCodeHttpApi` | `hannah-agent` / `hannah-root` / `hannah-instance`, `HannahHttpApi` |
| **OpenAPI titles/descriptions** (`"opencode HttpApi"`, `"opencode experimental HttpApi"`, `Upgrade opencode`, `Server configuration for opencode serve`) | `hannah-agent …` — the spec now contains **zero** `opencode` strings |
| **SDK client** `createOpencodeClient`, `OpencodeClient`, `OpencodeClientConfig` (+ the generator config that emits them) | `createHannahClient`, `HannahClient`, `HannahClientConfig` |
| TUI components `OpencodeKeymap*`, `registerOpencodeSpinner`, `OpencodeModeStack` | `HannahKeymap*`, `registerHannahSpinner`, `HannahModeStack` |
| **OAuth success/failure page** shown in the browser (headings, copy, `<title>`, wordmark comment) | Hannah |
| **ACP identity** — `agentInfo.name: "OpenCode"`, `label: "OpenCode Login"` (what editors display) | Hannah |
| Marker env var `process.env.OPENCODE = "1"` | `HANNAH_AGENT = "1"` |
| OAuth sentinel `"opencode-oauth-dummy-key"` | `"hannah-agent-oauth-dummy-key"` |
| CLI help `describe: "opencode auth provider"` | `"auth provider URL"` |

**Two behavior fixes found while renaming** (neither is cosmetic):

- **CORS trusted `*.opencode.ai` by default.** `packages/server/src/cors.ts`
  reflected any origin under upstream's domain so their hosted web client could
  drive a local server. This fork has no hosted client; a page on that domain
  reaching the agent's tool surface is exactly threat T5. Removed — loopback
  plus configured origins only, with a regression test asserting the domain is
  no longer reflected.
- **`show()` compared help output against `"opencode "`.** After the binary
  rename the check matched nothing, so *every* command's `--help` printed the
  wordmark. Now only top-level help does, as upstream intended.

## Remaining (rolling / opportunistic — no functional effect)

| Category | Where | Decision |
| --- | --- | --- |
| Prose in comments, `specs/`, upstream design docs | ~1,000 sites | Never mass-edited; `specs/` is upstream historical reference (UPSTREAM.md). |
| Dormant upstream features: `github`/`pr` (installs *their* GitHub App and workflow), `account`/`console`, `.well-known/opencode` discovery, `opencode-cli` OAuth client id, brew/scoop/choco package names | ~40 sites | Renaming would make them *wrong*: they name upstream's services and published artifacts. They die with the features when ADR-0009 stage 2 prunes them. |
| Duplicate service tag `"@hannah/Image"` (v1 `packages/agent` and v2 `packages/core`) | 2 sites | Pre-existing upstream duplication, preserved exactly by the rename — not introduced here. Worth resolving if it ever bites. |
| Test-internal fixture names (`CliFixture.opencode`, temp dirs `opencode-test-*`, codemode's `tools.opencode` namespace, `opencode-v2-openapi.json` fixture) | tests only | Left consistent with themselves; renaming buys nothing. |
| `opencode.ai` doc links inside dormant upstream features (github/pr commands, account/console, share) | with the features | Dies with the feature when ADR-0009 stage 2 prunes them. |

## Verification

```bash
# 1. Nothing functional left: no config/data path, filename, or wire header.
#    (Precise by design — a looser pattern also matches the documented keeps:
#    `ProviderV2.ID.opencode` and codemode's `tools.opencode` test namespace.)
grep -rnIE '"\.opencode"|\.opencode/|"opencode\.jsonc?"|x-opencode-|"opencode\.(db|log)"|config/opencode|share/opencode' \
  packages --include='*.ts' --include='*.tsx' --include='*.json' | grep -v node_modules

# 2. Full inventory review (expect only the "remaining" categories above)
grep -rnIi '\bopencode\b' packages specs AGENTS.md CONTEXT.md \
  --exclude-dir=node_modules | grep -v PHOTON | grep -v 'gitlab-auth\|poe-auth'

# 3. Behavioral: boot under a scratch HOME, assert no opencode-named paths
rm -rf /tmp/ha-test && HOME=/tmp/ha-test \
  HANNAH_AGENT_DISABLE_MODELS_FETCH=1 bun run dev serve --port 8008 &
sleep 8 && find /tmp/ha-test -iname '*opencode*'   # must print nothing
```

**M0.2 acceptance (met 2026-08-18):** grep 1 returns only commented-out code
in `gitlab-duo.test.ts`; grep 2 is down from ~2,760 hits to ~1,370, all in the
"remaining" categories above; grep 3 returns
nothing while the created tree is entirely `hannah-agent`-named
(`~/.config/hannah-agent/hannah-agent.jsonc`,
`~/.local/share/hannah-agent/hannah-agent-local.db`, `…/log/hannah-agent.log`);
`bun turbo typecheck` 14/14; test suites at or above the pre-rename baseline
(see [audit/M0.4-test-baseline.md](audit/M0.4-test-baseline.md)).

## Lesson learned (kept for the next rename)

Token-level `sed` on distinct strings is safe for *tokens*, but it misses two
classes that only a review catches:

1. **Base names passed as arguments** — `ConfigPaths.files("opencode", …)`
   builds `opencode.json` at runtime. Missing this silently broke *all*
   project-config discovery (283 test failures) while typecheck stayed green.
2. **Member access vs. string** — a rule rewriting `.opencode` also rewrites
   `ProviderV2.ID.opencode` and `providerOptions?.opencode` into
   `X.hannah - agent`, which parses as subtraction. Typecheck caught these;
   grep for `[A-Za-z0-9_$)\]?]\.<newname>` before trusting a dot-rule.

Rule for future passes: after any mechanical rename, run **typecheck + the
full test suite + the behavioral boot check**, and grep for the *concept*
(what the string is used for) rather than only the literal.
