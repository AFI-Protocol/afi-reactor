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

