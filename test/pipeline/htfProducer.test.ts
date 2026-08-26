/**
 * DEM-PRODUCER-HTF — the technical lane's higher-timeframe bias producer, and
 * the DIR-GOV D-DIR-3 negative test the accepted gate requires:
 *
 *   "DIR-GOV D-DIR-3 honored — no submitted or declared trade direction
 *    reaches any bias or axis input, proven by a dedicated negative test"
 *
 * plus: timeframe selection comes from the REGISTERED COMPOSITION VALUE (the
 * analyst config's nodeOverrides, handed down as ctx.config), never a code
 * constant; the windows are fetched concurrently; a window below the kernel
 * floor is a declared absence, never a guessed bias.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTechnicalLocalAdapter } from "../../src/providers/adapters/technicalLocalAdapter.js";
import { computeTechnicalEnrichment } from "../../src/enrichment/technicalIndicators.js";
import { SILENT_NODE_LOGGER } from "../../src/pipeline/nodeSdk.js";
import type { ProviderAdapterContext } from "../../src/providers/types.js";
import type { PriceFeedAdapter } from "../../src/adapters/exchanges/types.js";
import type { OHLCVCandle } from "../../src/adapters/exchanges/types.js";
import { demoPriceFeedAdapter } from "../support/deterministicPriceFeedAdapter.js";

const HTF = { dailyTimeframe: "1d", weeklyTimeframe: "1w", htfCandleLimit: 100 };

/** The registered composition value, as the fixture analyst config carries it. */
const FIXTURE_CONFIG = path.resolve(
  process.cwd(),
  "test/pipeline/fixtures/afi-config/registries/analyst-strategies/froggy--trend_pullback_v1--1.0.0.config.json"
);

function adapter(feed: PriceFeedAdapter = demoPriceFeedAdapter as unknown as PriceFeedAdapter) {
  return createTechnicalLocalAdapter({
    resolvePriceSource: () => "demo",
    getAdapter: () => feed,
    computeTechnical: computeTechnicalEnrichment,
  });
}

function ctx(signal: Record<string, unknown>, config: Record<string, unknown>): ProviderAdapterContext {
  return {
    signal: signal as ProviderAdapterContext["signal"],
    input: undefined,
    config,
    logger: SILENT_NODE_LOGGER,
    abort: new AbortController().signal,
    credential: undefined,
  } as unknown as ProviderAdapterContext;
}

function signal(symbol: string, direction: "long" | "short" | "neutral", timeframe = "4h") {
  return {
    schema: "afi.usignal.v1.1",
    provenance: { source: "test", providerId: "htf-test", signalId: "sig-htf" },
    facts: { symbol, market: "perp", timeframe, strategy: "trend_pullback_v1", direction },
  };
}

type Htf = { daily?: { trendBias: string; timeframe: string; barCount: number }; weekly?: { trendBias: string; timeframe: string } };
async function run(sym: string, dir: "long" | "short" | "neutral", config: Record<string, unknown> = { candleLimit: 100, htf: HTF }) {
  return (await adapter().run(ctx(signal(sym, dir), config))) as unknown as {
    technical: { htf?: Htf; trendBias: string };
  };
}

describe("DEM-PRODUCER-HTF — the higher-timeframe bias producer", () => {
  it("emits htf.{daily,weekly} from separately fetched windows when the composition registers them", async () => {
    const out = await run("BTC/USDT", "long");
    expect(out.technical.htf).toBeDefined();
    expect(out.technical.htf!.daily).toMatchObject({ timeframe: "1d", trendBias: "bullish", barCount: 100 });
    expect(out.technical.htf!.weekly).toMatchObject({ timeframe: "1w", trendBias: "bullish" });
  });

  it("emits NO htf block when the composition registers none (every pre-HTF configuration stays valid)", async () => {
    const out = await run("BTC/USDT", "long", { candleLimit: 100 });
    expect(out.technical.htf).toBeUndefined();
  });

  it("the two timeframes come from the REGISTERED value, not a code constant: changing them changes the windows fetched", async () => {
    const seen: Array<{ timeframe: string; limit?: number }> = [];
    const spy: PriceFeedAdapter = {
      ...(demoPriceFeedAdapter as unknown as PriceFeedAdapter),
      async getOHLCV(params: { symbol: string; timeframe: string; limit?: number }): Promise<OHLCVCandle[]> {
        seen.push({ timeframe: params.timeframe, limit: params.limit });
        return demoPriceFeedAdapter.getOHLCV(params);
      },
    };
    await adapter(spy).run(ctx(signal("BTC/USDT", "long"), { candleLimit: 100, htf: HTF }));
    expect(seen.map((s) => s.timeframe).sort()).toEqual(["1d", "1w", "4h"]);
    expect(seen.find((s) => s.timeframe === "1d")!.limit).toBe(100);
    // And the registered value the FIXTURE config carries is exactly this one.
    const registered = JSON.parse(readFileSync(FIXTURE_CONFIG, "utf-8")) as {
      nodeOverrides?: { technical?: { config?: { htf?: unknown } } };
    };
    expect(registered.nodeOverrides!.technical!.config!.htf).toEqual(HTF);
  });

  it("fetches the three windows CONCURRENTLY (the lane is the pipeline's entry node)", async () => {
    let inFlight = 0;
    let peak = 0;
    const slow: PriceFeedAdapter = {
      ...(demoPriceFeedAdapter as unknown as PriceFeedAdapter),
      async getOHLCV(params: { symbol: string; timeframe: string; limit?: number }): Promise<OHLCVCandle[]> {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return demoPriceFeedAdapter.getOHLCV(params);
      },
    };
    await adapter(slow).run(ctx(signal("BTC/USDT", "long"), { candleLimit: 100, htf: HTF }));
    expect(peak).toBe(3);
  });

  it("a window below the kernel floor emits NO sub-block (declared absence, never a guessed bias)", async () => {
    const out = await run("BTC/USDT", "long", { candleLimit: 100, htf: { ...HTF, htfCandleLimit: 51 } });
    // 51 candles clears the 50-bar floor…
    expect(out.technical.htf!.daily).toBeDefined();
    const thin = (await adapter().run(
      ctx(signal("BTC/USDT", "long"), { candleLimit: 100, htf: { ...HTF, htfCandleLimit: 40 } })
    )) as unknown as { technical: { htf?: Htf } };
    // …40 does not: the block is emitted with no sub-blocks at all.
    expect(thin.technical.htf).toEqual({});
  });

  it("refuses a malformed registered htf value rather than guessing (fail-closed)", async () => {
    await expect(
      adapter().run(ctx(signal("BTC/USDT", "long"), { candleLimit: 100, htf: { dailyTimeframe: "1d" } }))
    ).rejects.toThrow(/must declare dailyTimeframe and weeklyTimeframe/);
  });
});

describe("DIR-GOV D-DIR-3 — no submitted or declared direction reaches any bias or axis input", () => {
  it("NEGATIVE TEST: varying facts.direction over long/short/neutral leaves the ENTIRE technical payload byte-identical", async () => {
    const [long, short, neutral] = await Promise.all(
      (["long", "short", "neutral"] as const).map(async (d) => JSON.stringify(await run("BTC/USDT", d)))
    );
    expect(short).toBe(long);
    expect(neutral).toBe(long);
  });

  it("NEGATIVE TEST: the bias facts are a function of the fetched windows alone — same symbol, opposite submitted sides, identical htf", async () => {
    const up = await run("BTC/USDT", "short"); // submitted SHORT on a symbol whose HTF windows trend UP
    expect(up.technical.htf!.daily!.trendBias).toBe("bullish");
    expect(up.technical.htf!.weekly!.trendBias).toBe("bullish");
    const down = await run("ETH/USD", "long"); // submitted LONG on a symbol whose weekly window trends DOWN
    expect(down.technical.htf!.weekly!.trendBias).toBe("bearish");
    expect(down.technical.htf!.daily!.trendBias).toBe("bullish");
  });

  it("SOURCE SCAN: no producer or projection file reads the signal's direction", () => {
    const files = [
      "src/enrichment/technicalIndicators.ts",
      "src/enrichment/candleStructure.ts",
      "src/enrichment/tradePlanVerification.ts",
      "src/providers/adapters/technicalLocalAdapter.ts",
      "src/pipeline/nodes/laneView.ts",
      "src/pipeline/nodes/mergeEnrichedView.ts",
      "src/pipeline/nodes/scorerFroggyTrendPullback.ts",
    ];
    // The submitted side lives at facts.direction on the canonical signal and
    // is read ONLY by the record-stamping seam (graphScoringService), never by
    // a producer, a projection, or the scorer node.
    // Comments naming the rule are not reads: strip block and line comments
    // before scanning, so the guard tests CODE, not prose.
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    const READS_SUBMITTED_DIRECTION =
      /facts\s*[?.]*\.\s*direction|facts\s*[?.]*\s*\[\s*["']direction["']\s*\]|signal\s*[?.]*\.\s*direction/;
    const offenders = files.filter((rel) =>
      READS_SUBMITTED_DIRECTION.test(stripComments(readFileSync(path.resolve(process.cwd(), rel), "utf-8")))
    );
    expect(offenders).toEqual([]);

    // The scan is proven to BITE: the same pattern fires on a real read…
    expect(READS_SUBMITTED_DIRECTION.test(stripComments("const d = ctx.signal.facts.direction;"))).toBe(true);
    expect(READS_SUBMITTED_DIRECTION.test(stripComments('const d = signal.facts?.["direction"];'))).toBe(true);
    // …and NOT on a comment that merely names it.
    expect(READS_SUBMITTED_DIRECTION.test(stripComments("// never facts.direction (DIR-GOV D-DIR-3)"))).toBe(false);
    // The lawful reader — the record-stamping seam — is outside the scanned set.
    const stamp = readFileSync(path.resolve(process.cwd(), "src/services/graphScoringService.ts"), "utf-8");
    expect(READS_SUBMITTED_DIRECTION.test(stripComments(stamp))).toBe(true);
  });
});

describe("DEM-PRODUCER-HTF — a venue that does not offer the window (the capability case)", () => {
  /** A feed that advertises no weekly bar — exactly ccxt's coinbase table. */
  function noWeeklyFeed(seen: string[]): PriceFeedAdapter {
    return {
      ...(demoPriceFeedAdapter as unknown as PriceFeedAdapter),
      supportedTimeframes: ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "1d"],
      async getOHLCV(params: { symbol: string; timeframe: string; limit?: number }): Promise<OHLCVCandle[]> {
        seen.push(params.timeframe);
        return demoPriceFeedAdapter.getOHLCV(params);
      },
    };
  }

  it("does not REQUEST a window the venue does not offer, and emits that sub-block as a DECLARED ABSENCE", async () => {
    const seen: string[] = [];
    const out = (await adapter(noWeeklyFeed(seen)).run(
      ctx(signal("BTC/USDT", "long"), { candleLimit: 100, htf: HTF })
    )) as unknown as { technical: { htf?: Htf } };
    // The weekly window is never requested — a capability fact, known up front.
    expect(seen.sort()).toEqual(["1d", "4h"]);
    // The daily bias is still produced; the weekly one is absent, and the
    // registered mapping's `absent` member recodes it to neutral (recorded).
    expect(out.technical.htf!.daily).toMatchObject({ timeframe: "1d" });
    expect(out.technical.htf!.weekly).toBeUndefined();
  });

  it("a FETCH FAILURE on a timeframe the venue DOES offer still refuses (fail closed, never fall back)", async () => {
    const failing: PriceFeedAdapter = {
      ...(demoPriceFeedAdapter as unknown as PriceFeedAdapter),
      supportedTimeframes: ["4h", "1d", "1w"],
      async getOHLCV(params: { symbol: string; timeframe: string; limit?: number }): Promise<OHLCVCandle[]> {
        if (params.timeframe === "1w") throw new Error("upstream 500 from the venue");
        return demoPriceFeedAdapter.getOHLCV(params);
      },
    };
    await expect(
      adapter(failing).run(ctx(signal("BTC/USDT", "long"), { candleLimit: 100, htf: HTF }))
    ).rejects.toThrow(/upstream 500/);
  });

  it("a feed that advertises NO capability table is treated as offering everything (nothing silently skipped)", async () => {
    const seen: string[] = [];
    const unknown: PriceFeedAdapter = {
      ...(demoPriceFeedAdapter as unknown as PriceFeedAdapter),
      supportedTimeframes: undefined,
      async getOHLCV(params: { symbol: string; timeframe: string; limit?: number }): Promise<OHLCVCandle[]> {
        seen.push(params.timeframe);
        return demoPriceFeedAdapter.getOHLCV(params);
      },
    };
    const out = (await adapter(unknown).run(
      ctx(signal("BTC/USDT", "long"), { candleLimit: 100, htf: HTF })
    )) as unknown as { technical: { htf?: Htf } };
    expect(seen.sort()).toEqual(["1d", "1w", "4h"]);
    expect(out.technical.htf!.weekly).toBeDefined();
  });

  // NOTE: the real venues' capability tables are ccxt's own
  // (`exchange.timeframes`), surfaced by each adapter's `supportedTimeframes`
  // getter. They are not asserted here because importing the ccxt-backed
  // adapters pulls ESM jest cannot parse (the repo idiom is to mock ccxt).
  // Verified directly against ccxt at 2026-08-25: blofin offers 1d AND 1w;
  // coinbase offers 1d and has NO weekly bar — which is exactly why this
  // capability branch exists.
});
