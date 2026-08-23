#!/usr/bin/env bun
/**
 * Drive the `/hannah/v0` façade end to end, the way hannah-backend will.
 *
 *   bun run scripts/hannah-smoke.ts                  # against a running server
 *   bun run scripts/hannah-smoke.ts --url http://127.0.0.1:8006
 *   bun run scripts/hannah-smoke.ts --token "$HANNAH_AGENT_TOKEN"
 *   bun run scripts/hannah-smoke.ts --prompt "list the files in ~/Downloads"
 *
 * It opens the event stream first, creates a task, narrates every event as it
 * arrives, answers approvals and questions from the terminal, and prints the
 * final state. Start the server separately:
 *
 *   hannah-agent serve --port 8006
 *
 * Exit code is 0 only if the task reaches `completed`.
 */

const args = new Map<string, string>()
for (let i = 2; i < Bun.argv.length; i += 2) {
  const flag = Bun.argv[i]?.replace(/^--/, "")
  if (flag) args.set(flag, Bun.argv[i + 1] ?? "true")
}

const BASE = (args.get("url") ?? process.env.HANNAH_AGENT_URL ?? "http://127.0.0.1:8006").replace(/\/$/, "")
const TOKEN = args.get("token") ?? process.env.HANNAH_AGENT_TOKEN
const PROMPT = args.get("prompt") ?? "List the files in the current directory and tell me how many there are."
const TIMEOUT_MS = Number(args.get("timeout") ?? 120_000)
const AUTO = args.get("auto") !== "false" // auto-approve unless told otherwise

const headers: Record<string, string> = { "content-type": "application/json" }
if (TOKEN) headers.authorization = `Bearer ${TOKEN}`

const dim = (s: string) => `\x1b[90m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${BASE}/hannah/v0${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : undefined
  return { status: response.status, body: json }
}

function fail(message: string): never {
  console.error(red(`\n✗ ${message}`))
  process.exit(1)
}

// ── 1. health ───────────────────────────────────────────────────────────────
const health = await api("GET", "/health").catch(() =>
  fail(`cannot reach ${BASE} — is \`hannah-agent serve --port 8006\` running?`),
)
if (health.status !== 200) fail(`health returned ${health.status}: ${JSON.stringify(health.body)}`)
console.log(`${green("✓")} ${bold("hannah-agent")} ${dim(`engine ${health.body.engineVersion} · ${BASE}`)}`)
if (health.body.activeTasks > 0) console.log(yellow(`  note: ${health.body.activeTasks} task already running`))

// ── 2. open the stream before creating anything ─────────────────────────────
// Order matters: the backend does the same, so that `task.accepted` is not
// missed between the POST returning and the stream connecting.
const controller = new AbortController()
const stream = await fetch(`${BASE}/hannah/v0/events`, { headers, signal: controller.signal })
if (!stream.ok || !stream.body) fail(`could not open the event stream (${stream.status})`)

let taskId: string | undefined
let finalState: string | undefined
const seen: string[] = []

const pump = (async () => {
  const reader = stream.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let split = buffer.indexOf("\n\n")
    while (split !== -1) {
      const frame = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      split = buffer.indexOf("\n\n")

      const data = frame.split("\n").find((line) => line.startsWith("data: "))
      if (!data) {
        const comment = frame.trim()
        if (comment.startsWith(":")) console.log(dim(`  ${comment.slice(1).trim()}`))
        continue
      }

      const event = JSON.parse(data.slice(6)) as {
        taskId: string
        seq: number
        type: string
        data: Record<string, unknown>
      }
      if (taskId && event.taskId !== taskId) continue
      seen.push(event.type)
      await render(event)
      if (event.type === "task.completed" || event.type === "task.failed" || event.type === "task.cancelled") {
        finalState = event.type.replace("task.", "")
        controller.abort()
        return
      }
    }
  }
})().catch((error) => {
  if (!controller.signal.aborted) console.error(red(`stream error: ${String(error)}`))
})

async function render(event: { taskId: string; seq: number; type: string; data: Record<string, unknown> }) {
  const tag = dim(`#${String(event.seq).padStart(2)}`)
  const summary = typeof event.data.summary === "string" ? event.data.summary : ""

  switch (event.type) {
    case "task.accepted":
      return console.log(`${tag} ${bold("accepted")} ${dim(String(event.data.title ?? ""))}`)
    case "task.started":
      return console.log(`${tag} started`)
    case "task.plan":
      console.log(`${tag} ${bold("plan")} ${summary}`)
      for (const step of (event.data.steps as string[]) ?? []) console.log(dim(`      · ${step}`))
      return
    case "task.tool":
      return console.log(
        `${tag} ${dim("tool")} ${event.data.tool} ${dim(String(event.data.status))} ${dim(String(event.data.target ?? ""))}`,
      )
    case "task.progress":
      return console.log(`${tag} ${summary}`)
    case "task.approval.requested":
      return approve(event)
    case "task.approval.resolved":
      return console.log(`${tag} approval ${bold(String(event.data.decision))} ${dim(`by ${event.data.by}`)}`)
    case "task.question":
      return answer(event)
    case "task.completed":
      return console.log(`${tag} ${green("completed")} ${summary} ${dim(JSON.stringify(event.data.stats))}`)
    case "task.failed": {
      console.log(`${tag} ${red("failed")} ${summary} ${dim(String(event.data.error ?? ""))}`)
      // The engine reports missing provider credentials as "Model not found",
      // sometimes suggesting the very model you asked for. Save the next person
      // the twenty minutes.
      if (/model not found/i.test(summary)) {
        console.log(
          yellow(
            "\n  hint: this usually means the provider has no credentials, not that the model is wrong.\n" +
              "        export ANTHROPIC_API_KEY=... (or run `hannah-agent auth login`) and try again;\n" +
              "        for a local brain: scripts/install-profile.sh --local",
          ),
        )
      }
      return
    }
    case "task.cancelled":
      return console.log(`${tag} ${yellow("cancelled")} ${dim(String(event.data.reason ?? ""))}`)
    default:
      return console.log(`${tag} ${event.type} ${dim(JSON.stringify(event.data))}`)
  }
}

async function prompt(question: string) {
  process.stdout.write(question)
  for await (const line of console) return line.trim()
  return ""
}

async function approve(event: { data: Record<string, unknown> }) {
  const risk = String(event.data.risk)
  const label = `${bold("approval")} ${event.data.summary} ${dim(`(${event.data.kind}, risk ${risk})`)}`
  // `high` risk cannot be granted by voice — the smoke script stands in for the
  // HUD, so it answers `by: "hud"`.
  if (AUTO) {
    console.log(`     ${label} → ${green("allow")} ${dim("(auto)")}`)
  } else {
    const reply = await prompt(`     ${label}\n     allow? [y/N] `)
    if (!/^y/i.test(reply)) {
      await api("POST", `/tasks/${taskId}/approvals/${event.data.approvalId}`, { decision: "deny", by: "hud" })
      return
    }
  }
  const result = await api("POST", `/tasks/${taskId}/approvals/${event.data.approvalId}`, {
    decision: "allow",
    by: "hud",
  })
  if (result.status !== 200) console.log(red(`     approval failed: ${JSON.stringify(result.body)}`))
}

async function answer(event: { data: Record<string, unknown> }) {
  const options = (event.data.options as string[]) ?? []
  const reply = AUTO
    ? (options[0] ?? "yes")
    : await prompt(`     ${bold("question")} ${event.data.text} ${dim(options.join(" / "))}\n     > `)
  console.log(`     ${bold("question")} ${event.data.text} → ${green(reply)}`)
  await api("POST", `/tasks/${taskId}/answer`, { questionId: event.data.questionId, answer: reply })
}

// ── 3. create the task ──────────────────────────────────────────────────────
const created = await api("POST", "/tasks", {
  prompt: PROMPT,
  title: "smoke test",
  timeboxMs: TIMEOUT_MS,
  context: { language: "en" },
})

if (created.status === 409) {
  controller.abort()
  fail(`a task is already running (${created.body.activeTaskId}) — cancel it first`)
}
if (created.status !== 202) {
  controller.abort()
  fail(`create returned ${created.status}: ${JSON.stringify(created.body)}`)
}
taskId = created.body.taskId as string
console.log(dim(`  task ${taskId}\n`))

// ── 4. wait for a terminal state ────────────────────────────────────────────
const timeout = setTimeout(() => {
  console.log(yellow(`\n  no terminal event within ${TIMEOUT_MS}ms — cancelling`))
  void api("POST", `/tasks/${taskId}/cancel`, { reason: "shutdown" })
}, TIMEOUT_MS + 5000)

await pump
clearTimeout(timeout)

const status = await api("GET", `/tasks/${taskId}`)
console.log(
  `\n${finalState === "completed" ? green("✓") : red("✗")} ${bold(String(status.body?.state ?? finalState))} ` +
    dim(`${seen.length} events: ${[...new Set(seen)].join(", ")}`),
)
process.exit(finalState === "completed" ? 0 : 1)
