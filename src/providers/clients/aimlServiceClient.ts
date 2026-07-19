/**
 * Trusted client for the self-hosted Tiny Brains aiMl inference endpoint
 * (POST /predict/froggy). Service address comes from the deployment's
 * TINY_BRAINS_URL (never an analyst-supplied URL), with an X-AFI-Client
 * header and a bounded timeout. The request carries the EXPLICIT
 * orchestration profile (the governed ProviderInstance's `model` field,
 * verbatim) and the real close-price candle series the technical lane
 * produced.
 *
 * FAIL-CLOSED (EV3-GOV D-EV3-3 / D-EV3-4(5)): configuration absence, non-2xx
 * responses, transport errors, malformed response shapes, profile-echo
 * mismatches (profileId AND profileVersion), a missing or malformed
 * `invocation` block, and an outputHash that does not recompute are ALL
 * rejected — never a silent acceptance or downgrade. Verification chain:
 *
 *   1. the `invocation` block is REQUIRED on success and STRICT-PARSED
 *      (closed shape, hex-64 digests, experts sorted ascending by expertId,
 *      no unknown members — volatile timing facts have nowhere to live);
 *   2. profile echo: payload.profileId must equal the requested profile, and
 *      the block must be INTERNALLY consistent with the payload
 *      (profileId + profileVersion agree across payload and block);
 *   3. invocation.outputHash MUST equal the KAT-proven tiny-brains.hash.v1
 *      recomputation over the received prediction payload EXACTLY as parsed
 *      (the response minus the invocation block; absence-not-null).
 */

import {
  TINY_BRAINS_INVOCATION_RECORD,
  type TinyBrainsInvocationBlock,
  type TinyBrainsInvocationExpert,
} from "../invocationProof.js";
import {
  PREDICT_FROGGY_FLOAT_KEYS,
  tinyBrainsHashPayload,
} from "./tinyBrainsHashV1.js";

export interface AimlCandle {
  timestamp: number;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface AimlServiceInput {
  signalId: string;
  symbol: string;
  timeframe: string;
  traceId?: string;
  /** Explicit Tiny Brains orchestration profile (instance `model`, verbatim). */
  profile: string;
  /** Real close-price series from the technical lane (bounded upstream). */
  candles: AimlCandle[];
}

export interface AimlServicePrediction {
  convictionScore: number;
  direction: "long" | "short" | "neutral";
  regime?: string;
  riskFlag?: boolean;
  profileId: string;
  profileVersion: string;
  /** The verified D-EV3-3 invocation block (required on every success). */
  invocation: TinyBrainsInvocationBlock;
}

export interface AimlServiceClientOptions {
  timeoutMs?: number;
  abort?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Base URL override (tests only); production reads TINY_BRAINS_URL. */
  baseUrl?: string;
}

function effectiveSignal(abort?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  const timeout = typeof timeoutMs === "number" ? AbortSignal.timeout(timeoutMs) : undefined;
  if (abort && timeout) return AbortSignal.any([abort, timeout]);
  return timeout ?? abort;
}

const HEX64 = /^[a-f0-9]{64}$/;

function fail(detail: string): never {
  throw new Error(`aiMl service returned a malformed invocation block: ${detail}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseExpert(value: unknown, index: number): TinyBrainsInvocationExpert {
  if (!isPlainObject(value)) fail(`experts[${index}] is not an object`);
  const allowed = new Set([
    "expertId",
    "expertVersion",
    "posture",
    "status",
    "outputHash",
    "artifactFingerprints",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`experts[${index}] carries unknown member '${key}'`);
  }
  const { expertId, expertVersion, posture, status, outputHash, artifactFingerprints } = value;
  if (typeof expertId !== "string" || expertId.length === 0) {
    fail(`experts[${index}].expertId missing`);
  }
  if (typeof expertVersion !== "string" || expertVersion.length === 0) {
    fail(`experts[${index}].expertVersion missing`);
  }
  if (posture !== "deterministic" && posture !== "probabilistic") {
    fail(`experts[${index}].posture is not a governed posture`);
  }
  if (status !== "succeeded") fail(`experts[${index}].status is not 'succeeded'`);
  if (typeof outputHash !== "string" || !HEX64.test(outputHash)) {
    fail(`experts[${index}].outputHash is not a hex-64 digest`);
  }
  const expert: TinyBrainsInvocationExpert = {
    expertId,
    expertVersion,
    posture,
    status,
    outputHash,
  };
  if (artifactFingerprints !== undefined) {
    if (!isPlainObject(artifactFingerprints)) {
      fail(`experts[${index}].artifactFingerprints is not an object`);
    }
    const fingerprints: Record<string, string> = {};
    for (const [name, digest] of Object.entries(artifactFingerprints)) {
      if (name.length === 0) fail(`experts[${index}].artifactFingerprints has an empty name`);
      if (typeof digest !== "string" || !HEX64.test(digest)) {
        fail(`experts[${index}].artifactFingerprints['${name}'] is not a hex-64 digest`);
      }
      fingerprints[name] = digest;
    }
    expert.artifactFingerprints = fingerprints;
  }
  return expert;
}

/**
 * Strict-parse the closed invocation block: exact member set (unknown members
 * rejected — timing facts have nowhere to live), hex-64 digests, governed
 * consts, experts sorted ascending by case-sensitive expertId, no duplicates.
 */
export function parseTinyBrainsInvocationBlock(value: unknown): TinyBrainsInvocationBlock {
  if (!isPlainObject(value)) fail("block is not an object");
  const allowed = new Set([
    "record",
    "profileId",
    "profileVersion",
    "resolverId",
    "resolverVersion",
    "codeConfigFingerprint",
    "hashLaw",
    "inputHash",
    "outputHash",
    "status",
    "experts",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`unknown member '${key}'`);
  }
  for (const key of allowed) {
    if (!(key in value)) fail(`required member '${key}' missing`);
  }
  if (value.record !== TINY_BRAINS_INVOCATION_RECORD) fail("record const mismatch");
  if (value.hashLaw !== "tiny-brains.hash.v1") fail("hashLaw const mismatch");
  if (value.status !== "succeeded") fail("status is not 'succeeded'");
  for (const key of ["profileId", "profileVersion", "resolverId", "resolverVersion"] as const) {
    const s = value[key];
    if (typeof s !== "string" || s.length === 0) fail(`${key} missing`);
  }
  for (const key of ["codeConfigFingerprint", "inputHash", "outputHash"] as const) {
    const s = value[key];
    if (typeof s !== "string" || !HEX64.test(s)) fail(`${key} is not a hex-64 digest`);
  }
  if (!Array.isArray(value.experts) || value.experts.length === 0) {
    fail("experts must be a non-empty array");
  }
  const experts = value.experts.map((e, i) => parseExpert(e, i));
  for (let i = 1; i < experts.length; i++) {
    if (experts[i - 1].expertId >= experts[i].expertId) {
      fail("experts are not sorted ascending by unique expertId");
    }
  }
  return {
    record: TINY_BRAINS_INVOCATION_RECORD,
    profileId: value.profileId as string,
    profileVersion: value.profileVersion as string,
    resolverId: value.resolverId as string,
    resolverVersion: value.resolverVersion as string,
    codeConfigFingerprint: value.codeConfigFingerprint as string,
    hashLaw: "tiny-brains.hash.v1",
    inputHash: value.inputHash as string,
    outputHash: value.outputHash as string,
    status: "succeeded",
    experts,
  };
}

export async function callAimlService(
  input: AimlServiceInput,
  options: AimlServiceClientOptions = {}
): Promise<AimlServicePrediction> {
  const baseUrl = (options.baseUrl ?? process.env.TINY_BRAINS_URL?.trim()) || null;
  if (!baseUrl) {
    throw new Error("aiMl service unavailable: TINY_BRAINS_URL is not configured");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${baseUrl}/predict/froggy`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AFI-Client": "afi-reactor-aiml-v1",
    },
    body: JSON.stringify(input),
    signal: effectiveSignal(options.abort, options.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`aiMl service error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as Record<string, unknown>;
  if (
    typeof data?.convictionScore !== "number" ||
    !Number.isFinite(data.convictionScore) ||
    data.convictionScore < 0 ||
    data.convictionScore > 1 ||
    !["long", "short", "neutral"].includes(data.direction as string)
  ) {
    throw new Error("aiMl service returned a malformed prediction");
  }
  // Profile-echo law (fail CLOSED, not skippable): the service MUST name the
  // orchestration profile it ran, and it MUST be the one this invocation
  // selected — profileId AND profileVersion (D-EV3-3 hardening). A missing
  // profileId (a stale/mis-routed service that never ran the governed
  // profile) or a mismatch is rejected — never a silent acceptance.
  if (typeof data.profileId !== "string" || data.profileId !== input.profile) {
    throw new Error("aiMl service did not confirm the selected orchestration profile");
  }
  if (typeof data.profileVersion !== "string" || data.profileVersion.length === 0) {
    throw new Error("aiMl service did not confirm the orchestration profile version");
  }

  // The D-EV3-3 invocation block is REQUIRED on every successful prediction.
  if (data.invocation === undefined || data.invocation === null) {
    throw new Error(
      "aiMl service response carried no invocation block (required on success; EV3-GOV D-EV3-3)"
    );
  }
  const invocation = parseTinyBrainsInvocationBlock(data.invocation);

  // The block must be INTERNALLY consistent with the payload's profile echo.
  if (invocation.profileId !== data.profileId) {
    throw new Error("aiMl invocation block profileId disagrees with the response payload");
  }
  if (invocation.profileVersion !== data.profileVersion) {
    throw new Error("aiMl invocation block profileVersion disagrees with the response payload");
  }

  // outputHash verification (fail CLOSED, D-EV3-4(5)): the service's final
  // outputHash commits to the prediction payload EXCLUSIVE of the invocation
  // block. Recompute it under the KAT-proven tiny-brains.hash.v1
  // implementation over the payload EXACTLY as parsed (absence-not-null).
  const { invocation: _invocation, ...payload } = data;
  const recomputed = tinyBrainsHashPayload(payload, { floatKeys: PREDICT_FROGGY_FLOAT_KEYS });
  if (recomputed !== invocation.outputHash) {
    throw new Error(
      "aiMl invocation outputHash does not recompute over the received prediction payload (tiny-brains.hash.v1)"
    );
  }

  return {
    convictionScore: data.convictionScore,
    direction: data.direction as AimlServicePrediction["direction"],
    ...(typeof data.regime === "string" ? { regime: data.regime } : {}),
    ...(typeof data.riskFlag === "boolean" ? { riskFlag: data.riskFlag } : {}),
    profileId: data.profileId,
    profileVersion: data.profileVersion,
    invocation,
  };
}
