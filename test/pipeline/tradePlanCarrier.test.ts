/**
 * DEM-PRODUCER-PLAN — the ingest carrier: the submitted trade plan survives
 * the CPJ→USS mapping as `uss.plan` (afi.trade-plan.v1, decimal strings) or is
 * refused at ingest; it is never dropped. The TradingView/MarkitTick mappers
 * are untouched (they carry no plan fields).
 */
import { describe, it, expect } from "@jest/globals";
import { buildTradePlanFromCpj, mapCpjToUssV11 } from "../../src/uss/cpjMapper.js";
import { validateUsignalV11 } from "../../src/uss/ussValidator.js";
import { validateTradePlanV1 } from "../../src/evidence/provenance/schemaValidation.js";
import type { CpjV01Payload } from "../../src/cpj/cpjValidator.js";

const STRATEGY = { strategyId: "trend_pullback_v1" };

function cpj(extracted: Partial<CpjV01Payload["extracted"]>): CpjV01Payload {
  return {
    schema: "afi.cpj.v0.1",
    provenance: {
      providerType: "telegram",
      providerId: "carrier-test-channel",
      messageId: "carrier-msg-1",
      postedAt: "2026-01-15T10:00:00Z",
    },
    extracted: { symbolRaw: "BTCUSDT", side: "long", timeframeHint: "4h", venueHint: "blofin", marketTypeHint: "perp", ...extracted },
    parse: { parserId: "carrier-test", parserVersion: "1.0.0", confidence: 0.9 },
  } as CpjV01Payload;
}

describe("cpjMapper — uss.plan carrier", () => {
  it("carries a full plan as afi.trade-plan.v1 with decimal-string prices, contract-valid, USS-valid", () => {
    const r = mapCpjToUssV11(cpj({ entry: 50000, stopLoss: 49300, takeProfits: [{ price: 51000, percentage: 50 }, { price: 52000.5 }], leverageHint: 3 }), STRATEGY);
    expect(r.success).toBe(true);
    const plan = r.uss!.plan!;
    expect(plan).toEqual({
      schema: "afi.trade-plan.v1",
      signalId: r.uss!.provenance.signalId,
      levels: {
        entry: "50000",
        stopLoss: "49300",
        takeProfits: [{ price: "51000", sizePct: "50" }, { price: "52000.5" }],
      },
      leverageHint: "3",
      venueHint: "blofin",
      marketTypeHint: "perp",
    });
    expect(validateTradePlanV1(plan).ok).toBe(true);
    expect(validateUsignalV11(r.uss).ok).toBe(true);
    // facts stays exactly the closed five-key block (USS schema unchanged).
    expect(Object.keys(r.uss!.facts!).sort()).toEqual(["direction", "market", "strategy", "symbol", "timeframe"]);
  });

  it("carries an entry range and a non-integer entry as plain decimal strings (never floats, never exponent notation)", () => {
    const range = mapCpjToUssV11(cpj({ entry: { min: 42500, max: 42800 } }), STRATEGY).uss!.plan!;
    expect(range.levels.entry).toEqual({ min: "42500", max: "42800" });
    const decimal = mapCpjToUssV11(cpj({ symbolRaw: "ETH-USD", entry: 3001.5 }), STRATEGY).uss!.plan!;
    expect(decimal.levels.entry).toBe("3001.5");
    const tiny = buildTradePlanFromCpj(cpj({ entry: 0.0000015 }), "sig")!;
    expect(tiny.levels.entry).toBe("0.0000015");
  });

  it("emits NO plan block when the submission carries no plan field (declared absence)", () => {
    const r = mapCpjToUssV11(cpj({}), STRATEGY);
    expect(r.success).toBe(true);
    expect("plan" in r.uss!).toBe(false);
  });

  it("refuses at ingest: a stop or target without an entry", () => {
    const r = mapCpjToUssV11(cpj({ stopLoss: 49300 }), STRATEGY);
    expect(r.success).toBe(false);
    expect(r.error).toMatchObject({ type: "trade_plan_invalid", reason: expect.stringMatching(/without an entry/) });
  });

  it("refuses at ingest: a negative or non-finite price (contract pattern cannot express it)", () => {
    expect(mapCpjToUssV11(cpj({ entry: -5 }), STRATEGY).error).toMatchObject({ type: "trade_plan_invalid", reason: expect.stringMatching(/negative/) });
    expect(mapCpjToUssV11(cpj({ entry: Number.NaN }), STRATEGY).error).toMatchObject({ type: "trade_plan_invalid" });
  });

  it("the plan enters the canonical USS (and therefore inputHash) — not ingestHash, which already committed the CPJ levels", () => {
    const withPlan = mapCpjToUssV11(cpj({ entry: 50000, stopLoss: 49300, takeProfits: [{ price: 51000 }] }), STRATEGY).uss!;
    const withoutPlan = mapCpjToUssV11(cpj({}), STRATEGY).uss!;
    expect(withPlan.plan).toBeDefined();
    expect(withoutPlan.plan).toBeUndefined();
    expect(withPlan.provenance.ingestHash).not.toBe(withoutPlan.provenance.ingestHash);
  });
});
