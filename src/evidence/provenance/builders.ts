/**
 * District-2 provenance builders — the live projection/hash law consumed by
 * the canonical evidence construction (`src/evidence/reactorEvidenceRecord.ts`
 * and `src/evidence/submitScoredSignalEvidence.ts`). Relocated from the
 * retired District-1-era reference tree under DSC-GOV D-DSC-3 (organizational
 * relocation only — no semantic change; Evidence V2, canonical hashing, and
 * hash projection are byte-stable).
 *
 * Canonical status belongs only to the merged afi-config schemas, validation
 * rules, and hash doctrine — never to any pipeline topology or strategy.
 *
 * NO CIRCULAR PROVENANCE HASHING (acyclic commitment order, by construction):
 *  1. `provenanceRecordRefFor(signalId)` is deterministic and derived ONLY
 *     from the signalId — never from any digest of the ProvenanceRecord.
 *  2. The ScoredSignal v1 projection is built FIRST and carries only that
 *     string ref (never a `provenanceRecordHash` and never any digest of the
 *     record).
 *  3. `ProvenanceRecord.outputHash` then commits to the FINISHED ScoredSignal
 *     projection. Record -> ScoredSignal commitment is one-directional, so a
 *     ScoredSignal <-> ProvenanceRecord hash cycle cannot exist.
 *
 * ESM: relative imports use `.js`; afi-core is never imported here.
 */

import type { InternalScoringResult } from "../analysis/internalScoringResult.js";
import {
  computeCanonicalHashV1,
  D2_DOMAIN_TAGS,
  type CanonicalHashV1,
} from "./canonicalHashV1.js";
import {
  projectDecimalFieldsForHash,
  SCORE_DECIMAL_KEYS,
  USS_INPUT_DECIMAL_KEYS,
} from "./hashProjection.js";
import {
  SCORED_SIGNAL_SCHEMA,
  type ScoredSignalV1,
} from "./types.js";

/** Reference analyst/strategy identity fallbacks for the projection. */
export const REFERENCE_ANALYST_ID = "froggy";
export const REFERENCE_STRATEGY_ID = "trend_pullback_v1";

/**
 * Keys that must NEVER appear in D2 canonical outputs (runtime/storage
 * baggage, debug fields, and out-of-scope protocol areas). The merged schemas
 * already reject these structurally via `additionalProperties: false`; this
 * guard is the defensive in-process check (it also scans the opaque
 * strategy-local view).
 */
export const FORBIDDEN_ARTIFACT_KEYS = [
  "rawUss",
  "lenses",
  "_priceFeedMetadata",
  "_id",
  "createdAt",
  "updatedAt",
  "rawPayload",
  "claimRoot",
  "rewardAmount",
  "vaultAddress",
  "validatorDecision",
  "demoOnly",
] as const;

const FORBIDDEN_KEY_SET: ReadonlySet<string> = new Set(FORBIDDEN_ARTIFACT_KEYS);

/** Recursively collect the paths of any forbidden keys present in a value. */
export function findForbiddenArtifactKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      hits.push(...findForbiddenArtifactKeys(item, `${path}[${index}]`))
    );
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_SET.has(key)) {
        hits.push(`${path}.${key}`);
      }
      hits.push(...findForbiddenArtifactKeys(child, `${path}.${key}`));
    }
  }
  return hits;
}

/**
 * Deterministic ref to the ProvenanceRecord for a signal. Derived ONLY from
 * the signalId — never from any digest of the record — so the ScoredSignal
 * projection can carry it without creating a hash cycle (see module header).
 */
export function provenanceRecordRefFor(signalId: string): string {
  return `provenance-record:${signalId}`;
}

/** Options for {@link buildScoredSignalProjection}. */
export interface ScoredSignalProjectionOptions {
  providerId?: string;
  /**
   * Deterministic ref to the ProvenanceRecord (id-derived only; never a
   * digest of the record — see the no-cycle note in the module header).
   */
  provenanceRecordRef: string;
  /**
   * OPTIONAL domain-declared evaluation time (e.g. the OHLCV evidence asOf /
   * candle close). Never wall-clock runtime; the volatile `scoredAt` on the
   * internal carrier is NEVER emitted.
   */
  evaluatedAt?: string;
}

/** Shape of the verbatim afi-core analystScore (read, never recomputed). */
interface AnalystScoreFields {
  analystId?: unknown;
  strategyId?: unknown;
  strategyVersion?: unknown;
  direction?: unknown;
  riskBucket?: unknown;
  conviction?: unknown;
}

/**
 * Project the internal scoring result into the thin ScoredSignal v1
 * projection. PROJECTION ONLY: every scoring value is read verbatim from the
 * afi-core `analystScore` / carrier — nothing is recomputed, re-weighted, or
 * adjusted here.
 */
export function buildScoredSignalProjection(
  scored: InternalScoringResult,
  options: ScoredSignalProjectionOptions
): ScoredSignalV1 {
  const analyst = (scored.analystScore ?? {}) as AnalystScoreFields;
  const direction = analyst.direction;
  if (direction !== "long" && direction !== "short" && direction !== "neutral") {
    throw new Error(
      `buildScoredSignalProjection: unsupported direction "${String(direction)}"`
    );
  }

  const projection: ScoredSignalV1 = {
    schema: SCORED_SIGNAL_SCHEMA,
    signalId: scored.signalId,
    analystId: String(analyst.analystId ?? REFERENCE_ANALYST_ID),
    strategyId: String(analyst.strategyId ?? REFERENCE_STRATEGY_ID),
    direction,
    uwrScore: scored.uwrScore,
    uwrAxes: {
      structure: scored.uwrAxes.structure,
      execution: scored.uwrAxes.execution,
      risk: scored.uwrAxes.risk,
      insight: scored.uwrAxes.insight,
    },
    provenanceRecordRef: options.provenanceRecordRef,
  };

  if (typeof analyst.strategyVersion === "string") {
    projection.strategyVersion = analyst.strategyVersion;
  }
  if (typeof analyst.riskBucket === "string" && analyst.riskBucket.length > 0) {
    projection.riskBucket = analyst.riskBucket;
  }
  if (typeof analyst.conviction === "number") {
    projection.conviction = analyst.conviction;
  }
  if (options.providerId !== undefined) {
    projection.providerId = options.providerId;
  }
  if (options.evaluatedAt !== undefined) {
    projection.evaluatedAt = options.evaluatedAt;
  }

  return projection;
}

/**
 * Compute the signal-input domain hash of the validated raw USS. Declared USS
 * numeric fields (e.g. the fractional CPJ `provenance.cpjParseConfidence`) are
 * projected to canonical decimal strings first (afi.hash.v1 fixed-point policy),
 * so a decimal parser confidence hashes deterministically rather than failing
 * closed. A structural no-op for USS with no declared numeric fields.
 */
export function computeInputHash(rawUss: unknown): CanonicalHashV1 {
  return computeCanonicalHashV1(
    projectDecimalFieldsForHash(rawUss, USS_INPUT_DECIMAL_KEYS),
    { domainTag: D2_DOMAIN_TAGS.signalInput }
  );
}

/** Compute the scored-output domain hash of a FINISHED ScoredSignal projection. */
export function computeScoredOutputHash(
  scoredSignal: ScoredSignalV1
): CanonicalHashV1 {
  return computeCanonicalHashV1(
    projectDecimalFieldsForHash(scoredSignal, SCORE_DECIMAL_KEYS),
    { domainTag: D2_DOMAIN_TAGS.scoredOutput }
  );
}
