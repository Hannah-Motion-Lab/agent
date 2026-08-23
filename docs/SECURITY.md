# Security & Safety Model — hannah-agent

> Status: design baseline. The permission preset details are ADR-0010; the
> phone-home policy is ADR-0009. The **security review gate** (M4.6) re-audits
> everything here before autonomous features ship.

## 1. What makes this different from a terminal coding agent

A terminal agent shows every command to a user who is watching. Hannah's user is
**listening, not reading** — approvals are spoken, attention is partial, and the
agent's reach is the whole home directory, not one repo. Every default below is
chosen for that context.

## 2. Assets & trust boundaries

- **Assets**: the user's files, shell (full user privileges), credentials in
  dotfiles/env/keyrings, browser data, network access from the user's IP,
  conversation/task history stored by the engine.
- **Trust boundaries**:
  1. OS ⇄ engine tools (permission system — the main gate).
  2. Agent ⇄ backend (localhost HTTP; token).
  3. Engine ⇄ model provider (task content leaves the machine when a cloud
     model is used — by explicit configuration only).
  4. Engine ⇄ tool *inputs* (file contents, web pages — injection carriers).

## 3. Threat model

| # | Threat | Primary mitigations |
| --- | --- | --- |
| T1 | **Prompt injection** via processed content (a README, email, web page instructs the agent) | Risk-tiered approvals regardless of *why* the model wants the action; workspace roots; deny-by-default for network sends; narration surfaces intent ("quiere subir un archivo — ¿lo permito?") |
| T2 | **Destructive overreach** (agent decides `rm -rf` is helpful) | `delete`/overwrite always `ask` in companion mode; danger-pattern list is deny-by-policy (not model-visible); snapshots/trash instead of hard delete where feasible **[audit: engine `snapshot/` capability]** |
| T3 | **Exfiltration** (uploading local data) | Outbound network from tools is its own permission `kind: network`, default ask; egress inventory from M0.1 keeps engine-level calls enumerated |
| T4 | **Credential capture** (reading `~/.ssh`, `.env`, keychains) | Sensitive-path denylist (read *and* edit) baked into every preset; redaction of known secret patterns in events/logs |
| T5 | **LAN exposure** | Bind `127.0.0.1` only; mDNS advertisement disabled (ADR-0009); bearer token for the façade |
| T6 | **Supply chain** (deps, MCP servers, skills) | Frozen lockfile + `minimumReleaseAge` (inherited); **MCP allowlisted by server in code (ADR-0012), pinned versions, first server ships disabled**; skills are repo-reviewed files, not downloads |
| T7 | **Voice spoofing** (someone else in the room says "sí, dale") | Approvals only accepted after the question was asked (no pre-authorization); `high` risk approvals require HUD confirmation, not voice alone; speaker verification = future work, residual risk documented |
| T8 | **Runaway cost/loops** | `timeboxMs` mandatory, token/cost caps per task, subagent depth limit **[audit]**, stats in `task.completed` |

## 4. Permission architecture

Three layers, evaluated in order — the model can only *request*; policy decides:

1. **Hard policy (not model-visible, not overridable by approval)**: sensitive
   path denylist (`~/.ssh`, `~/.gnupg`, browser profile dirs, `*.env`,
   `id_*`, keyrings...), danger commands (`sudo`, `mkfs`, `dd` to devices,
   `curl | sh`, package-manager global installs), writes outside workspace roots.
   Result: automatic deny + `task.progress` note.

   **Implemented in M1.2** — `packages/agent/src/hannah/policy/`, hooked into
   `Permission.ask` so it runs on *every* permission request, including ones a
   preset would auto-allow and ones already covered by an `always` approval.
   A denial returns the engine's `DeniedError`: the model sees a refusal, the
   user is never asked, and no configuration can unlock it. The denylist also
   covers **the agent's own credential store** (`~/.local/share/hannah-agent`,
   `~/.config/hannah-agent`), so a task cannot read back the provider keys the
   engine is using.
2. **Preset gates** (mode chosen per task, ADR-0010):

   | Action class | `companion` (default) | `trusted-project` | `paranoid` |
   | --- | --- | --- | --- |
   | Read inside roots | allow | allow | ask |
   | Write/edit inside roots | ask (grouped per task) | allow | ask |
   | Delete / overwrite-many | ask, `risk: high` | ask | ask |
   | Shell, safe-list (`ls`, `git status`, ...) | allow | allow | ask |
   | Shell, other | ask | allow (except danger list) | ask |
   | Network (fetch/downloads) | ask | ask | ask |
3. **Workspace roots** (implemented, inert by decision): an allowlist of
   directories in the Hannah profile config; `cwd` of every task must resolve inside one. `trusted-project`
   additionally pins the task to its single project directory.
   **Decided (D3, 2026-08-17): the initial list is `["/"]`** — the entire
   filesystem. Consequence: this layer and the "writes outside workspace
   roots" hard-deny are inert for now; the sensitive-path denylist (layer 1)
   and the preset gates (layer 2) carry the whole spatial boundary. The
   mechanism is kept as a config list so the fence can be tightened later
   without redesign, and the bypass-attempt tests (§7) must exercise the
   denylist as if it were the only wall — because it is.

Approval requests carry `risk` so the backend can escalate UX: `low`/`medium` →
voice yes/no; `high` → HUD button required (T7).

**MCP is the exception to layer 1** (ADR-0012, M3.3). An MCP tool is asked about
with `patterns: ["*"]` and no arguments, so the path denylist and the command
scanner have nothing to inspect — `~/.ssh` is protected from `cat` and *not*
from a filesystem MCP server. Trust is therefore decided per **server**, in
code, before the call: a tool from a server that is not allowlisted is denied by
layer 1, unappealably. And because policy cannot read the arguments, an MCP tool
is **never `low` risk** — anything with `network`, `filesystem` or `exec` is
`high`, so it cannot be granted by voice.

Fixing that closed a real gap: `risk()` fell through to `low` for any permission
key it did not recognise, which a spoken "sí" could grant.

## 5. Approval integrity rules

- An approval binds to one `approvalId`; no blanket "yes to everything" from a
  single utterance (batch approvals are an explicit HUD action, P3+). The engine
  offers an `always` reply that would grant a whole tool class for the session;
  **the façade never sends it** — `allow` is `once`, `deny` is `reject`, and a
  test asserts nothing else is ever sent.
- **Workspace roots are ergonomics, not a boundary** (agent, M3.1). D3 set the
  root to `/`; naming `~/Downloads` a workspace grants nothing new. It picks a
  task's working directory and gives the persona a vocabulary. The one security
  property it does carry is negative: a directory inside the denylist is never
  chosen as a working directory.
- **"After the question" means the utterance *started* after it** (backend,
  M2.4). The gateway stamps `SPEECH_START`, and a phrase that began before the
  approval appeared is never read as an answer to it — otherwise the ordinary
  case of the user talking over the question silently grants it. Residual T7
  (who is speaking) is unchanged; this closes *when* they spoke.
- Timeout → deny, spoken notice, task continues where safely possible or fails.
- All approvals (+ who/how: voice, hud, timeout) land in the audit log.

## 6. Audit & privacy

- **Audit log**: append-only JSONL per task — every tool invocation (command,
  paths, exit status), every permission decision, every model/provider call
  (metadata, not content). Location & rotation defined in P1; HUD viewer in P3.
- **Privacy split vs backend**: hannah-backend's rule is "never store user
  content". The agent *must* store task transcripts to function (sessions are
  its working memory). Boundary: conversation audio/text stays in the backend
  and is never sent to the agent beyond the `prompt`/`context` fields; agent
  history is local, retention-capped (config, default 30 days), purgeable
  (`hannah-agent db` / façade endpoint later).
- **Cloud model reality**: with a cloud agent LLM, file contents touched by tasks
  reach the provider. This is stated user-facing config, and the local-model
  profile exists precisely for sensitive contexts.

## 7. Engine hardening checklist (P0/P1)

- [x] Bind localhost only — the profile pins `hostname: 127.0.0.1` with mDNS
      off, and `scripts/boot-matrix.sh` asserts via `ss` that the listening
      socket is loopback (the assertion was itself verified against a
      deliberately `0.0.0.0`-bound server, so it is not a no-op check).
- [x] Share/account/control-plane/telemetry disabled, and the server verified
      to run **with no network at all**: the boot matrix's `airgap` case starts
      the server and its health probe inside an unprivileged network namespace.
      That proves egress is not *required*; enumerating attempted connections
      (a deny-all proxy that logs) is still worth adding at the M4.6 gate.
- [x] Sensitive-path denylist implemented at policy layer with tests
      (`policy/paths.ts`; traversal, symlink, `~`, and relative-path cases
      covered — resolution walks to the nearest existing ancestor and
      `realpath`s it, so a symlink into a denied tree does not slip through).
- [x] Danger-command list implemented with tests, **including every bypass
      shape this checklist names** — `bash -c` / `sh -c` / nested shells,
      quoted and unquoted heredocs, `xargs` (its own flags skipped so the
      target's `-rf` survives), `find -exec`/`-execdir`, `$(…)`, backticks,
      `;`/`&&`/`|` chaining, absolute and relative paths to the binary, and
      `FOO=1 sudo …` env prefixes (`policy/commands.ts`).
- [x] Secret-pattern redaction implemented, tested, **and wired** (M1.3): the
      event translator and every audit write pass through it, with a test
      asserting a leaked key reaches neither the SSE stream nor the log.
      (`policy/redact.ts`:
      provider keys, JWTs, private-key blocks, `*_SECRET=`/`*_TOKEN=`
      assignments, `Authorization:` headers, URL userinfo.)
- [x] Façade bearer token implemented and required when `HANNAH_AGENT_TOKEN`
      is set (M1.3); health stays open so the backend can still detect the
      sidecar, and the token comparison is length-and-content constant-time.
- [ ] Timebox + token caps enforced engine-side, not just façade-side —
      **the timebox is façade-side today** (M1.3); engine-side token caps
      remain open for P4.

## 8. Later (P4)

- OS sandbox option for autonomous mode: bubblewrap/landlock wrapping of shell
  tool (research spike M4.1 decides).
- Proactive tasks: suggestion-only by default; autonomous execution requires
  `trusted-project` + sandbox + the M4.6 review sign-off.
- Speaker identification for voice approvals (residual T7).
