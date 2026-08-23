export * as PolicyRedact from "./redact"

/**
 * Secret redaction for events and the audit log (SECURITY §6, §7).
 *
 * Tool output flows into narratable events and into an append-only audit file
 * on disk. Both are places a key can end up permanently — an `env` listing, a
 * `cat` of a config file, a provider error echoing an Authorization header.
 * Redaction here is last-line defence: the sensitive-path denylist should have
 * stopped most of it, but "most" is not a security property.
 */

type Rule = { readonly name: string; readonly match: RegExp; readonly replace: (match: string) => string }

/** Keep enough of a token to be recognisable in a log without being usable. */
function mask(value: string, keep = 4) {
  if (value.length <= keep) return "[redacted]"
  return `${value.slice(0, keep)}…[redacted:${value.length}]`
}

const RULES: ReadonlyArray<Rule> = [
  {
    name: "anthropic-key",
    match: /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
    replace: (m) => mask(m, 10),
  },
  {
    name: "openai-key",
    match: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    replace: (m) => mask(m, 6),
  },
  { name: "github-token", match: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, replace: (m) => mask(m, 7) },
  { name: "slack-token", match: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, replace: (m) => mask(m, 8) },
  { name: "google-key", match: /\bAIza[A-Za-z0-9_-]{20,}/g, replace: (m) => mask(m, 6) },
  { name: "aws-access-key", match: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: (m) => mask(m, 8) },
  { name: "jwt", match: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: () => "[redacted:jwt]" },
  {
    name: "private-key-block",
    match: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => "[redacted:private-key]",
  },
  {
    name: "authorization-header",
    match: /\b(authorization|proxy-authorization)\s*[:=]\s*("|')?(bearer\s+|basic\s+)?[A-Za-z0-9._~+/=-]{12,}\2?/gi,
    replace: (m) => `${m.split(/[:=]/)[0]}: [redacted]`,
  },
  {
    // KEY=value shapes in env dumps and .env echoes.
    name: "secret-assignment",
    match:
      /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?)[A-Z0-9_]*)\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|[^\s;,]+)/gi,
    replace: (m) => `${m.split(/[:=]/)[0].trimEnd()}=[redacted]`,
  },
  {
    name: "url-userinfo",
    match: /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    replace: (m) => m.replace(/:([^/\s@]+)@/, ":[redacted]@"),
  },
]

/** Redact secrets from a string. Safe to call on any tool output. */
export function text(input: string): string {
  if (!input) return input
  let output = input
  for (const rule of RULES) output = output.replace(rule.match, (match) => rule.replace(match))
  return output
}

/**
 * Redact recursively through an event payload. Object keys are preserved so
 * the shape stays valid; only string values are rewritten.
 */
export function value<T>(input: T, depth = 0): T {
  if (depth > 8) return input
  if (typeof input === "string") return text(input) as unknown as T
  if (Array.isArray(input)) return input.map((item) => value(item, depth + 1)) as unknown as T
  if (input && typeof input === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(input)) output[key] = value(item, depth + 1)
    return output as unknown as T
  }
  return input
}

/** True when redaction would change the input — useful for audit annotations. */
export function containsSecret(input: string) {
  return text(input) !== input
}

export function rules() {
  return RULES.map((rule) => rule.name)
}
