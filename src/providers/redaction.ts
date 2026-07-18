/**
 * Secret redaction boundary (PBF-GOV §8.2 / D-PBF-7).
 *
 * A reusable, structural scrubber applied at the logger/error boundary. It
 * covers: secret-named fields, URL/query-string secrets, authorization/bearer
 * material, nested error causes, structured metadata, request-config objects,
 * and — during a provider invocation — the exact resolved credential value(s)
 * (registered per-invocation so a secret can never escape even through an
 * unexpected field). It does NOT suppress useful non-secret diagnostics.
 *
 * The scrubber is defense in depth: the resolver hands the adapter a header
 * VALUE (never a URL), so the primary leak surface is already closed by
 * construction; this guarantees it structurally at every log/error sink too.
 */
import type { NodeLogger } from "../pipeline/nodeSdk.js";

const REDACTED = "***REDACTED***";

/** Secret-named fields (normalized: lowercase, strip '-'/'_'). Exact matches only. */
const SECRET_FIELD_NAMES = new Set([
  "apikey",
  "token",
  "accesstoken",
  "accesskey",
  "xaccesskey",
  "secret",
  "secretvalue",
  "password",
  "authorization",
  "privatekey",
  "refreshtoken",
  "oauthrefreshtoken",
  "oauth",
  "cookie",
  "sessiontoken",
  "bearer",
  "headervalue",
  "credential",
  "credentials",
]);

/** Query-string / key=value secret patterns (e.g. apikey=..., token=..., access_token=...). */
const URL_SECRET_PARAM = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|key)=([^&\s"'#]+)/gi;

function normalizeKey(k: string): string {
  return k.toLowerCase().replace(/[-_]/g, "");
}

function redactString(value: string, secrets: readonly string[]): string {
  let out = value.replace(URL_SECRET_PARAM, (_m, k) => `${k}=${REDACTED}`);
  for (const sec of secrets) {
    if (sec && sec.length >= 4 && out.includes(sec)) out = out.split(sec).join(REDACTED);
  }
  return out;
}

/**
 * Recursively redact secrets from an arbitrary value. `secrets` are exact
 * credential values registered for the current invocation.
 */
export function redactSecrets(
  value: unknown,
  secrets: readonly string[] = [],
  seen: WeakSet<object> = new WeakSet()
): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (value === null || typeof value !== "object") return value;

  if (value instanceof Error) {
    const shaped: Record<string, unknown> = {
      name: value.name,
      message: redactString(value.message, secrets),
    };
    const cause = (value as { cause?: unknown }).cause;
    if (cause !== undefined) shaped.cause = redactSecrets(cause, secrets, seen);
    const code = (value as { code?: unknown }).code;
    if (code !== undefined) shaped.code = code;
    return shaped;
  }

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, secrets, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_FIELD_NAMES.has(normalizeKey(k)) ? REDACTED : redactSecrets(v, secrets, seen);
  }
  return out;
}

/**
 * Wrap a NodeLogger so every message + fields object is scrubbed before it
 * reaches the underlying sink. `secrets` are exact values to redact for the
 * lifetime of this wrapper (e.g. the active credential during one invocation).
 */
export function scrubbingLogger(base: NodeLogger, secrets: readonly string[] = []): NodeLogger {
  const wrapFields = (fields?: Record<string, unknown>): Record<string, unknown> | undefined =>
    fields === undefined ? undefined : (redactSecrets(fields, secrets) as Record<string, unknown>);
  const msg = (m: string) => redactString(m, secrets);
  return {
    debug: (m, f) => base.debug(msg(m), wrapFields(f)),
    info: (m, f) => base.info(msg(m), wrapFields(f)),
    warn: (m, f) => base.warn(msg(m), wrapFields(f)),
    error: (m, f) => base.error(msg(m), wrapFields(f)),
  };
}
