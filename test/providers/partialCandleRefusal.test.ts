/**
 * D8-R2: partial market data is REFUSED, never repaired.
 *
 * ccxt types every OHLCV element as `Num` (`number | undefined`) because a venue
 * MAY return a partial bar. Before this guard, such a bar was asserted to be
 * complete and flowed into scoring, where it became undiagnosable:
 *
 *   1. `EMA.update(undefined)` / `RSI.update(undefined)` return NaN SILENTLY
 *      (they do not throw) — pinned by a test below so a library upgrade that
 *      changes this is noticed.
 *   2. `NaN == null` is false, so the indicator-bundle presence check passed it.
 *   3. Ordinary comparisons then launder NaN into plausible values
 *      (`trendBias` → "range", `isInValueSweetSpot` → false).
 *   4. The canonical-hash finiteness policy never sees it, because the
 *      enrichment bundle is round-tripped through `JSON.stringify`, which
 *      rewrites NaN to null — a value the policy explicitly allows.
 *
 * Net effect: a hash-stamped, replayable determination derived from data the
 * venue never supplied. These tests pin the refusal at both chokepoints.
 */
import { describe, it, expect } from "@jest/globals";
import { EMA, RSI } from "trading-signals";
import {
  toOHLCVCandle,
  PartialCandleError,
  type OHLCVCandle,
} from "../../src/adapters/exchanges/types.js";
import { computeFroggyBundle } from "../../src/indicator/froggyProfile.js";
import type { AfiCandle } from "../../src/types/AfiCandle.js";

/** A well-formed ccxt tuple: [timestamp, open, high, low, close, volume]. */
const GOOD: ReadonlyArray<number> = [1_700_000_000_000, 100, 110, 95, 105, 1_234];

describe("D8-R2 — partial candles are refused at the adapter boundary", () => {
  it("passes a well-formed tuple through unchanged", () => {
    const candle: OHLCVCandle = toOHLCVCandle(GOOD, "BloFin", "BTC/USDT:USDT", 0);
    expect(candle).toEqual({
      timestamp: 1_700_000_000_000,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1_234,
    });
  });

  // The whole tuple is guarded, not just prices — a missing timestamp would
  // silently corrupt bar ordering and the decay clock.
  const FIELDS = ["timestamp", "open", "high", "low", "close", "volume"] as const;

  it.each(FIELDS.map((f, i) => [f, i] as const))(
    "refuses a tuple whose %s is undefined",
    (field, index) => {
      const tuple = [...GOOD] as (number | undefined)[];
      tuple[index] = undefined;
      expect(() => toOHLCVCandle(tuple, "BloFin", "BTC/USDT:USDT", 7)).toThrow(
        PartialCandleError
      );
    }
  );

  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])("refuses a %s close", (_label, bad) => {
    const tuple = [...GOOD];
    tuple[4] = bad;
    expect(() => toOHLCVCandle(tuple, "Coinbase", "BTC/USD", 3)).toThrow(
      PartialCandleError
    );
  });

  it("attributes the failure to venue, symbol, index and field", () => {
    const tuple = [...GOOD] as (number | undefined)[];
    tuple[5] = undefined;
    try {
      toOHLCVCandle(tuple, "BloFin", "ETH/USDT:USDT", 42);
      throw new Error("expected PartialCandleError");
    } catch (err) {
      expect(err).toBeInstanceOf(PartialCandleError);
      const e = err as PartialCandleError;
      expect(e.venue).toBe("BloFin");
      expect(e.symbol).toBe("ETH/USDT:USDT");
      expect(e.index).toBe(42);
      expect(e.field).toBe("volume");
      // The message must name the source, not the symptom — the whole point is
      // that this is diagnosable at the boundary.
      expect(e.message).toContain("ETH/USDT:USDT");
      expect(e.message).toContain("volume");
    }
  });

  it("never substitutes a value (no zero-fill, no forward-fill)", () => {
    const tuple = [...GOOD] as (number | undefined)[];
    tuple[4] = undefined;
    // The failure mode this rules out: returning a candle with close: 0.
    expect(() => toOHLCVCandle(tuple, "BloFin", "BTC/USDT:USDT", 0)).toThrow();
  });
});

describe("D8-R2 — the indicator bundle declines non-finite indicators", () => {
  // Pins the library behaviour the guard exists for. If a trading-signals
  // upgrade starts throwing instead of returning NaN, this test tells us the
  // hazard moved rather than disappeared.
  it("trading-signals returns NaN (not a throw) for undefined input", () => {
    const ema = new EMA(3);
    [1, 2, 3, 4].forEach((v) => ema.update(v, false));
    ema.update(undefined as unknown as number, false);
    expect(Number.isNaN(Number(ema.getResult()))).toBe(true);

    const rsi = new RSI(3);
    [1, 2, 3, 4, 5].forEach((v) => rsi.update(v, false));
    rsi.update(undefined as unknown as number, false);
    expect(Number.isNaN(Number(rsi.getResult()))).toBe(true);
  });

  it("`== null` would NOT have caught it — the reason the guard changed", () => {
    const ema = new EMA(3);
    [1, 2, 3, 4].forEach((v) => ema.update(v, false));
    ema.update(undefined as unknown as number, false);

    // The REAL value the old guard was handed: `number | null`, actually NaN.
    const result: number | null = ema.getResult();

    expect(result == null).toBe(false); // the old predicate: lets NaN through
    expect(Number.isFinite(result)).toBe(false); // the new one: rejects it
  });

  it("returns null rather than a bundle carrying NaN", () => {
    // A series long enough to warm EMA-50/RSI-14/ATR-14, with one corrupt close
    // partway through — exactly what a partial bar from a venue looks like once
    // it has been let past the adapter.
    const candles: AfiCandle[] = Array.from({ length: 80 }, (_v, i) => ({
      timestamp: 1_700_000_000_000 + i * 60_000,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 100 + i,
      volume: 1_000,
    }));
    (candles[40] as { close: number }).close = NaN;

    expect(computeFroggyBundle(candles)).toBeNull();
  });

  it("still returns a bundle for a fully well-formed series", () => {
    const candles: AfiCandle[] = Array.from({ length: 80 }, (_v, i) => ({
      timestamp: 1_700_000_000_000 + i * 60_000,
      open: 100 + i,
      high: 105 + i,
      low: 95 + i,
      close: 100 + i,
      volume: 1_000,
    }));
    const bundle = computeFroggyBundle(candles);
    expect(bundle).not.toBeNull();
    expect(Number.isFinite(bundle!.ema20)).toBe(true);
    expect(Number.isFinite(bundle!.ema50)).toBe(true);
    expect(Number.isFinite(bundle!.rsi14)).toBe(true);
    expect(Number.isFinite(bundle!.atr14)).toBe(true);
  });
});
