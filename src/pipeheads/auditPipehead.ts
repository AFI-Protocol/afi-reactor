/**
 * Audit pipehead for the AFI Signal Evaluation Pipehead System
 * (non-production POC). It emits a content-hashed {@link AuditRecord}
 * (architecture.md §4) binding a run's validated input, normalized bundle, and
 * deterministic score together via canonical sha256 digests.
 *
 * Hashing (architecture.md §5, validation-contract VAL-AUDIT-001..010):
 *  - `inputHash`  = canonical hash of the raw USS input.
 *  - `bundleHash` = canonical hash of the AnalysisBundle (timestamps stripped).
 *  - `outputHash` = canonical hash of the explicit deterministic scoring
 *    PROJECTION ({@link buildScoringProjection}: `{uwrScore, uwrAxes, analystId,
 *    strategyId, direction, riskBucket, conviction}`) — NEVER the raw
 *    timestamped scored object, so the afi-core wall-clock `scoredAt` can never
 *    leak into the hash.
 *
 * All three digests use the shared recursive, key-SORTED canonicalizer in
 * canonicalHash.ts, which strips the fixed runtime-timestamp key set before
 * sha256. Therefore identical input ⇒ identical digests regardless of key order
 * or human-facing timestamps. The record self-labels `algo:'sha256'`,
 * `scoredAtExcluded:true`, and `demoOnly:true`.
 *
 * BOUNDARY (binding): this module computes hashes only. It never mutates state,
 * performs I/O, or touches scoring/UWR/reputation math.
 *
 * Determinism: pure given `(rawUss, bundle, scored)`. Any timestamp on the
 * pipehead result comes from `ctx.clock()` and is excluded from every hash.
 *
 * ESM: relative imports use `.js`.
 */

import type {
  AnalysisBundle,
  AuditRecord,
  DemoScoredSignal,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "./types.js";
import { buildScoringProjection, canonicalHash } from "./canonicalHash.js";

export const AUDIT_PIPEHEAD_ID = "audit";

/**
 * Input to the audit pipehead: the normalized bundle and the deterministic
 * scored output to bind. The raw USS input is read from `ctx.rawUss` so the
 * `inputHash` always reflects the exact validated fixture the run consumed.
 */
export interface AuditPipeheadInput {
  bundle: AnalysisBundle;
  scored: DemoScoredSignal;
}

/**
 * Build a content-hashed {@link AuditRecord} from a run's `(rawUss, bundle,
 * scored)`. Pure: computes three canonical sha256 digests and echoes the
 * deterministic score / provisional-lane fields. `outputHash` commits the
 * explicit scoring projection (timestamps excluded), never the raw scored
 * object.
 */
export function buildAuditRecord(
  rawUss: unknown,
  bundle: AnalysisBundle,
  scored: DemoScoredSignal
): AuditRecord {
  return {
    signalId: bundle.signalId,
    algo: "sha256",
    inputHash: canonicalHash(rawUss),
    bundleHash: canonicalHash(bundle),
    outputHash: canonicalHash(buildScoringProjection(scored)),
    uwrScore: scored.uwrScore,
    uwrAxes: {
      structure: scored.uwrAxes.structure,
      execution: scored.uwrAxes.execution,
      risk: scored.uwrAxes.risk,
      insight: scored.uwrAxes.insight,
    },
    provisionalLanes: [...bundle.provisionalLanes],
    scoredAtExcluded: true,
    demoOnly: true,
  };
}

/**
 * Build an audit pipehead. `execute(input, ctx)` reads the validated `rawUss`
 * from `ctx` and emits a content-hashed {@link AuditRecord}. Pure given
 * `(input, ctx)`; the only timestamps come from `ctx.clock()` and never affect
 * any content hash.
 */
export function createAuditPipehead(): Pipehead<AuditPipeheadInput, AuditRecord> {
  return {
    id: AUDIT_PIPEHEAD_ID,
    kind: "audit",
    async execute(
      input: AuditPipeheadInput,
      ctx: PipeheadContext
    ): Promise<PipeheadExecutionResult<AuditRecord>> {
      const startedAt = ctx.clock();
      const output = buildAuditRecord(ctx.rawUss, input.bundle, input.scored);
      const finishedAt = ctx.clock();
      return {
        pipeheadId: AUDIT_PIPEHEAD_ID,
        kind: "audit",
        status: "ok",
        provisional: true,
        output,
        startedAt,
        finishedAt,
      };
    },
  };
}

/** The default audit pipehead. */
export const auditPipehead = createAuditPipehead();
