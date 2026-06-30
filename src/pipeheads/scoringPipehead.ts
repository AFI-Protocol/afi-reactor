/**
 * Scoring pipehead for the AFI Signal Evaluation Pipehead System
 * (non-production POC). It INVOKES the afi-core deterministic scorer
 * `scoreFroggyTrendPullbackFromEnriched(enriched)` with `defaultUwrConfig`
 * UNCHANGED (analystId "froggy", strategyId "trend_pullback_v1", four equal
 * 0.25 weights) and projects its output into a {@link DemoScoredSignal}
 * (architecture.md §4).
 *
 * BOUNDARY (binding): scoring is performed ONLY by the afi-core scorer. This
 * module NEVER reimplements, re-weights, or "adjusts" any scoring/UWR math. It
 * carries the afi-core `analystScore` through VERBATIM and surfaces its
 * `uwrScore`/`uwrAxes` at the top level for convenience.
 *
 * Determinism: the only timestamp on the output (`scoredAt`) comes from
 * `ctx.clock()` and is EXCLUDED from every content hash (see canonicalHash.ts).
 * Identical bundle -> identical `uwrScore`/`uwrAxes` (deterministic kernel).
 *
 * Runtime note (from m1-normalize-bundle handoff): Jest's resolver CANNOT load
 * the afi-core `./analysts/*` VALUE subpath (its export key declares only
 * `import`/`types`, no `require`/`default`). TYPE-only imports are erased and
 * work fine. The real scorer is therefore bound via a DYNAMIC import inside
 * {@link froggyScorer}, so this module LOADS under Jest (the dynamic import is
 * only evaluated when invoked under `node --loader ts-node/esm`, the same
 * resolution path as the CLI). Jest tests inject a stub scorer and assert on
 * the projection/shape/labels; the real-scorer runtime assertions live in a
 * ts-node ESM driver.
 *
 * ESM: relative imports use `.js`; the afi-core scorer is referenced by the
 * `afi-core/...` package name (type-only at the top level, dynamic at runtime).
 */

import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import type {
  AnalysisBundle,
  DemoScoredSignal,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "./types.js";

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
 * Project an afi-core `FroggyTrendPullbackScore` into a {@link DemoScoredSignal}.
 * The embedded `analystScore` is carried through VERBATIM; `uwrScore`/`uwrAxes`
 * are surfaced from it (never recomputed). `scoredAt` is the injected clock
 * value and is excluded from every content hash.
 */
export function buildDemoScoredSignal(
  scoreResult: FroggyTrendPullbackScore,
  signalId: string,
  scoredAt: string
): DemoScoredSignal {
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
    provisional: true,
    demoOnly: true,
    scoredAt,
  };
}

/**
 * Build a scoring pipehead bound to the given scorer. `execute(bundle, ctx)`
 * feeds `bundle.enrichedView` to the scorer and projects the result into a
 * `DemoScoredSignal`. Pure given `(bundle, ctx, scorer)`; the only timestamps
 * come from `ctx.clock()` and never affect any content hash.
 */
export function createScoringPipehead(
  scorer: FroggyScorer = froggyScorer
): Pipehead<AnalysisBundle, DemoScoredSignal> {
  return {
    id: SCORING_PIPEHEAD_ID,
    kind: "scoring",
    async execute(
      bundle: AnalysisBundle,
      ctx: PipeheadContext
    ): Promise<PipeheadExecutionResult<DemoScoredSignal>> {
      const startedAt = ctx.clock();
      const enriched = bundle.enrichedView as FroggyEnrichedView;
      const scoreResult = await scorer(enriched);
      const output = buildDemoScoredSignal(scoreResult, bundle.signalId, ctx.clock());
      const finishedAt = ctx.clock();
      return {
        pipeheadId: SCORING_PIPEHEAD_ID,
        kind: "scoring",
        status: "ok",
        provisional: true,
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
