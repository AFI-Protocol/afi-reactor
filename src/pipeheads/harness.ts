/**
 * Full-DAG harness for the AFI Signal Evaluation Pipehead System — a pre-live
 * REFERENCE IMPLEMENTATION / implementation profile of one signal-evaluation
 * path with a D2-native outward artifact surface. Wires the pipeheads in the
 * fixed order
 *
 *   validate -> fan-out -> normalize -> envelope -> score -> provenance
 *
 * and returns a single aggregate whose OUTWARD artifacts are D2-native:
 *
 *   - AnalystInputEnvelope v1 (opaque, declared, hash-pinned strategy view)
 *   - ScoredSignal v1 projection (afi-core scoring values verbatim)
 *   - ProvenanceRecord v1 (input/enrichment/output CanonicalHash v1 digests)
 *   - ReplayProfile v1 (deterministic replay pins)
 *
 * The pre-D2 POC artifacts (AnalysisBundle as an outward block,
 * DemoScoredSignal, DemoReputationReceipt, AuditRecord) are RETIRED from the
 * outward surface. The normalized bundle and the raw scoring carrier remain
 * available under `internal` — clearly-marked in-process intermediates for
 * tests only, never outward artifacts.
 *
 * Short-circuit (VAL-PIPEHEAD-002 / VAL-SCHEMA-005): a schema-validation
 * failure is surfaced as a STRUCTURED VALUE (`{ ok:false, stage:'validation',
 * errors }`), never an uncaught throw, and NO downstream artifact is produced
 * for an invalid input. A D2 artifact-validation failure surfaces the same
 * way under `stage: 'artifact-validation'`.
 *
 * Determinism (VAL-HARNESS-002): given a fixture the four OUTWARD D2
 * artifacts are byte-stable across runs — even under DIFFERENT clocks,
 * because they carry no runtime timestamps at all. Clock values only appear
 * on internal carriers and are excluded from every content hash.
 *
 * BOUNDARY (binding): the harness only COMPOSES the existing pipeheads.
 * Scoring is performed solely by the afi-core scorer (bound in
 * scoringPipehead.ts); this module never touches scoring/UWR math, mutates
 * state, or performs I/O. The scorer is injectable so tests can supply a
 * deterministic stub (the afi-core value subpath is only resolvable under
 * `node --loader ts-node/esm`).
 *
 * ESM: relative imports use `.js`.
 */

import type { AfiCandle } from "../types/AfiCandle.js";
import type {
  AnalysisBundle,
  AnalysisLaneResult,
  InternalScoringResult,
  PipeheadContext,
} from "./types.js";
import type { Clock } from "./clock.js";
import { createFrozenClock } from "./clock.js";
import {
  schemaValidationPipehead,
  type UssValidationResult,
  type UssValidationError,
} from "./schemaValidationPipehead.js";
import { fanOut } from "./fanOut.js";
import { normalizePipehead, extractIdentityFromUss } from "./normalizePipehead.js";
import {
  createScoringPipehead,
  scoringPipehead,
  type FroggyScorer,
} from "./scoringPipehead.js";
import { envelopePipehead } from "./provenance/envelopePipehead.js";
import {
  provenancePipehead,
  type D2ArtifactValidationError,
} from "./provenance/provenancePipehead.js";
import type {
  AnalystInputEnvelopeV1,
  ProvenanceRecordV1,
  ReplayProfileV1,
  ScoredSignalV1,
} from "./provenance/types.js";

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

/** In-process intermediates exposed for tests only — never outward artifacts. */
export interface HarnessInternalArtifacts {
  bundle: AnalysisBundle;
  scored: InternalScoringResult;
}

/** The D2-native aggregate produced by a successful end-to-end run. */
export interface HarnessAggregate {
  ok: true;
  validation: UssValidationResult;
  envelope: AnalystInputEnvelopeV1;
  scoredSignal: ScoredSignalV1;
  provenanceRecord: ProvenanceRecordV1;
  replayProfile: ReplayProfileV1;
  /** Clearly-marked INTERNAL intermediates (tests only; not outward surface). */
  internal: HarnessInternalArtifacts;
}

/**
 * The structured short-circuit value returned when USS schema validation
 * fails. It carries the field-level errors and deliberately contains NO
 * downstream artifact (VAL-SCHEMA-005).
 */
export interface HarnessValidationFailure {
  ok: false;
  stage: "validation";
  validation: UssValidationResult;
  errors: UssValidationError[];
}

/**
 * The structured value returned when a GENERATED artifact fails D2 schema
 * validation (defensive; should not occur for well-formed fixtures).
 */
export interface HarnessArtifactFailure {
  ok: false;
  stage: "artifact-validation";
  errors: D2ArtifactValidationError[];
}

export type HarnessFailure = HarnessValidationFailure | HarnessArtifactFailure;

export type HarnessResult = HarnessAggregate | HarnessFailure;

/** Narrow a {@link HarnessResult} to the structured-failure case. */
export function isHarnessFailure(result: HarnessResult): result is HarnessFailure {
  return result.ok === false;
}

/**
 * Run the full pipehead DAG once over a fixture. Returns the D2-native
 * aggregate on success, or a structured failure (no throw, no downstream
 * artifacts) when the input is rejected by USS validation or a generated
 * artifact fails D2 validation.
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

  // 3. normalize -> INTERNAL AnalysisBundle (reference adapter/profile).
  const bundle = (await normalizePipehead.execute(laneResults, ctx)).output;

  // 4. envelope -> AnalystInputEnvelope v1 (the analyst-input boundary).
  const envelope = (
    await envelopePipehead.execute({ bundle, candles: input.candles }, ctx)
  ).output;

  // 5. score — invokes the afi-core deterministic scorer (or an injected stub)
  //    over the envelope's opaque strategy-local view.
  const scoringHead = options.scorer
    ? createScoringPipehead(options.scorer)
    : scoringPipehead;
  const scored = (await scoringHead.execute(envelope, ctx)).output;

  // 6. provenance -> ScoredSignal v1 + ReplayProfile v1 + ProvenanceRecord v1
  //    (validated in-process against the merged afi-config schemas).
  const provenanceResult = (
    await provenancePipehead.execute({ bundle, envelope, scored }, ctx)
  ).output;
  if (provenanceResult.ok === false) {
    return {
      ok: false,
      stage: "artifact-validation",
      errors: provenanceResult.errors,
    };
  }

  const { scoredSignal, replayProfile, provenanceRecord } = provenanceResult.artifacts;
  return {
    ok: true,
    validation,
    envelope,
    scoredSignal,
    provenanceRecord,
    replayProfile,
    internal: { bundle, scored },
  };
}
