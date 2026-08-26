/**
 * DEM-PRODUCER-PLAN — the technical lane as the plan producer, through the
 * real adapter with injected deterministic kernels:
 *   - the verified plan facts ride `technical.plan` (a provider fact);
 *   - ROLE SPLIT (analyst/provider): the facts are a function of the submitted
 *     plan and the fetched candles ONLY — analyst config and mapping cannot
 *     move them;
 *   - DIR-GOV D-DIR-3: the submitted side (facts.direction) cannot move them;
 *   - no plan → no block (declared absence); an unverifiable plan REFUSES the
 *     lane with a TradePlanVerificationError (pipeline abort, no record);
 *   - the demo envelope actually contains every committed CPJ fixture plan
 *     (so the oracle harness cannot drift into refusal silently).
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTechnicalLocalAdapter } from "../../src/providers/adapters/technicalLocalAdapter.js";
import { computeTechnicalEnrichment } from "../../src/enrichment/technicalIndicators.js";
import { TradePlanVerificationError, verifyTradePlan } from "../../src/enrichment/tradePlanVerification.js";
import { SILENT_NODE_LOGGER } from "../../src/pipeline/nodeSdk.js";
import type { ProviderAdapterContext } from "../../src/providers/types.js";
import type { PriceFeedAdapter } from "../../src/adapters/exchanges/types.js";
import { demoPriceFeedAdapter } from "../support/deterministicPriceFeedAdapter.js";
import { mapCpjToUssV11 } from "../../src/uss/cpjMapper.js";
import type { CpjV01Payload } from "../../src/cpj/cpjValidator.js";
import type { AfiCandle } from "../../src/types/AfiCandle.js";

function adapter() {
  return createTechnicalLocalAdapter({
    resolvePriceSource: () => "demo",
    getAdapter: () => demoPriceFeedAdapter as unknown as PriceFeedAdapter,
    computeTechnical: computeTechnicalEnrichment,
  });
}

function ctx(signal: Record<string, unknown>, config: Record<string, unknown> = { candleLimit: 100 }): ProviderAdapterContext {
  return {
    signal: signal as ProviderAdapterContext["signal"],
    input: undefined,
    config,
    logger: SILENT_NODE_LOGGER,
    abort: new AbortController().signal,
    credential: undefined,
  } as unknown as ProviderAdapterContext;
}

async function demoWindow(symbol: string, timeframe: string, limit = 100): Promise<AfiCandle[]> {
  return (await demoPriceFeedAdapter.getOHLCV({ symbol, timeframe, limit })).map((c) => ({
    timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
  }));
}

function signal(direction: "long" | "short" | "neutral", plan?: Record<string, unknown>) {
  return {
    schema: "afi.usignal.v1.1",
    provenance: { source: "test", providerId: "plan-producer-test", signalId: "sig-plan-producer" },
    facts: { symbol: "BTC/USDT", market: "perp", timeframe: "4h", strategy: "trend_pullback_v1", direction },
    ...(plan ? { plan } : {}),
  };
}

const PLAN = {
  schema: "afi.trade-plan.v1",
  signalId: "sig-plan-producer",
  levels: { entry: "50000", stopLoss: "49300", takeProfits: [{ price: "51000" }] },
};

describe("technical lane — the plan producer", () => {
  it("emits technical.plan (verified facts) when the signal carries a plan; no block when it does not", async () => {
    const withPlan = (await adapter().run(ctx(signal("long", PLAN)))) as unknown as { technical: { plan?: unknown } };
    expect(withPlan.technical.plan).toEqual({
      entryLow: 50000,
      entryHigh: 50000,
      entryPrice: 50000,
      stopPrice: 49300,
      firstTargetPrice: 51000,
      targetCount: 1,
      rrToFirstTarget: 1.4286,
      envelopeLow: expect.any(Number),
      envelopeHigh: expect.any(Number),
      barCount: 100,
    });
    const without = (await adapter().run(ctx(signal("long")))) as unknown as { technical: { plan?: unknown } };
    expect("plan" in without.technical).toBe(false);
  });

  it("DIR-GOV D-DIR-3: the submitted side cannot move the plan facts (long/short/neutral → byte-identical technical payload)", async () => {
    const outputs = await Promise.all(
      (["long", "short", "neutral"] as const).map(async (d) => JSON.stringify((await adapter().run(ctx(signal(d, PLAN)))) as object))
    );
    expect(outputs[1]).toBe(outputs[0]);
    expect(outputs[2]).toBe(outputs[0]);
  });

  it("ROLE SPLIT: analyst-side inputs (node config beyond the fetch, mapping content) cannot move the provider fact", async () => {
    const a = (await adapter().run(ctx(signal("long", PLAN), { candleLimit: 100 }))) as unknown as { technical: { plan: unknown } };
    const b = (await adapter().run(ctx(signal("long", PLAN), { candleLimit: 100, timeoutMs: 10000 }))) as unknown as { technical: { plan: unknown } };
    expect(b.technical.plan).toEqual(a.technical.plan);
    // The facts equal the pure law applied to (plan, fetched candles) and nothing else.
    const window = await demoWindow("BTC/USDT", "4h");
    expect(a.technical.plan).toEqual(verifyTradePlan(PLAN as never, window));
  });

  it("an unverifiable plan REFUSES the lane (TradePlanVerificationError — no retry, no record)", async () => {
    const offMarket = { ...PLAN, levels: { entry: "42500", stopLoss: "41800", takeProfits: [{ price: "43500" }] } };
    await expect(adapter().run(ctx(signal("long", offMarket)))).rejects.toBeInstanceOf(TradePlanVerificationError);
  });

  it("a plan on a window below the kernel floor refuses (no computable window to verify against)", async () => {
    await expect(adapter().run(ctx(signal("long", PLAN), { candleLimit: 40 }))).rejects.toThrow(/kernel floor/);
  });
});

describe("oracle corpus discipline — the demo envelope contains every committed CPJ fixture plan", () => {
  const FIXTURES = ["cpj-blofin-perp-long.json", "cpj-coinbase-spot-sell.json", "cpj-blofin-perp-neutral.json"];
  for (const file of FIXTURES) {
    it(`${file}: the carried plan (if any) verifies against the fixture's demo window`, async () => {
      const cpj = JSON.parse(readFileSync(path.resolve(process.cwd(), "test/oracle/fixtures/cpj", file), "utf-8")) as CpjV01Payload;
      const mapped = mapCpjToUssV11(cpj, { strategyId: "trend_pullback_v1" });
      expect(mapped.success).toBe(true);
      const uss = mapped.uss!;
      if (!uss.plan) return; // no plan submitted — nothing to verify
      const window = await demoWindow(uss.facts!.symbol!, uss.facts!.timeframe!);
      expect(() => verifyTradePlan(uss.plan!, window)).not.toThrow();
    });
  }
});
