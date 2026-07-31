/**
 * Source-IP allowlisting for public webhook routes — TradingView origin hardening.
 *
 * TradingView publishes four fixed egress IPs for webhook alerts. Once the
 * MarkitTick route is reachable without Cloud Run IAM (i.e. `allUsers` invoker),
 * a body secret is the ONLY thing in front of it; pinning the source IP adds a
 * second, independent barrier.
 *
 * ⚠️ THE SPOOFING PROBLEM. `X-Forwarded-For` is partly CLIENT-controlled. Cloud
 * Run does not replace a client-supplied header — it APPENDS the observed peer
 * address. So an attacker sending `X-Forwarded-For: 52.89.214.238` produces:
 *
 *     X-Forwarded-For: 52.89.214.238, <their real ip>
 *                      ^ spoofed        ^ appended by infrastructure
 *
 * Reading the LEFTMOST entry — the naive choice, and what Express's
 * `trust proxy: true` gives you — is therefore trivially bypassable, which is
 * WORSE than no filter because it reads as protection. We take the RIGHTMOST
 * entry: everything a client supplies is pushed leftward, so only infrastructure
 * can control the tail of the list.
 *
 * `hopsFromRight` exists for the day a load balancer is put in front of Cloud
 * Run, which appends its own address and shifts the real client one place left.
 * With direct Cloud Run ingress the correct value is 0.
 *
 * FAIL-OPEN BY DESIGN: an empty allowlist disables the check. The route is
 * IAM-protected today and exercised by preflight tooling from arbitrary
 * addresses; enabling the filter is a deliberate deploy-time act, matching the
 * existing `AFI_MARKITTICK_ORIGIN_MODE` convention. It must be turned on BEFORE
 * `allUsers` is granted, never after.
 *
 * @module sourceIpAllowlist
 */

/** TradingView's published webhook egress addresses (AWS us-west-2). */
export const TRADINGVIEW_WEBHOOK_IPS = [
  "52.89.214.238",
  "34.212.75.30",
  "54.218.53.128",
  "52.32.178.7",
] as const;

/** Outcome of an allowlist evaluation — `reason` is for logs, never the response. */
export interface SourceIpDecision {
  allowed: boolean;
  /** The address the policy actually judged, or null when none could be read. */
  clientIp: string | null;
  /** The full parsed chain, for diagnosing a misconfigured hop count. */
  chain: string[];
  reason: "disabled" | "allowed" | "not-in-allowlist" | "no-source-ip";
}

/**
 * Split an `X-Forwarded-For` value into its ordered hops.
 *
 * Node lowercases header names and joins repeated headers with ", ", so a single
 * comma split covers both the repeated-header and single-header forms. IPv6
 * addresses may arrive bracketed and/or port-suffixed; both are stripped.
 */
export function parseForwardedFor(header: string | string[] | undefined): string[] {
  if (!header) return [];
  const raw = Array.isArray(header) ? header.join(",") : header;
  return raw
    .split(",")
    .map((entry) => normalizeIp(entry))
    .filter((entry) => entry.length > 0);
}

/** Strip whitespace, IPv6 brackets, an IPv4 port suffix, and IPv4-mapped IPv6. */
function normalizeIp(entry: string): string {
  let ip = entry.trim();
  if (ip.startsWith("[")) {
    const close = ip.indexOf("]");
    if (close > 0) ip = ip.slice(1, close);
  } else if ((ip.match(/:/g) || []).length === 1) {
    // Exactly one colon means host:port, not IPv6.
    ip = ip.slice(0, ip.indexOf(":"));
  }
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

/**
 * Resolve the trustworthy client address from a forwarded chain.
 *
 * Counts from the RIGHT — see the spoofing note above. Returns null when the
 * chain is too short for the configured hop count, which the caller must treat
 * as "cannot establish origin", never as "allow".
 */
export function resolveClientIp(chain: string[], hopsFromRight = 0): string | null {
  if (chain.length === 0) return null;
  const index = chain.length - 1 - hopsFromRight;
  if (index < 0 || index >= chain.length) return null;
  return chain[index];
}

/**
 * Evaluate a request's source address against an allowlist.
 *
 * @param header        raw `x-forwarded-for` header value
 * @param allowlist     permitted addresses; EMPTY DISABLES THE CHECK
 * @param hopsFromRight proxy hops between the client and this service
 * @param socketIp      direct peer address, used only when no header is present
 */
export function evaluateSourceIp(
  header: string | string[] | undefined,
  allowlist: readonly string[],
  hopsFromRight = 0,
  socketIp?: string
): SourceIpDecision {
  const chain = parseForwardedFor(header);

  if (allowlist.length === 0) {
    return { allowed: true, clientIp: resolveClientIp(chain, hopsFromRight), chain, reason: "disabled" };
  }

  const clientIp = resolveClientIp(chain, hopsFromRight) ?? (socketIp ? normalizeIp(socketIp) : null);
  if (!clientIp) {
    return { allowed: false, clientIp: null, chain, reason: "no-source-ip" };
  }

  return allowlist.includes(clientIp)
    ? { allowed: true, clientIp, chain, reason: "allowed" }
    : { allowed: false, clientIp, chain, reason: "not-in-allowlist" };
}

/**
 * Read the allowlist from the environment.
 *
 * `AFI_MARKITTICK_ALLOWED_IPS` accepts a comma-separated list, or the token
 * `tradingview` to expand to {@link TRADINGVIEW_WEBHOOK_IPS}. Unset or empty
 * leaves the check disabled.
 */
export function allowlistFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.toLowerCase() === "tradingview") return [...TRADINGVIEW_WEBHOOK_IPS];
  return trimmed
    .split(",")
    .map((entry) => normalizeIp(entry))
    .filter((entry) => entry.length > 0);
}
