/**
 * Operational analytics capture — plane rules under test:
 *  - FAIL-OPEN: a throwing store can never reject the capture promise;
 *  - the document is keyed by signalId, idempotent (upsert, $setOnInsert),
 *    and carries the explanation surfaces (meta/analystScore/lenses/rawUss);
 *  - disabled cleanly when no URI/factory is configured.
 * The store is expressly NON-NORMATIVE (MONGO-GOV D-MONGO-4); nothing here
 * touches evidence code.
 */
import { describe, it, expect, afterEach, jest } from "@jest/globals";
import {
  captureScoringContext,
  __setAnalyticsCollectionForTests,
} from "../../src/analytics/scoringContextStore.js";
import type { ReactorScoredSignalV1 } from "../../src/types/ReactorScoredSignalV1.js";

function scored(): ReactorScoredSignalV1 {
  return {
    signalId: "sig-analytics-1",
    scoredAt: "2026-08-01T00:00:00.000Z",
    analystScore: { uwrScore: 0.5, uwrAxes: { structure: 0.4, execution: 0.6, risk: 0.9, insight: 0.4 } },
    decayParams: null,
    meta: { symbol: "BTC/USDT.P", timeframe: "5m", strategy: "trend_pullback_v1", direction: "long", source: "test" },
    rawUss: { facts: { direction: "long" } },
    lenses: [{ type: "technical", version: "v1", payload: { atr14: 42 } }],
  } as unknown as ReactorScoredSignalV1;
}

afterEach(() => {
  __setAnalyticsCollectionForTests(null);
});

describe("operational scoring-context capture", () => {
  it("writes an idempotent, signalId-keyed document carrying the explanation surfaces", async () => {
    const updates: Array<{ filter: unknown; update: unknown; options: unknown }> = [];
    __setAnalyticsCollectionForTests(async () =>
      ({
        updateOne: async (filter: unknown, update: unknown, options: unknown) => {
          updates.push({ filter, update, options });
          return { acknowledged: true };
        },
      }) as never
    );

    await captureScoringContext(scored(), { outcome: "inserted" }, "tradingview-webhook");

    expect(updates).toHaveLength(1);
    expect(updates[0].filter).toEqual({ signalId: "sig-analytics-1" });
    expect(updates[0].options).toEqual({ upsert: true });
    const doc = (updates[0].update as { $setOnInsert: Record<string, unknown> }).$setOnInsert;
    expect(doc.schema).toBe("afi.operational.scoring-context.v0");
    expect(doc.plane).toBe("operational");
    expect(doc.route).toBe("tradingview-webhook");
    expect(doc.persistenceOutcome).toEqual({ outcome: "inserted" });
    expect(doc.meta).toMatchObject({ direction: "long", symbol: "BTC/USDT.P" });
    expect(doc.analystScore).toBeDefined();
    expect(doc.lenses).toBeDefined();
    expect(doc.rawUss).toBeDefined();
    expect(typeof doc.capturedAt).toBe("string");
  });

  it("FAIL-OPEN: a throwing store resolves (never rejects) and logs a warning", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    __setAnalyticsCollectionForTests(async () =>
      ({
        updateOne: async () => {
          throw new Error("atlas down");
        },
      }) as never
    );

    await expect(captureScoringContext(scored(), { outcome: "inserted" }, "cpj")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[analytics] scoring-context capture failed (ignored)",
      expect.objectContaining({ signalId: "sig-analytics-1", error: "atlas down" })
    );
    warn.mockRestore();
  });

  it("is a no-op when neither a URI nor a test factory is configured", async () => {
    const prev = process.env.AFI_EVIDENCE_MONGODB_URI;
    delete process.env.AFI_EVIDENCE_MONGODB_URI;
    try {
      await expect(captureScoringContext(scored(), {}, "markittick")).resolves.toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.AFI_EVIDENCE_MONGODB_URI = prev;
    }
  });
});
