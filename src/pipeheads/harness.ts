/**
 * Full-DAG harness for the AFI Signal Evaluation Pipehead System
 * (non-production POC). Wires the pipeheads in the fixed order
 *
 *   validate -> fan-out -> normalize -> score -> receipt -> audit
 *
 * and returns a single aggregate `{ bundle, scored, receipt, audit }` from one
 * pass over a fixture (architecture.md §3, validation-contract VAL-HARNESS-001).
 *
 * Short-circuit (VAL-PIPEHEAD-002 / VAL-SCHEMA-005): a schema-validation failure
 * is surfaced as a STRUCTURED VALUE (`{ ok:false, stage:'validation', errors }`),
 * never an uncaught throw, and NO downstream artifact (bundle/scored/receipt/
 * audit) is produced for an invalid input.
 *
 * Determinism (VAL-HARNESS-002): given a fixture and an injected fixed clock the
 * aggregate is byte-stable across runs. The only timestamps (`scoredAt`,
 * `issuedAt`, `startedAt`, `finishedAt`) come from `ctx.clock()` and are
 * excluded from every content hash; identical input ⇒ identical hashes.
 *
 * BOUNDARY (binding): the harness only COMPOSES the existing pipeheads. Scoring
 * is performed solely by the afi-core scorer (bound in scoringPipehead.ts);
 * this module never touches scoring/UWR/reputation math, mutates state, or
 * performs I/O. The scorer is injectable so tests can supply a deterministic
 * stub (the afi-core value subpath is only resolvable under
 * `node --loader ts-node/esm`).
 *
 * ESM: relative imports use `.js`.
 */

import type { AfiCandle } from "../types/AfiCandle.js";
import type {
  AnalysisBundle,
  AnalysisLaneResult,
  AuditRecord,
  DemoReputationReceipt,
  DemoScoredSignal,
  PipeheadContext,
} from "./types.js";
import type { Clock } from "./clock.js";
import { createFrozenClock } from "./clock.js";
import {
  schemaValidationPipehead,
  type StructuralUssValidationResult,
  type StructuralValidationError,
} from "./schemaValidationPipehead.js";
import { fanOut } from "./fanOut.js";
import { normalizePipehead, extractIdentityFromUss } from "./normalizePipehead.js";
import {
  createScoringPipehead,
  scoringPipehead,
  type FroggyScorer,
} from "./scoringPipehead.js";
import { reputationReceiptPipehead } from "./reputationReceipt.js";
import { auditPipehead } from "./auditPipehead.js";

export const HARNESS_ID = "pipehead-harness";

/** Fixture inputs consumed by one harness pass: the USS signal + its OHLCV. */
export interface HarnessInput {
  rawUss: unknown;
  candles: AfiCandle[];
}

/** Injection seams: a deterministic clock and (for tests) a stub scorer. */
export interface HarnessOptions {
  clock?: Clock;
  scorer?: FroggyScorer;
}

/** The four-artifact aggregate produced by a successful end-to-end run. */
export interface HarnessAggregate {
  ok: true;
  validation: StructuralUssValidationResult;
  bundle: AnalysisBundle;
  scored: DemoScoredSignal;
  receipt: DemoReputationReceipt;
  audit: AuditRecord;
}

/**
 * The structured short-circuit value returned when schema validation fails. It
 * carries the field-level errors and deliberately contains NO downstream
 * artifact (VAL-SCHEMA-005).
 */
export interface HarnessFailure {
  ok: false;
  stage: "validation";
  validation: StructuralUssValidationResult;
  errors: StructuralValidationError[];
}

export type HarnessResult = HarnessAggregate | HarnessFailure;

/** Narrow a {@link HarnessResult} to the structured-failure case. */
export function isHarnessFailure(result: HarnessResult): result is HarnessFailure {
  return result.ok === false;
}

/**
 * Run the full pipehead DAG once over a fixture. Returns the four-artifact
 * aggregate on success, or a structured validation failure (no throw, no
 * downstream artifacts) when the input is rejected by schema validation.
 */
export async function runPipeheadHarness(
  input: HarnessInput,
  options: HarnessOptions = {}
): Promise<HarnessResult> {
  const clock = options.clock ?? createFrozenClock();
  const { rawUss } = input;
  const signalId = extractIdentityFromUss(rawUss).signalId;
  const ctx: PipeheadContext = { signalId, rawUss, clock };

  // 1. validate — structured failure short-circuits with no downstream artifacts.
  const validationResult = await schemaValidationPipehead.execute(rawUss, ctx);
  const validation = validationResult.output;
  if (validationResult.status !== "ok" || !validation.ok) {
    return { ok: false, stage: "validation", validation, errors: validation.errors };
  }

  // 2. fan-out across the five lanes (error-isolated; always five results).
  const laneResults: AnalysisLaneResult[] = await fanOut({ candles: input.candles }, ctx);

  // 3. normalize → AnalysisBundle (+ FroggyEnrichedView, provenance binding).
  const bundle = (await normalizePipehead.execute(laneResults, ctx)).output;

  // 4. score — invokes the afi-core deterministic scorer (or an injected stub).
  const scoringHead = options.scorer
    ? createScoringPipehead(options.scorer)
    : scoringPipehead;
  const scored = (await scoringHead.execute(bundle, ctx)).output;

  // 5. reputation receipt — demo-only, mutates no reputation state.
  const receipt = (
    await reputationReceiptPipehead.execute(
      { scored, provisionalLanes: bundle.provisionalLanes },
      ctx
    )
  ).output;

  // 6. audit — content-hashed record binding input/bundle/output.
  const audit = (await auditPipehead.execute({ bundle, scored }, ctx)).output;

  return { ok: true, validation, bundle, scored, receipt, audit };
}
