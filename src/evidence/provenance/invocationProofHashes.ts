/**
 * Provider-invocation hash projections (EV3-GOV D-EV3-4).
 *
 * EVERY hash this module computes runs under the EXISTING composition
 * canonicalization law (`canonical-json-hashing.v1`, src/pipeline/hashing.ts):
 * sha256 over the canonically serialized JSON value, with the domainTag
 * CARRIED in the CanonicalHash object and NEVER part of the hash material
 * (D-EV3-4(2)). Floats are admissible in shortest round-trip form — these are
 * composition-law commitments, NOT evidence-law (canonicalHashV1) digests.
 *
 * Registered domain tags (D-EV3-4(1) — six new plus the re-homed
 * afi.d2.lane-output reservation, formerly a dormant entry in the
 * evidence-law tag table):
 *
 *   afi.d2.provider-record            — the FULL governed provider record
 *   afi.d2.provider-instance-record   — the FULL governed instance record
 *   afi.d2.provider-invocation-input  — the closed invocation-input projection
 *   afi.d2.provider-result            — the validated category result MINUS `category`
 *   afi.d2.lane-output                — the FULL category result consumed by the join
 *   afi.d2.evidence-record            — the v3 record minus {recordHash, replayHash}
 *   afi.d2.evidence-replay            — the v3 replay projection (see below)
 *
 * The invocation-input projection is a CLOSED construction (D-EV3-6
 * structural exclusion): its builder accepts ONLY the enumerated non-secret
 * facts — category, adapter identity, governed model, the non-secret params
 * object the adapter received, the canonical USS signal, and (for the lanes
 * whose adapters consume graph input: pattern, aiMl) the delivered graph
 * input. No credential, header, logger, abort handle, or volatile field can
 * enter it because the builder signature admits none; functions are dropped
 * structurally by the JSON round-trip; the canonical volatile
 * runtime/storage timestamp keys (VOLATILE_TIMESTAMP_KEYS — e.g. the
 * request-scoped `ingestedAt` on the USS provenance) are dropped recursively
 * from the signal/graph/params material (D-EV3-4(7): no wall-clock moment in
 * any hashed preimage; identical canonical inputs → identical projections).
 * traceId is EXCLUDED (request-scoped, not deterministic replay input).
 * Candle/series content IS included (content binding, hash-only — the series
 * never persists).
 *
 * BOUNDARY: digest computation only. No I/O, no registry read, no clock.
 */

import {
  canonicalHashOf,
  type CanonicalHashRef,
} from "../../pipeline/hashing.js";
import { VOLATILE_TIMESTAMP_KEYS } from "./canonicalHashV1.js";
import type { AnalysisCategory } from "../../providers/types.js";

/** D-EV3-4(1) — the provider-provenance domain tags (composition law). */
export const PROVIDER_PROOF_DOMAIN_TAGS = {
  providerRecord: "afi.d2.provider-record",
  providerInstanceRecord: "afi.d2.provider-instance-record",
  invocationInput: "afi.d2.provider-invocation-input",
  providerResult: "afi.d2.provider-result",
  /** Re-homed reservation (D-EV3-4(1)): the FULL category result at the join. */
  laneOutput: "afi.d2.lane-output",
  evidenceRecord: "afi.d2.evidence-record",
  evidenceReplay: "afi.d2.evidence-replay",
} as const;

/**
 * The replayHash preimage exclusions (D-EV3-4(6)): lifecycle progression and
 * supersession custody NEVER move the replay commitment.
 */
export const EVIDENCE_REPLAY_EXCLUDED_FIELDS = [
  "recordHash",
  "replayHash",
  "lifecycleState",
  "finalized",
  "recordVersion",
  "supersedesRecordHash",
] as const;

/** The recordHash preimage exclusions (D-EV3-4(6)). */
export const EVIDENCE_RECORD_EXCLUDED_FIELDS = ["recordHash", "replayHash"] as const;

/**
 * JSON round-trip: the hash covers exactly the JSON semantics of the value
 * (undefined members dropped, Dates as ISO strings, functions structurally
 * excluded) — the same discipline as the enrichment-bundle projection.
 */
function jsonSemantics<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

const VOLATILE_KEY_SET: ReadonlySet<string> = new Set(VOLATILE_TIMESTAMP_KEYS);

/**
 * JSON round-trip that ALSO structurally drops the canonical volatile
 * runtime/storage timestamp keys (the D2 hash doctrine's
 * VOLATILE_TIMESTAMP_KEYS — e.g. the request-scoped `ingestedAt` on the
 * canonical USS provenance). D-EV3-4(3)/(7): the invocation-input projection
 * admits NO volatile field — two evaluations of the same canonical inputs
 * MUST produce identical projections, and no wall-clock moment may enter any
 * hashed preimage of the decision. Domain-declared evidence timestamps
 * (asOf, publishedAt, …) are ordinary content and pass through.
 */
function volatileFreeJsonSemantics<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v) => (VOLATILE_KEY_SET.has(key) ? undefined : v))
  );
}

/**
 * providerRecordFingerprint — content commitment to the FULL governed
 * afi.provider.v1 record as loaded (tag afi.d2.provider-record).
 */
export function providerRecordFingerprint(record: object): CanonicalHashRef {
  return canonicalHashOf(jsonSemantics(record), PROVIDER_PROOF_DOMAIN_TAGS.providerRecord);
}

/**
 * providerInstanceRecordFingerprint — content commitment to the FULL governed
 * afi.provider-instance.v1 record as loaded (the non-secret configuration
 * commitment; tag afi.d2.provider-instance-record).
 */
export function providerInstanceRecordFingerprint(record: object): CanonicalHashRef {
  return canonicalHashOf(
    jsonSemantics(record),
    PROVIDER_PROOF_DOMAIN_TAGS.providerInstanceRecord
  );
}

/**
 * The closed, non-secret invocation-input projection (D-EV3-4(3)). The shape
 * is fixed; the builder below is the ONLY constructor.
 */
export interface InvocationInputProjection {
  category: AnalysisCategory;
  adapter: { adapterId: string; adapterVersion: string };
  /** The governed instance model/profile identity, when the instance names one. */
  model?: string;
  /** The non-secret merged params object the adapter received (instance invocation + node config). */
  params: Record<string, unknown>;
  /** The adapter-facing input facts: the canonical USS signal + (pattern/aiMl only) the delivered graph input. */
  input: { signal: unknown; graph?: unknown };
}

/**
 * The lanes whose adapters consume the executor-delivered graph input
 * (pattern reads the technical candles port; aiMl reads the joined sibling
 * namespaces). The technical / sentiment / news adapters are signal-driven —
 * their delivered input is not adapter-facing and is EXCLUDED.
 */
const GRAPH_INPUT_LANES: ReadonlySet<AnalysisCategory> = new Set(["pattern", "aiMl"]);

export interface InvocationInputFacts {
  category: AnalysisCategory;
  adapterId: string;
  adapterVersion: string;
  model?: string;
  /** The exact non-secret config object handed to adapter.run. */
  params: Record<string, unknown>;
  /** The exact canonical USS signal handed to adapter.run. */
  signal: unknown;
  /** The exact executor-delivered input handed to adapter.run (may be undefined). */
  graphInput?: unknown;
}

/**
 * Build the closed invocation-input projection from the SAME values handed to
 * adapter.run. Closed construction: only the enumerated facts can enter; the
 * signature admits no credential, header, or volatile member (D-EV3-6).
 */
export function buildInvocationInputProjection(
  facts: InvocationInputFacts
): InvocationInputProjection {
  const input: { signal: unknown; graph?: unknown } = {
    signal: volatileFreeJsonSemantics(facts.signal),
  };
  if (GRAPH_INPUT_LANES.has(facts.category) && facts.graphInput !== undefined) {
    input.graph = volatileFreeJsonSemantics(facts.graphInput);
  }
  const projection: InvocationInputProjection = {
    category: facts.category,
    adapter: { adapterId: facts.adapterId, adapterVersion: facts.adapterVersion },
    params: volatileFreeJsonSemantics(facts.params ?? {}) as Record<string, unknown>,
    input,
  };
  if (facts.model !== undefined) projection.model = facts.model;
  return projection;
}

/**
 * invocationInputHash — commitment to the normalized, non-secret invocation
 * input projection (tag afi.d2.provider-invocation-input).
 */
export function invocationInputHash(projection: InvocationInputProjection): CanonicalHashRef {
  return canonicalHashOf(jsonSemantics(projection), PROVIDER_PROOF_DOMAIN_TAGS.invocationInput);
}

/**
 * providerResultHash — commitment to the validated category result MINUS its
 * `category` property (the provider's normalized payload; D-EV3-4(3),
 * tag afi.d2.provider-result).
 */
export function providerResultHash(categoryResult: { category: string }): CanonicalHashRef {
  const { category: _category, ...payload } = jsonSemantics(categoryResult) as Record<
    string,
    unknown
  >;
  return canonicalHashOf(payload, PROVIDER_PROOF_DOMAIN_TAGS.providerResult);
}

/**
 * categoryResultHash — commitment to the FULL category result consumed by the
 * join (the re-homed afi.d2.lane-output domain; D-EV3-4(1)/(3)).
 */
export function categoryResultHash(categoryResult: { category: string }): CanonicalHashRef {
  return canonicalHashOf(jsonSemantics(categoryResult), PROVIDER_PROOF_DOMAIN_TAGS.laneOutput);
}

/**
 * evidenceRecordHash — the full-record integrity commitment: the assembled v3
 * record MINUS {recordHash, replayHash} (top-level exclusion only;
 * tag afi.d2.evidence-record; D-EV3-4(6)).
 */
export function evidenceRecordHash(record: object): CanonicalHashRef {
  return canonicalHashOf(
    jsonSemantics(record),
    PROVIDER_PROOF_DOMAIN_TAGS.evidenceRecord,
    EVIDENCE_RECORD_EXCLUDED_FIELDS
  );
}

/**
 * evidenceReplayHash — the deterministic semantic/replay commitment: the v3
 * record MINUS {recordHash, replayHash, lifecycleState, finalized,
 * recordVersion, supersedesRecordHash} (tag afi.d2.evidence-replay;
 * D-EV3-4(6)/(7)). Two evaluations of the same canonical inputs through the
 * same composition MUST produce identical values.
 */
export function evidenceReplayHash(record: object): CanonicalHashRef {
  return canonicalHashOf(
    jsonSemantics(record),
    PROVIDER_PROOF_DOMAIN_TAGS.evidenceReplay,
    EVIDENCE_REPLAY_EXCLUDED_FIELDS
  );
}
