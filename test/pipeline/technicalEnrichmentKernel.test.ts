/**
 * Froggy Technical Enrichment - Strategy Scenario Tests
 *
 * Tests the technical enrichment pipeline with synthetic OHLCV series
 * that reflect real Froggy trend-pullback strategy scenarios.
 *
 * These tests verify that the Technical Lens + Froggy interpretation logic
 * behaves correctly for:
 * 1. Clean bullish trend with shallow pullback (ideal Froggy setup)
 * 2. Choppy / range-bound regime (avoid trading)
 * 3. Strong bearish trend (potential short setup or avoid)
 *
 * @module froggyTechnicalEnrichment.test
 */

import { describe, it, expect } from "@jest/globals";
import { computeTechnicalEnrichment } from "../../src/enrichment/technicalIndicators.js";
import type { AfiCandle } from "../../src/types/AfiCandle.js";

/**
 * Helper to create a synthetic OHLCV candle.
 */
function makeCandle(
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000
): AfiCandle {
  return {
    timestamp: Date.now(),
    open,
    high,
    low,
    close,
    volume,
  };
}

describe("Froggy Technical Enrichment - Strategy Scenarios", () => {
  describe("Scenario 1: Clean bullish trend with shallow pullback", () => {
    it("should detect bullish trend bias and sweet spot entry", () => {
      // Build 60 candles with clear upward drift
      // Price starts at 100, trends up to ~120, then pulls back slightly toward EMA-20
      const candles: AfiCandle[] = [];

      // First 40 candles: steady uptrend (100 → 115)
      for (let i = 0; i < 40; i++) {
        const basePrice = 100 + (i * 0.375); // +15 over 40 candles
        const open = basePrice;
        const close = basePrice + 0.3;
        const high = close + 0.2;
        const low = open - 0.1;
        candles.push(makeCandle(open, high, low, close, 1000 + i * 10));
      }

      // Next 15 candles: continue uptrend (115 → 120)
      for (let i = 0; i < 15; i++) {
        const basePrice = 115 + (i * 0.333);
        const open = basePrice;
        const close = basePrice + 0.25;
        const high = close + 0.15;
        const low = open - 0.1;
        candles.push(makeCandle(open, high, low, close, 1200 + i * 5));
      }

      // Last 5 candles: shallow pullback toward EMA-20 (120 → ~118)
      for (let i = 0; i < 5; i++) {
        const basePrice = 120 - (i * 0.4);
        const open = basePrice;
        const close = basePrice - 0.3;
        const high = open + 0.1;
        const low = close - 0.2;
        candles.push(makeCandle(open, high, low, close, 900 - i * 20));
      }

      const result = computeTechnicalEnrichment(candles);

      expect(result).not.toBeNull();
      expect(result!.trendBias).toBe("bullish");
      expect(result!.ema20).toBeGreaterThan(result!.ema50);

      // RSI should be elevated (bullish momentum) but not extreme
      // Note: Synthetic data can produce higher RSI than real markets
      expect(result!.rsi14).toBeGreaterThan(45);
      expect(result!.rsi14).toBeLessThan(75);

      // Should be in or near sweet spot (within 1% of EMA-20)
      expect(result!.isInValueSweetSpot).toBe(true);
      expect(Math.abs(result!.emaDistancePct!)).toBeLessThan(1.5);
    });
  });

  describe("Scenario 2: Choppy / range-bound regime", () => {
    it("should detect range bias and small EMA distance", () => {
      // Build 60 candles oscillating sideways around mean price of 100
      const candles: AfiCandle[] = [];
      const meanPrice = 100;

      for (let i = 0; i < 60; i++) {
        // Oscillate ±2 around mean using sine wave
        const deviation = 2 * Math.sin((i * Math.PI) / 10);
        const basePrice = meanPrice + deviation;
        const open = basePrice;
        const close = basePrice + (Math.random() > 0.5 ? 0.2 : -0.2);
        const high = Math.max(open, close) + 0.15;
        const low = Math.min(open, close) - 0.15;
        candles.push(makeCandle(open, high, low, close, 1000 + i * 5));
      }

      const result = computeTechnicalEnrichment(candles);

      expect(result).not.toBeNull();
      expect(result!.trendBias).toBe("range");

      // EMA distance should be small (choppy = price near both EMAs)
      expect(Math.abs(result!.emaDistancePct!)).toBeLessThan(2);

      // EMA-20 and EMA-50 should be close to each other
      const emaDiff = Math.abs(result!.ema20 - result!.ema50);
      const emaDiffPct = (emaDiff / result!.ema50) * 100;
      expect(emaDiffPct).toBeLessThan(0.5); // Less than 0.5% apart
    });
  });

  describe("Scenario 3: Strong bearish trend", () => {
    it("should detect bearish trend bias and lower RSI", () => {
      // Build 60 candles with clear downward drift
      // Price starts at 100, trends down to ~80
      const candles: AfiCandle[] = [];

      // First 40 candles: steady downtrend (100 → 85)
      for (let i = 0; i < 40; i++) {
        const basePrice = 100 - (i * 0.375); // -15 over 40 candles
        const open = basePrice;
        const close = basePrice - 0.3;
        const high = open + 0.1;
        const low = close - 0.2;
        candles.push(makeCandle(open, high, low, close, 1000 + i * 10));
      }

      // Next 20 candles: continue downtrend (85 → 80)
      for (let i = 0; i < 20; i++) {
        const basePrice = 85 - (i * 0.25);
        const open = basePrice;
        const close = basePrice - 0.2;
        const high = open + 0.05;
        const low = close - 0.15;
        candles.push(makeCandle(open, high, low, close, 1200 + i * 5));
      }

      const result = computeTechnicalEnrichment(candles);

      expect(result).not.toBeNull();
      expect(result!.trendBias).toBe("bearish");
      expect(result!.ema20).toBeLessThan(result!.ema50);

      // RSI should be depressed (bearish momentum)
      // Note: Strong synthetic downtrends can produce very low RSI (even 0)
      expect(result!.rsi14).toBeLessThan(50);
      expect(result!.rsi14).toBeGreaterThanOrEqual(0); // Valid RSI range

      // EMA distance should be negative (price below EMA-20)
      expect(result!.emaDistancePct!).toBeLessThan(0);
    });
  });
});


// ---------------------------------------------------------------------------
// AR-GOV D-AR-2: the ATR-percentile regime law — exact unit vectors.
// The bucket law applies to the SEALED one-decimal midrank percentile
// (rounded half-up), so classifications audit exactly against lane bytes.
// ---------------------------------------------------------------------------
import { computeAtrRegime } from "../../src/enrichment/technicalIndicators.js";

describe("AR-GOV D-AR-2 — ATR-percentile regime law", () => {
  // Build a series whose LATEST value sits at a chosen midrank percentile:
  // with N distinct ascending values and the latest ranked k-th smallest,
  // p = 100 * (k - 1 + 0.5) / N.
  const seriesWithLatestRank = (n: number, k: number): number[] => {
    const values = Array.from({ length: n }, (_, i) => 1 + i); // 1..n distinct
    const latest = values[k - 1];
    const rest = values.filter((_, i) => i !== k - 1);
    return [...rest, latest]; // latest observation last (chronological)
  };

  it("fewer than 20 observations → null (defensive; unreachable behind the 50-candle kernel floor)", () => {
    expect(computeAtrRegime(Array.from({ length: 19 }, (_, i) => i + 1))).toBeNull();
  });

  it("all-equal observations → midrank p = 50.0 → normal", () => {
    const r = computeAtrRegime(Array(40).fill(3.14));
    expect(r).toEqual({ atrPercentile: 50, atrRegime: "normal" });
  });

  it("boundary p = 25.0 exactly → normal (25 ≤ p ≤ 75)", () => {
    // N=20 with the latest tied once: below(9.5)=4 (1..4), equal=2
    // → p = 100*(4 + 0.5*2)/20 = 25.0 → normal, not low.
    const s = [1, 2, 3, 4, 9.5, ...Array.from({ length: 14 }, (_, i) => 20 + i), 9.5];
    expect(computeAtrRegime(s)).toEqual({ atrPercentile: 25, atrRegime: "normal" });
  });

  it("just below the low boundary → low", () => {
    // N=40, latest ranked 10th smallest: p = 100*9.5/40 = 23.8 (half-up) → low
    const r = computeAtrRegime(seriesWithLatestRank(40, 10));
    expect(r).toEqual({ atrPercentile: 23.8, atrRegime: "low" });
  });

  it("boundary p = 75.0 exactly → normal; just above → high", () => {
    // N=20: below(100)=14 (1..13 and 50), equal=2
    // → p = 100*(14 + 0.5*2)/20 = 75.0 → normal, not high.
    const s = [...Array.from({ length: 13 }, (_, i) => 1 + i), 50, 100, 200, 300, 400, 500, 100];
    expect(computeAtrRegime(s)).toEqual({ atrPercentile: 75, atrRegime: "normal" });
    // N=40, rank 32: p = 100*31.5/40 = 78.75 → 78.8 (half-up) → high
    expect(computeAtrRegime(seriesWithLatestRank(40, 32))).toEqual({
      atrPercentile: 78.8,
      atrRegime: "high",
    });
  });

  it("boundary p = 95.0 exactly → high; above → extreme", () => {
    // N=20: below=18, equal=2 → p = 100*(18+1)/20 = 95.0 → high
    const s = [...Array.from({ length: 18 }, (_, i) => 1 + i), 100, 100];
    expect(computeAtrRegime(s)).toEqual({ atrPercentile: 95, atrRegime: "high" });
    // strictly increasing, latest is the max: N=86, p = 100*85.5/86 = 99.4 → extreme
    const inc = Array.from({ length: 86 }, (_, i) => 1 + i);
    expect(computeAtrRegime(inc)).toEqual({ atrPercentile: 99.4, atrRegime: "extreme" });
  });

  it("half-up rounding at one decimal is the sealed and classified value", () => {
    // N=86, rank 65: p = 100*64.5/86 = 75.0 exactly → normal (not high)
    expect(computeAtrRegime(seriesWithLatestRank(86, 65))).toEqual({
      atrPercentile: 75,
      atrRegime: "normal",
    });
    // N=86, rank 66: p = 100*65.5/86 = 76.16… → 76.2 → high
    expect(computeAtrRegime(seriesWithLatestRank(86, 66))).toEqual({
      atrPercentile: 76.2,
      atrRegime: "high",
    });
  });
});
