/**
 * CanonicalHash v1 — off-chain D2 canonicalization + hashing runtime
 * (District 2 M2; reference implementation of the D2 hash doctrine).
 *
 * Produces `CanonicalHashV1` reference objects conforming to the merged
 * afi-config schema `schemas/provenance/v1/canonical-hash.schema.json`:
 * `{ algorithm: "sha256", canonicalizationVersion: "afi.hash.v1", domainTag,
 * value }`. The DIGEST rules pinned by `afi.hash.v1` in this implementation:
 *
 *  1. **sha256 only.** No keccak256 and no on-chain domain family — those are
 *     a separate domain family and MUST NOT be represented with this object.
 *  2. **Domain separation in the preimage.** The digest is computed over
 *     `"afi.hash.v1" + "\n" + domainTag + "\n" + canonicalJson`, so the same
 *     canonical object hashed under two different domain tags yields two
 *     different digests — cross-domain hash reuse is structurally impossible.
 *  3. **Deterministic recursive key sorting + stable JSON serialization.**
 *     Object keys are sorted lexicographically at every depth; array order is
 *     preserved (substantive); `undefined` members are dropped.
 *  4. **Timestamp policy (D2 hash doctrine).** Volatile runtime/storage
 *     timestamps ({@link VOLATILE_TIMESTAMP_KEYS}) are NOT canonical hash
 *     material: they are excluded recursively by default, or rejected under
 *     `volatileTimestampPolicy: "reject"`. Domain-declared evidence/evaluation
 *     timestamps ({@link EVIDENCE_TIMESTAMP_KEYS}) ARE admissible hash
 *     material and pass through untouched.
 *  5. **Number policy.** Safe integers are admissible. Every non-integer
 *     number is REJECTED — unconditionally; there is deliberately NO opt-in
 *     flag that admits arbitrary floats. Known numeric fields on declared
 *     surfaces are handled by the narrow, field-specific hash-projection
 *     layer in `hashProjection.ts`, which converts them to deterministic
 *     canonical decimal STRINGS before hashing. Decimal strings are preserved
 *     as strings and never coerced.
 *
 * BOUNDARY: this module computes digests only. It performs no I/O, reads no
 * clock, and defines no on-chain or economic behavior of any kind.
 *
 * ESM: relative imports use `.js`.
 */

import crypto from "crypto";

/** Canonicalization rules version pinned by this implementation. */
export const AFI_HASH_V1 = "afi.hash.v1" as const;

/** The only hash algorithm admissible for off-chain D2 canonical domains. */
export const HASH_ALGORITHM_SHA256 = "sha256" as const;

/** Structural pattern for off-chain D2 domain tags (afi.* style). */
export const DOMAIN_TAG_PATTERN = /^afi(\.[a-z0-9-]+)+$/;

/**
 * Volatile runtime/storage timestamp keys. These describe processing or
 * storage moments — not the evidence itself — and are NOT canonical hash
 * material (D2 hash doctrine). Excluded recursively by default; rejected
 * under `volatileTimestampPolicy: "reject"`.
 */
export const VOLATILE_TIMESTAMP_KEYS = [
  "scoredAt",
  "createdAt",
  "updatedAt",
  "storedAt",
  "processedAt",
  "ingestedAt",
  "startedAt",
  "finishedAt",
] as const;

/**
 * Domain-declared evidence/evaluation timestamp keys. These describe the
 * evidence or the domain moment itself and ARE admissible canonical hash
 * material. They receive no special treatment — they pass through as ordinary
 * string values (documented allow-list per the D2 hash doctrine).
 */
export const EVIDENCE_TIMESTAMP_KEYS = [
  "asOf",
  "fetchedAt",
  "postedAt",
  "observedAt",
  "observationTime",
  "evaluatedAt",
] as const;

/** Off-chain D2 domain tags used by this reference implementation. */
export const D2_DOMAIN_TAGS = {
  signalInput: "afi.d2.signal-input",
  enrichmentBundle: "afi.d2.enrichment-bundle",
  scoredOutput: "afi.d2.scored-output",
  evidence: "afi.d2.evidence",
  laneOutput: "afi.d2.lane-output",
  strategyLocalView: "afi.d2.strategy-local-view",
  provenanceRecord: "afi.d2.provenance-record",
} as const;

/**
 * CanonicalHash v1 reference object (mirrors the merged afi-config schema
 * `canonical-hash.schema.json`; AJV over that schema remains validation truth).
 */
export interface CanonicalHashV1 {
  algorithm: typeof HASH_ALGORITHM_SHA256;
  canonicalizationVersion: typeof AFI_HASH_V1;
  domainTag: string;
  value: string;
  legacyHashRef?: string;
}

/** Structured reasons a value can violate the afi.hash.v1 canonical policy. */
export type CanonicalHashPolicyReason =
  | "non-integer-number"
  | "non-finite-number"
  | "volatile-timestamp"
  | "invalid-domain-tag"
  | "unsupported-value";

/**
 * Structured policy error thrown when a value cannot be canonical hash
 * material under afi.hash.v1 (never a bare string throw).
 */
export class CanonicalHashPolicyError extends Error {
  readonly reason: CanonicalHashPolicyReason;
  readonly path: string;

  constructor(reason: CanonicalHashPolicyReason, path: string, detail: string) {
    super(`afi.hash.v1 policy violation at ${path}: ${detail}`);
    this.name = "CanonicalHashPolicyError";
    this.reason = reason;
    this.path = path;
  }
}

/** How volatile runtime/storage timestamp keys are treated. */
export type VolatileTimestampPolicy = "exclude" | "reject";

export interface CanonicalizeV1Options {
  /** Default "exclude": volatile keys are recursively dropped. "reject" throws. */
  volatileTimestampPolicy?: VolatileTimestampPolicy;
}

export interface ComputeCanonicalHashV1Options extends CanonicalizeV1Options {
  /** Required afi.* style domain-separation tag (part of the digest preimage). */
  domainTag: string;
}

const VOLATILE_KEY_SET: ReadonlySet<string> = new Set(VOLATILE_TIMESTAMP_KEYS);

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function canonicalValueV1(
  value: unknown,
  path: string,
  policy: VolatileTimestampPolicy
): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalHashPolicyError(
        "non-finite-number",
        path,
        `non-finite number (${String(value)}) is never canonical hash material`
      );
    }
    if (!Number.isInteger(value)) {
      throw new CanonicalHashPolicyError(
        "non-integer-number",
        path,
        `raw non-integer number (${String(value)}) is rejected; declared numeric ` +
          `fields must be projected to canonical decimal strings first ` +
          `(see hashProjection.ts) — there is no float opt-in`
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new CanonicalHashPolicyError(
        "unsupported-value",
        path,
        `integer outside the safe range (${String(value)}); encode it as a decimal string`
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      canonicalValueV1(item, `${path}[${index}]`, policy)
    );
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const childPath = `${path}.${key}`;
      if (VOLATILE_KEY_SET.has(key)) {
        if (policy === "reject") {
          throw new CanonicalHashPolicyError(
            "volatile-timestamp",
            childPath,
            `volatile runtime/storage timestamp key "${key}" is not canonical hash material`
          );
        }
        continue; // "exclude": recursively dropped from hash material
      }
      const child = source[key];
      if (child === undefined) {
        continue;
      }
      out[key] = canonicalValueV1(child, childPath, policy);
    }
    return out;
  }
  throw new CanonicalHashPolicyError(
    "unsupported-value",
    path,
    `${describeType(value)} values cannot be canonical hash material`
  );
}

/**
 * Produce the stable afi.hash.v1 canonical JSON string for a value:
 * recursively key-sorted, volatile timestamps excluded (or rejected), floats
 * rejected, `undefined` members dropped, array order preserved.
 */
export function canonicalizeV1(
  value: unknown,
  options: CanonicalizeV1Options = {}
): string {
  const policy = options.volatileTimestampPolicy ?? "exclude";
  if (value === undefined) {
    throw new CanonicalHashPolicyError(
      "unsupported-value",
      "$",
      "undefined cannot be canonical hash material"
    );
  }
  return JSON.stringify(canonicalValueV1(value, "$", policy));
}

/** Validate an afi.* style domain tag; throws a structured policy error. */
export function assertValidDomainTag(domainTag: string): void {
  if (typeof domainTag !== "string" || !DOMAIN_TAG_PATTERN.test(domainTag)) {
    throw new CanonicalHashPolicyError(
      "invalid-domain-tag",
      "$",
      `domainTag "${String(domainTag)}" must match ${DOMAIN_TAG_PATTERN.source}`
    );
  }
}

/**
 * Build the exact domain-separated preimage the afi.hash.v1 digest is
 * computed over. Exposed so tests can prove the domain tag participates in
 * the preimage (cross-domain reuse prevention).
 */
export function canonicalPreimageV1(
  value: unknown,
  options: ComputeCanonicalHashV1Options
): string {
  assertValidDomainTag(options.domainTag);
  const canonicalJson = canonicalizeV1(value, options);
  return `${AFI_HASH_V1}\n${options.domainTag}\n${canonicalJson}`;
}

/**
 * Compute the CanonicalHash v1 reference object for a value under a required
 * afi.* domain tag: sha256 over the domain-separated afi.hash.v1 preimage.
 */
export function computeCanonicalHashV1(
  value: unknown,
  options: ComputeCanonicalHashV1Options
): CanonicalHashV1 {
  const preimage = canonicalPreimageV1(value, options);
  const digest = crypto.createHash("sha256").update(preimage, "utf8").digest("hex");
  return {
    algorithm: HASH_ALGORITHM_SHA256,
    canonicalizationVersion: AFI_HASH_V1,
    domainTag: options.domainTag,
    value: digest,
  };
}
