/**
 * Scoring pipehead for the AFI Signal Evaluation Pipehead System (pre-live
 * reference implementation). It INVOKES the afi-core deterministic scorer
 * `scoreFroggyTrendPullbackFromEnriched(enriched)` with `defaultUwrConfig`
 * UNCHANGED (analystId "froggy", strategyId "trend_pullback_v1", four equal
 * 0.25 weights) over the OPAQUE strategy-local view carried by the
 * AnalystInputEnvelope v1, and projects its output into an INTERNAL
 * {@link InternalScoringResult} carrier. The outward scored surface is the
 * ScoredSignal v1 projection emitted by the provenance pipehead — this
 * internal carrier is never emitted outward.
 *
 * BOUNDARY (binding): scoring is performed ONLY by the afi-core scorer. This
 * module NEVER reimplements, re-weights, or "adjusts" any scoring/UWR math.
 * It carries the afi-core `analystScore` through VERBATIM and surfaces its
 * `uwrScore`/`uwrAxes` at the top level for convenience.
 *
 * Determinism: the only timestamp on the output (`scoredAt`) comes from
 * `ctx.clock()`, is volatile runtime metadata, and is EXCLUDED from every
 * content hash (see provenance/canonicalHashV1.ts). Identical envelope ->
 * identical `uwrScore`/`uwrAxes` (deterministic kernel).
 *
 * Runtime note (from m1-normalize-bundle handoff): Jest's resolver CANNOT load
 * the afi-core `./analysts/*` VALUE subpath (its export key declares only
 * `import`/`types`, no `require`/`default`). TYPE-only imports are erased and
 * work fine. The real scorer is therefore bound via a DYNAMIC import inside
 * {@link froggyScorer}, so this module LOADS under Jest (the dynamic import is
 * only evaluated when invoked under `node --loader ts-node/esm`, the same
 * resolution path as the CLI). Jest tests inject a stub scorer and assert on
 * the projection/shape/labels; the real-scorer runtime assertions live in the
 * spawned-CLI suites.
 *
 * ESM: relative imports use `.js`; the afi-core scorer is referenced by the
 * `afi-core/...` package name (type-only at the top level, dynamic at runtime).
 */

import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import type {
  InternalScoringResult,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "./types.js";
import type { AnalystInputEnvelopeV1 } from "./provenance/types.js";

export const SCORING_PIPEHEAD_ID = "scoring";

/** The afi-core `AnalystScoreTemplate` shape, derived from the scorer output. */
type AnalystScore = FroggyTrendPullbackScore["analystScore"];

/**
 * A scorer maps a `FroggyEnrichedView` to a `FroggyTrendPullbackScore`. This is
 * the CLEAN SEAM that lets tests inject a stub while the demo/CLI uses the real
 * afi-core scorer ({@link froggyScorer}).
 */
export type FroggyScorer = (
  enriched: FroggyEnrichedView
) => FroggyTrendPullbackScore | Promise<FroggyTrendPullbackScore>;

/**
 * The REAL deterministic scorer, bound to afi-core
 * `scoreFroggyTrendPullbackFromEnriched` with `defaultUwrConfig` unchanged.
 *
 * The afi-core value subpath is loaded via a DYNAMIC import so this module is
 * importable under Jest (which cannot resolve the `./analysts/*` value subpath);
 * the import resolves normally under `node --loader ts-node/esm` (the CLI path).
 */
export const froggyScorer: FroggyScorer = async (enriched) => {
  const mod = (await import(
    "afi-core/analysts/froggy.trend_pullback_v1.js"
  )) as unknown as {
    scoreFroggyTrendPullbackFromEnriched: (
      enriched: FroggyEnrichedView
    ) => FroggyTrendPullbackScore;
  };
  return mod.scoreFroggyTrendPullbackFromEnriched(enriched);
};

/**
 * Project an afi-core `FroggyTrendPullbackScore` into the INTERNAL
 * {@link InternalScoringResult} carrier. The embedded `analystScore` is
 * carried through VERBATIM; `uwrScore`/`uwrAxes` are surfaced from it (never
 * recomputed). `scoredAt` is the injected clock value — volatile runtime
 * metadata excluded from every content hash and never emitted outward.
 */
export function buildInternalScoringResult(
  scoreResult: FroggyTrendPullbackScore,
  signalId: string,
  scoredAt: string
): InternalScoringResult {
  const analystScore = scoreResult.analystScore as AnalystScore;
  const axes = analystScore.uwrAxes;
  return {
    signalId,
    uwrScore: analystScore.uwrScore,
    uwrAxes: {
      structure: axes.structure,
      execution: axes.execution,
      risk: axes.risk,
      insight: axes.insight,
    },
    analystScore,
    scoredAt,
  };
}

/**
 * Build a scoring pipehead bound to the given scorer. `execute(envelope, ctx)`
 * feeds the envelope's OPAQUE `strategyLocalView` to the scorer and projects
 * the result into an internal carrier. Pure given `(envelope, ctx, scorer)`;
 * the only timestamps come from `ctx.clock()` and never affect any content
 * hash.
 */
export function createScoringPipehead(
  scorer: FroggyScorer = froggyScorer
): Pipehead<AnalystInputEnvelopeV1, InternalScoringResult> {
  return {
    id: SCORING_PIPEHEAD_ID,
    kind: "scoring",
    async execute(
      envelope: AnalystInputEnvelopeV1,
      ctx: PipeheadContext
    ): Promise<PipeheadExecutionResult<InternalScoringResult>> {
      const startedAt = ctx.clock();
      const enriched = envelope.strategyLocalView as unknown as FroggyEnrichedView;
      const scoreResult = await scorer(enriched);
      const output = buildInternalScoringResult(
        scoreResult,
        envelope.signalId,
        ctx.clock()
      );
      const finishedAt = ctx.clock();
      return {
        pipeheadId: SCORING_PIPEHEAD_ID,
        kind: "scoring",
        status: "ok",
        provisional: false,
        output,
        startedAt,
        finishedAt,
      };
    },
  };
}

/**
 * The default scoring pipehead, bound to the REAL afi-core scorer. Use under
 * `node --loader ts-node/esm` (CLI/driver); Jest tests use
 * {@link createScoringPipehead} with an injected stub.
 */
export const scoringPipehead = createScoringPipehead();
