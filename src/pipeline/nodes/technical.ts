/**
 * afi-analysis-technical@1.0.0 — technical-analysis category node.
 *
 * Wraps the EXISTING production kernels (W3 spec section 5): fetches OHLCV
 * candles through the price-feed registry (the same
 * getPriceFeedAdapter/getDefaultPriceSource path the live froggy plugins
 * use) and computes the technical lens with computeTechnicalEnrichment.
 * NO math is reimplemented here.
 *
 * Output shape (category-marked):
 *   { category: 'technical', technical, candles, priceSource }
 * 'candles' is the named output port the pattern node consumes via the
 * manifest edge fromPort 'candles'.
 *
 * Failure semantics:
 *  - AFI_PRICE_FEED_SOURCE unset →
 *    NodeConfigurationError (ALWAYS fatal — D-FCP-8 honest failure).
 *  - Provider/data errors (fetch failure, empty candles) throw ordinary
 *    errors: the executor applies the node's declared failurePolicy.
 */
import type {
  getPriceFeedAdapter,
  getDefaultPriceSource,
} from "../../adapters/exchanges/priceFeedRegistry.js";
import type { OHLCVCandle } from "../../adapters/exchanges/types.js";
import type { computeTechnicalEnrichment } from "../../enrichment/technicalIndicators.js";
import type { AfiCandle } from "../../types/AfiCandle.js";
import type { TechnicalLensV1 } from "../../types/UssLenses.js";
import {
  NodeConfigurationError,
  ok,
  type AnalysisNodePlugin,
  type NodeRunContext,
  type NodeResult,
} from "../nodeSdk.js";

export interface TechnicalNodeOutput {
  category: "technical";
  technical: TechnicalLensV1["payload"] | undefined;
  /** Named output port consumed by the pattern node (fromPort 'candles'). */
  candles: AfiCandle[];
  priceSource: string;
}

export interface TechnicalNodeDeps {
  resolvePriceSource: typeof getDefaultPriceSource;
  getAdapter: typeof getPriceFeedAdapter;
  computeTechnical: typeof computeTechnicalEnrichment;
}

/**
 * Load the real ccxt-backed kernels only when the production node runs. This
 * DEFERS the exchange-SDK import (behaviour-neutral) so the node is testable
 * with injected deterministic deps without pulling ccxt at module load.
 */
async function loadProductionDeps(): Promise<TechnicalNodeDeps> {
  const [{ getPriceFeedAdapter, getDefaultPriceSource }, { computeTechnicalEnrichment }] = await Promise.all([
    import("../../adapters/exchanges/priceFeedRegistry.js"),
    import("../../enrichment/technicalIndicators.js"),
  ]);
  return {
    resolvePriceSource: getDefaultPriceSource,
    getAdapter: getPriceFeedAdapter,
    computeTechnical: computeTechnicalEnrichment,
  };
}

function toAfiCandles(candles: OHLCVCandle[]): AfiCandle[] {
  return candles.map((c) => ({
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

export function createTechnicalNode(deps?: TechnicalNodeDeps): AnalysisNodePlugin {
  return {
    manifestRef: { pluginId: "afi-analysis-technical", pluginVersion: "1.0.0" },
    async run(_input: unknown, ctx: NodeRunContext): Promise<NodeResult> {
      const d = deps ?? (await loadProductionDeps());
      let priceSource: string;
      try {
        priceSource = d.resolvePriceSource();
      } catch (error) {
        // Missing REQUIRED price-feed configuration: honest, fatal failure.
        throw new NodeConfigurationError(
          error instanceof Error ? error.message : String(error)
        );
      }

      const symbol = ctx.signal.facts?.symbol;
      const timeframe = ctx.signal.facts?.timeframe;
      if (typeof symbol !== "string" || typeof timeframe !== "string") {
        throw new Error(
          "technical node requires facts.symbol and facts.timeframe on the canonical signal"
        );
      }

      const limitRaw = ctx.config["candleLimit"];
      const limit = typeof limitRaw === "number" ? limitRaw : 100;

      const adapter = d.getAdapter(priceSource as Parameters<typeof getPriceFeedAdapter>[0]);
      const rawCandles = await adapter.getOHLCV({ symbol, timeframe, limit });
      const candles = toAfiCandles(rawCandles);

      const technical = d.computeTechnical(candles);
      ctx.logger.info("technical enrichment computed", {
        priceSource,
        symbol,
        candles: candles.length,
      });

      const output: TechnicalNodeOutput = {
        category: "technical",
        technical: technical ?? undefined,
        candles,
        priceSource,
      };
      return ok(output);
    },
  };
}

export const technicalNode: AnalysisNodePlugin = createTechnicalNode();
