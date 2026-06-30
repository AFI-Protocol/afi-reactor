/**
 * Reputation receipt pipehead for the AFI Signal Evaluation Pipehead System
 * (non-production POC). It emits a demo-only, receipt-like {@link
 * DemoReputationReceipt} (architecture.md §4) that ECHOES the deterministic
 * afi-core score (`uwrScore`) and the bundle's provisional lanes for human
 * inspection.
 *
 * BOUNDARY (binding, Addendum §5 / architecture §1.3): this is receipt-like
 * ONLY. It NEVER reads or mutates reputation state, a DB, or a vault, performs
 * no I/O, and makes no network calls. The receipt carries the invariant marker
 * `mutatesReputationState:false` (never true) plus a human-readable note
 * stating its non-canonical / no-state-mutation nature. It is never canonical
 * protocol truth.
 *
 * Determinism: the only timestamp on the output (`issuedAt`) comes from
 * `ctx.clock()` and is EXCLUDED from every content hash (see canonicalHash.ts).
 * The receipt is a pure function of `(scored, provisionalLanes, issuedAt)`.
 *
 * ESM: relative imports use `.js`.
 */

import type {
  AnalysisLaneId,
  DemoReputationReceipt,
  DemoScoredSignal,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "./types.js";

export const REPUTATION_RECEIPT_PIPEHEAD_ID = "reputation-receipt";

/**
 * Human-readable note carried on every receipt, stating both that it does NOT
 * mutate reputation state and that it is non-canonical / demo-only.
 */
export const REPUTATION_RECEIPT_NOTE =
  "Demo-only, non-canonical receipt. Echoes the deterministic afi-core score " +
  "for human inspection; it does NOT mutate reputation state, write to any DB " +
  "or vault, and is not canonical protocol truth.";

/** Input to the reputation receipt pipehead: the scored output + provisional lanes to echo. */
export interface ReputationReceiptInput {
  scored: DemoScoredSignal;
  provisionalLanes: AnalysisLaneId[];
}

/**
 * Build a {@link DemoReputationReceipt} that echoes the scored `uwrScore` and
 * `provisionalLanes`. Pure: no I/O, no reputation-state read/write. The
 * `provisionalLanes` list is defensively copied so the receipt never aliases
 * caller state. `issuedAt` is the injected clock value and is excluded from
 * every content hash.
 */
export function buildReputationReceipt(
  scored: DemoScoredSignal,
  provisionalLanes: AnalysisLaneId[],
  issuedAt: string
): DemoReputationReceipt {
  return {
    signalId: scored.signalId,
    uwrScore: scored.uwrScore,
    receiptKind: "demo-only",
    provisionalLanes: [...provisionalLanes],
    mutatesReputationState: false,
    note: REPUTATION_RECEIPT_NOTE,
    issuedAt,
  };
}

/**
 * Build a reputation receipt pipehead. `execute(input, ctx)` projects the
 * scored output + provisional lanes into a {@link DemoReputationReceipt}. Pure
 * given `(input, ctx)`; the only timestamps come from `ctx.clock()` and never
 * affect any content hash. Emitting a receipt mutates NO reputation state.
 */
export function createReputationReceiptPipehead(): Pipehead<
  ReputationReceiptInput,
  DemoReputationReceipt
> {
  return {
    id: REPUTATION_RECEIPT_PIPEHEAD_ID,
    kind: "reputation",
    async execute(
      input: ReputationReceiptInput,
      ctx: PipeheadContext
    ): Promise<PipeheadExecutionResult<DemoReputationReceipt>> {
      const startedAt = ctx.clock();
      const output = buildReputationReceipt(
        input.scored,
        input.provisionalLanes,
        ctx.clock()
      );
      const finishedAt = ctx.clock();
      return {
        pipeheadId: REPUTATION_RECEIPT_PIPEHEAD_ID,
        kind: "reputation",
        status: "ok",
        provisional: true,
        output,
        startedAt,
        finishedAt,
      };
    },
  };
}

/** The default reputation receipt pipehead. */
export const reputationReceiptPipehead = createReputationReceiptPipehead();
