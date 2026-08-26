/**
 * DEM-PRODUCER-PLAN — the trade-plan verification law (D-DEM-5(6)), pinned
 * as known-answer vectors over hand-built candle windows.
 *
 * Every rule is exercised on both sides of its edge; every refusal is a
 * TradePlanVerificationError (a NodeConfigurationError — pipeline abort, no
 * retry, no record). Geometry is derived from submitted PRICES only: the
 * producer never reads a submitted side (DIR-GOV D-DIR-3).
 */
import { describe, it, expect } from "@jest/globals";
import {
  TradePlanVerificationError,
  roundRr,
  verifyTradePlan,
} from "../../src/enrichment/tradePlanVerification.js";
import { NodeConfigurationError } from "../../src/pipeline/nodeSdk.js";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type { TradePlanV1 } from "../../src/types/TradePlan.js";

/** A window whose observed extremes are exactly [low, high]. */
function window(low: number, high: number, bars = 60): AfiCandle[] {
  const out: AfiCandle[] = [];
  for (let i = 0; i < bars; i++) {
    const mid = (low + high) / 2;
    out.push({ timestamp: 1_700_000_000_000 + i * 60_000, open: mid, high: mid, low: mid, close: mid, volume: 1 });
  }
  out[0] = { ...out[0], low, high: low };
  out[bars - 1] = { ...out[bars - 1], high, low: high };
  return out;
}

function plan(levels: TradePlanV1["levels"]): TradePlanV1 {
  return { schema: "afi.trade-plan.v1", signalId: "sig-plan-kat", levels };
}

// Window [90, 110]: W = 20, band = [70, 130].
const W = window(90, 110);

describe("verifyTradePlan — envelope band [L − W, H + W]", () => {
  it("accepts an entry inside the observed window and stop/target inside the band", () => {
    const facts = verifyTradePlan(plan({ entry: "100", stopLoss: "95", takeProfits: [{ price: "110" }] }), W);
    expect(facts).toEqual({
      entryLow: 100,
      entryHigh: 100,
      entryPrice: 100,
      stopPrice: 95,
      firstTargetPrice: 110,
      targetCount: 1,
      rrToFirstTarget: 2,
      envelopeLow: 90,
      envelopeHigh: 110,
      barCount: 60,
    });
  });

  it("accepts a breakout entry ABOVE the window and a limit entry BELOW it, inside the band", () => {
    expect(verifyTradePlan(plan({ entry: "125", stopLoss: "115", takeProfits: [{ price: "130" }] }), W).rrToFirstTarget).toBe(0.5);
    expect(verifyTradePlan(plan({ entry: "75", stopLoss: "70", takeProfits: [{ price: "90" }] }), W).rrToFirstTarget).toBe(3);
  });

  it("accepts levels exactly ON the band edges", () => {
    const facts = verifyTradePlan(plan({ entry: "100", stopLoss: "70", takeProfits: [{ price: "130" }] }), W);
    expect(facts.stopPrice).toBe(70);
    expect(facts.firstTargetPrice).toBe(130);
    expect(facts.rrToFirstTarget).toBe(1);
  });

  const BAND_REFUSALS: Array<[string, TradePlanV1["levels"], RegExp]> = [
    ["entry above the band", { entry: "130.01", stopLoss: "120", takeProfits: [{ price: "130" }] }, /entry 130.01 lies outside/],
    ["entry below the band", { entry: "69.99", stopLoss: "60", takeProfits: [{ price: "90" }] }, /entry 69.99 lies outside/],
    ["stop outside the band", { entry: "100", stopLoss: "69.99", takeProfits: [{ price: "110" }] }, /stopLoss 69.99 lies outside/],
    ["target outside the band", { entry: "100", stopLoss: "95", takeProfits: [{ price: "130.5" }] }, /takeProfits\[0\].price 130.5 lies outside/],
  ];
  it.each(BAND_REFUSALS)("refuses %s", (_label, levels, re) => {
    expect(() => verifyTradePlan(plan(levels), W)).toThrow(re);
  });

  it("refuses a flat window (zero observed range) and an empty window", () => {
    expect(() => verifyTradePlan(plan({ entry: "100" }), window(100, 100))).toThrow(/flat/);
    expect(() => verifyTradePlan(plan({ entry: "100" }), [])).toThrow(/no fetched candles/);
  });
});

describe("verifyTradePlan — plan geometry (from submitted prices only)", () => {
  it("long geometry: stop below entry, targets above; first target = nearest", () => {
    const facts = verifyTradePlan(
      plan({ entry: "100", stopLoss: "96", takeProfits: [{ price: "112" }, { price: "104" }, { price: "108" }] }),
      W
    );
    expect(facts.firstTargetPrice).toBe(104);
    expect(facts.targetCount).toBe(3);
    expect(facts.rrToFirstTarget).toBe(1);
  });

  it("short geometry: stop above entry, targets below (direction is never read)", () => {
    const facts = verifyTradePlan(plan({ entry: "100", stopLoss: "104", takeProfits: [{ price: "94" }, { price: "90" }] }), W);
    expect(facts.firstTargetPrice).toBe(94);
    expect(facts.rrToFirstTarget).toBe(1.5);
  });

  const GEOMETRY_REFUSALS: Array<[string, TradePlanV1["levels"], RegExp]> = [
    ["targets on both sides of the stop", { entry: "100", stopLoss: "100.5", takeProfits: [{ price: "95" }, { price: "110" }] }, /both sides of the stop/],
    ["a target equal to the stop", { entry: "100", stopLoss: "95", takeProfits: [{ price: "95" }] }, /equals the stop/],
    ["stop not below the entry (long)", { entry: "100", stopLoss: "100", takeProfits: [{ price: "110" }] }, /stop 100 is not below the entry 100/],
    ["target not above the entry (long)", { entry: "100", stopLoss: "95", takeProfits: [{ price: "110" }, { price: "100" }] }, /target 100 is not above the entry 100/],
    ["stop not above the entry (short)", { entry: "100", stopLoss: "99", takeProfits: [{ price: "90" }] }, /is not above the entry 100|is not below the entry 100/],
  ];
  it.each(GEOMETRY_REFUSALS)("refuses %s", (_label, levels, re) => {
    expect(() => verifyTradePlan(plan(levels), W)).toThrow(re);
  });

  it("entry RANGE: the conservative bound (nearest the targets) is the entry price", () => {
    const long = verifyTradePlan(plan({ entry: { min: "98", max: "102" }, stopLoss: "94", takeProfits: [{ price: "110" }] }), W);
    expect(long.entryLow).toBe(98);
    expect(long.entryHigh).toBe(102);
    expect(long.entryPrice).toBe(102); // smallest reward (8), largest risk (8) → rr 1
    expect(long.rrToFirstTarget).toBe(1);
    const short = verifyTradePlan(plan({ entry: { min: "98", max: "102" }, stopLoss: "106", takeProfits: [{ price: "90" }] }), W);
    expect(short.entryPrice).toBe(98);
    expect(short.rrToFirstTarget).toBe(1);
  });

  it("refuses an inverted entry range", () => {
    expect(() => verifyTradePlan(plan({ entry: { min: "102", max: "98" } }), W)).toThrow(/inverted/);
  });
});

describe("verifyTradePlan — declared producer absences (D-DEM-5(4)(b))", () => {
  it("entry-only plan: the entry is verified, no R:R fact is emitted", () => {
    const facts = verifyTradePlan(plan({ entry: "100" }), W);
    expect(facts).toEqual({ entryLow: 100, entryHigh: 100, entryPrice: 100, targetCount: 0, envelopeLow: 90, envelopeHigh: 110, barCount: 60 });
    expect(facts.rrToFirstTarget).toBeUndefined();
  });

  it("entry + stop without a target: both verified, no R:R fact", () => {
    const facts = verifyTradePlan(plan({ entry: "100", stopLoss: "95" }), W);
    expect(facts.stopPrice).toBe(95);
    expect(facts.rrToFirstTarget).toBeUndefined();
    expect(facts.firstTargetPrice).toBeUndefined();
  });

  it("entry range without geometry: bounds verified, no entryPrice, no R:R", () => {
    const facts = verifyTradePlan(plan({ entry: { min: "98", max: "102" } }), W);
    expect(facts.entryPrice).toBeUndefined();
    expect(facts.rrToFirstTarget).toBeUndefined();
  });

  it("an entry-only plan outside the band is still refused (an emitted price is always a verified price)", () => {
    expect(() => verifyTradePlan(plan({ entry: "50" }), W)).toThrow(TradePlanVerificationError);
  });
});

describe("verifyTradePlan — contract discipline and error class", () => {
  it("refuses non-decimal-string and non-positive prices", () => {
    expect(() => verifyTradePlan(plan({ entry: 100 as unknown as string }), W)).toThrow(/neither a price nor a range/);
    expect(() => verifyTradePlan(plan({ entry: "100", stopLoss: 95 as unknown as string }), W)).toThrow(/stopLoss is not a decimal-string/);
    expect(() => verifyTradePlan(plan({ entry: "-5" }), W)).toThrow(/not a decimal-string/);
    expect(() => verifyTradePlan(plan({ entry: "0" }), W)).toThrow(/not a positive finite/);
    expect(() => verifyTradePlan(plan({ entry: "1e3" }), W)).toThrow(/not a decimal-string/);
  });

  it("refuses a non-plan object", () => {
    expect(() => verifyTradePlan({ schema: "other" } as unknown as TradePlanV1, W)).toThrow(/not an afi.trade-plan.v1/);
  });

  it("every refusal is a TradePlanVerificationError, i.e. a NodeConfigurationError (no retry, pipeline abort)", () => {
    try {
      verifyTradePlan(plan({ entry: "50" }), W);
      throw new Error("expected refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(TradePlanVerificationError);
      expect(err).toBeInstanceOf(NodeConfigurationError);
      expect((err as TradePlanVerificationError).code).toBe("trade_plan_unverifiable");
      expect((err as TradePlanVerificationError).reason).toMatch(/entry 50 lies outside/);
    }
  });

  it("R:R rounds half-up to 4 decimals", () => {
    expect(roundRr(1000 / 700)).toBe(1.4286);
    expect(roundRr(1.23445)).toBe(1.2345);
    expect(roundRr(2)).toBe(2);
    const facts = verifyTradePlan(plan({ entry: "50000", stopLoss: "49300", takeProfits: [{ price: "51000" }] }), window(49000, 51000));
    expect(facts.rrToFirstTarget).toBe(1.4286);
  });

  it("is pure and side-effect free: identical inputs → identical facts; inputs untouched", () => {
    const p = plan({ entry: "100", stopLoss: "95", takeProfits: [{ price: "110" }] });
    const before = JSON.stringify([p, W]);
    const a = verifyTradePlan(p, W);
    const b = verifyTradePlan(p, W);
    expect(a).toEqual(b);
    expect(JSON.stringify([p, W])).toBe(before);
  });
});
