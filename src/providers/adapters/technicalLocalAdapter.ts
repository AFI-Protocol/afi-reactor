/**
 * afi-adapter-technical-local@1.0.0 — the KEYLESS technical reference adapter
 * (PBF-GOV §7.7).
 *
 * Reuses the EXACT production kernels (computeTechnicalEnrichment over
 * getPriceFeedAdapter/getDefaultPriceSource) behind the provider-adapter
 * interface — NO math is reimplemented and NO scoring behaviour changes. It
 * requires no credential; ctx.credential is undefined and the SecretResolver is
 * never invoked for it.
 *
 * The ccxt-backed price-feed kernels are imported LAZILY (dynamic import at call
 * time), so merely importing this module — or the provider index — never pulls
 * the exchange SDK into a test that injects deterministic deps.
 */
import type { getPriceFeedAdapter, getDefaultPriceSource } from "../../adapters/exchanges/priceFeedRegistry.js";
import type { OHLCVCandle } from "../../adapters/exchanges/types.js";
import type { computeTechnicalEnrichment } from "../../enrichment/technicalIndicators.js";
import type { AfiCandle } from "../../types/AfiCandle.js";
import { NodeConfigurationError } from "../../pipeline/nodeSdk.js";
import type { CategoryResult, ProviderAdapter, ProviderAdapterContext } from "../types.js";

export interface TechnicalLocalAdapterDeps {
  resolvePriceSource: typeof getDefaultPriceSource;
  getAdapter: typeof getPriceFeedAdapter;
  computeTechnical: typeof computeTechnicalEnrichment;
}

/** Load the real ccxt-backed kernels only when the production adapter runs. */
async function loadProductionDeps(): Promise<TechnicalLocalAdapterDeps> {
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

export function createTechnicalLocalAdapter(deps?: TechnicalLocalAdapterDeps): ProviderAdapter {
  return {
    adapterId: "afi-adapter-technical-local",
    adapterVersion: "1.0.0",
    category: "technical",
    providerCompatibility: ["afi-provider-technical-local"],
    requiresCredential: false,
    async run(ctx: ProviderAdapterContext): Promise<CategoryResult> {
      const d = deps ?? (await loadProductionDeps());
      let priceSource: string;
      try {
        priceSource = d.resolvePriceSource();
      } catch (error) {
        throw new NodeConfigurationError(error instanceof Error ? error.message : String(error));
      }
      const symbol = ctx.signal.facts?.symbol;
      const timeframe = ctx.signal.facts?.timeframe;
      if (typeof symbol !== "string" || typeof timeframe !== "string") {
        throw new Error(
          "technical adapter requires facts.symbol and facts.timeframe on the canonical signal"
        );
      }
      const limitRaw = ctx.config["candleLimit"];
      const limit = typeof limitRaw === "number" ? limitRaw : 100;

      const feed = d.getAdapter(priceSource as Parameters<typeof getPriceFeedAdapter>[0]);
      const rawCandles = await feed.getOHLCV({ symbol, timeframe, limit });
      const candles = toAfiCandles(rawCandles);
      const technical = d.computeTechnical(candles);

      ctx.logger.info("technical enrichment computed (provider adapter)", {
        priceSource,
        symbol,
        candles: candles.length,
      });

      const output: CategoryResult = { category: "technical", candles, priceSource };
      if (technical) output.technical = technical;
      return output;
    },
  };
}

/** Production singleton (lazy kernels; ccxt loaded only on first run()). */
export const technicalLocalAdapter: ProviderAdapter = createTechnicalLocalAdapter();
