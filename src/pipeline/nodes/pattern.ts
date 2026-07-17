/**
 * afi-analysis-pattern@1.0.0 — pattern-recognition category node.
 *
 * Wraps the EXISTING production kernels (W3 spec section 5): detectPatterns
 * over the candles delivered from the technical node's 'candles' output port
 * (manifest edge fromPort), plus computePatternRegimeSummary with the same
 * FAIL-SOFT posture the live froggy-enrichment-tech-pattern plugin has today
 * (a regime failure logs and continues without regime — never fails the
 * node).
 *
 * Output shape (category-marked): { category: 'pattern', pattern }
 */
import { detectPatterns } from "../../enrichment/patternRecognition.js";
import { computePatternRegimeSummary } from "../../indicator/patternRegimeProfile.js";
import type { AfiCandle } from "../../types/AfiCandle.js";
import type { PatternLensV1 } from "../../types/UssLenses.js";
import {
  ok,
  type AnalysisNodePlugin,
  type NodeRunContext,
  type NodeResult,
} from "../nodeSdk.js";

export interface PatternNodeOutput {
  category: "pattern";
  pattern: PatternLensV1["payload"] | undefined;
}

export interface PatternNodeDeps {
  detect: typeof detectPatterns;
  computeRegime: typeof computePatternRegimeSummary;
}

const PRODUCTION_DEPS: PatternNodeDeps = {
  detect: detectPatterns,
  computeRegime: computePatternRegimeSummary,
};

function isCandleArray(input: unknown): input is AfiCandle[] {
  return (
    Array.isArray(input) &&
    input.every(
      (c) =>
        c !== null &&
        typeof c === "object" &&
        typeof (c as AfiCandle).close === "number" &&
        typeof (c as AfiCandle).open === "number"
    )
  );
}

export function createPatternNode(deps: PatternNodeDeps = PRODUCTION_DEPS): AnalysisNodePlugin {
  return {
    manifestRef: { pluginId: "afi-analysis-pattern", pluginVersion: "1.0.0" },
    async run(input: unknown, ctx: NodeRunContext): Promise<NodeResult> {
      if (!isCandleArray(input)) {
        throw new Error(
          "pattern node requires an OHLCV candle array (the technical node's 'candles' output port)"
        );
      }

      const pattern = deps.detect(input) ?? undefined;

      // Regime context is fail-soft exactly as today: a failure logs and the
      // pattern payload ships without regime (recorded as a degradation, not
      // a node failure).
      let regimeDegraded = false;
      if (pattern) {
        const symbol = ctx.signal.facts?.symbol ?? "";
        const timeframe = ctx.signal.facts?.timeframe ?? "";
        const regime = await deps.computeRegime(symbol, timeframe).catch((err: Error) => {
          ctx.logger.warn("pattern regime computation failed (fail-soft)", {
            error: err.message,
          });
          regimeDegraded = true;
          return null;
        });
        if (regime) {
          pattern.regime = regime;
        }
      }

      const output: PatternNodeOutput = { category: "pattern", pattern };
      return ok(
        output,
        regimeDegraded
          ? [{ class: "regime-unavailable", detail: "pattern regime summary failed; pattern shipped without regime" }]
          : []
      );
    },
  };
}

export const patternNode: AnalysisNodePlugin = createPatternNode();
