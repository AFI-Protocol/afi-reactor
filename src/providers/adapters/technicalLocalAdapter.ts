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
import { TradePlanVerificationError, verifyTradePlan } from "../../enrichment/tradePlanVerification.js";
import type { TradePlanV1 } from "../../types/TradePlan.js";
import type { TechnicalLensV1 } from "../../types/UssLenses.js";

/** The registered higher-timeframe selection, or undefined when unregistered. */
interface HtfSelection {
  dailyTimeframe: string;
  weeklyTimeframe: string;
  htfCandleLimit: number;
}

function readHtfConfig(raw: unknown): HtfSelection | undefined {
  if (raw === undefined || raw === null) return undefined;
  const cfg = raw as Record<string, unknown>;
  const daily = cfg["dailyTimeframe"];
  const weekly = cfg["weeklyTimeframe"];
  if (typeof daily !== "string" || typeof weekly !== "string") {
    // Boot validation against the plugin's closed paramsSchema makes this
    // unreachable in a composed pipeline; fail closed rather than guess.
    throw new NodeConfigurationError(
      "technical adapter: params.htf must declare dailyTimeframe and weeklyTimeframe (DEM-PRODUCER-HTF)"
    );
  }
  const limit = cfg["htfCandleLimit"];
  return {
    dailyTimeframe: daily,
    weeklyTimeframe: weekly,
    htfCandleLimit: typeof limit === "number" ? limit : 100,
  };
}

/**
 * The higher-timeframe bias fact: the SAME EMA20/EMA50 trend law the lane
 * already applies to the signal's own window, run over a higher-timeframe
 * window. Returns undefined when the window cannot be computed (below the
 * 50-candle kernel floor) — a declared producer absence, never a guess.
 */
function htfBias(
  computeTechnical: TechnicalLocalAdapterDeps["computeTechnical"],
  raw: OHLCVCandle[] | undefined,
  timeframe: string
): { timeframe: string; trendBias: "bullish" | "bearish" | "range"; ema20: number; ema50: number; barCount: number } | undefined {
  if (!raw || raw.length === 0) return undefined;
  const candles = toAfiCandles(raw);
  const computed = computeTechnical(candles);
  if (!computed) return undefined;
  return {
    timeframe,
    trendBias: computed.trendBias,
    ema20: computed.ema20,
    ema50: computed.ema50,
    barCount: candles.length,
  };
}

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
    transportKind: "in-process",
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

      // DEM-PRODUCER-HTF: the higher-timeframe selection is a REGISTERED
      // COMPOSITION VALUE (the analyst config's nodeOverrides.technical.config
      // .htf, validated at boot against the plugin's paramsSchema) — never a
      // code constant, and never derived from a submitted field.
      const htfConfig = readHtfConfig(ctx.config["htf"]);

      const feed = d.getAdapter(priceSource as Parameters<typeof getPriceFeedAdapter>[0]);
      // The signal window and both higher-timeframe windows are fetched
      // CONCURRENTLY: this lane is the pipeline's entry node, so serial
      // round-trips here delay every downstream wave (platform-floor rule).
      // A timeframe the SELECTED VENUE does not offer is a capability fact
      // known before any request: the producer legitimately cannot emit that
      // bias (a declared absence under D-DEM-5(4)(b)), so the window is not
      // requested at all. A fetch that FAILS for a timeframe the venue does
      // offer is a real failure and still aborts the determination — fail
      // closed, never fall back. `supportedTimeframes` absent = unknown, so
      // every timeframe is attempted and nothing is silently skipped.
      const offers = (tf: string): boolean =>
        feed.supportedTimeframes === undefined || feed.supportedTimeframes.includes(tf);
      const fetchHtf = (tf: string): Promise<OHLCVCandle[] | undefined> =>
        htfConfig && offers(tf)
          ? feed.getOHLCV({ symbol, timeframe: tf, limit: htfConfig.htfCandleLimit })
          : Promise.resolve(undefined);
      const [rawCandles, rawDaily, rawWeekly] = await Promise.all([
        feed.getOHLCV({ symbol, timeframe, limit }),
        htfConfig ? fetchHtf(htfConfig.dailyTimeframe) : Promise.resolve(undefined),
        htfConfig ? fetchHtf(htfConfig.weeklyTimeframe) : Promise.resolve(undefined),
      ]);
      const candles = toAfiCandles(rawCandles);
      const technical = d.computeTechnical(candles);

      if (htfConfig && technical) {
        const htf: NonNullable<TechnicalLensV1["payload"]["htf"]> = {};
        if (!offers(htfConfig.dailyTimeframe) || !offers(htfConfig.weeklyTimeframe)) {
          ctx.logger.info("higher-timeframe window not offered by the selected venue (declared absence)", {
            priceSource,
            daily: htfConfig.dailyTimeframe,
            weekly: htfConfig.weeklyTimeframe,
            offered: feed.supportedTimeframes?.join(",") ?? "unknown",
          });
        }
        const daily = htfBias(d.computeTechnical, rawDaily, htfConfig.dailyTimeframe);
        const weekly = htfBias(d.computeTechnical, rawWeekly, htfConfig.weeklyTimeframe);
        // A window below the kernel floor emits NO sub-block — a declared
        // producer absence (D-DEM-5(4)(b)), never a guessed bias.
        if (daily) htf.daily = daily;
        if (weekly) htf.weekly = weekly;
        technical.htf = htf;
      }

      // DEM-PRODUCER-PLAN (D-DEM-5(6)): a submitted trade plan is verified
      // against THIS fetched window by THIS producer before any of its
      // levels becomes a fact; an unverifiable plan refuses the determination
      // (no retry, no score, no record). Reads only uss.plan and the candles —
      // never facts.direction (DIR-GOV D-DIR-3) and never analyst config.
      const plan = (ctx.signal as { plan?: unknown }).plan;
      if (plan !== undefined && plan !== null) {
        if (!technical) {
          throw new TradePlanVerificationError(
            `no computable indicator window (${candles.length} candles fetched, kernel floor not met)`
          );
        }
        technical.plan = verifyTradePlan(plan as TradePlanV1, candles);
      }

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
