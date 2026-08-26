/**
 * DEM-PRODUCER-CANDLE — known-answer vectors for the candle-structure
 * producers (brokeEmaWithBody, Heikin-Ashi flat-back) over hand-built
 * windows, every branch on both sides of its edge.
 */
import { describe, it, expect } from "@jest/globals";
import {
  brokeEmaWithBody,
  computeCandleStructure,
  haFlatBackConfirmed,
  heikinAshiSeries,
  latestHaFlatBack,
} from "../../src/enrichment/candleStructure.js";
import type { AfiCandle } from "../../src/types/AfiCandle.js";

function bar(open: number, high: number, low: number, close: number): AfiCandle {
  return { timestamp: 0, open, high, low, close, volume: 1 };
}

describe("brokeEmaWithBody — the body closed on the counter-trend side of EMA20", () => {
  it("bullish trend: true iff close < ema20, regardless of bar colour or open", () => {
    expect(brokeEmaWithBody(bar(101, 102, 98, 99), 100, "bullish")).toBe(true); // red body through the EMA
    expect(brokeEmaWithBody(bar(98, 99.5, 97, 99), 100, "bullish")).toBe(true); // green body entirely below (not a colour test)
    expect(brokeEmaWithBody(bar(101, 102, 98, 100.5), 100, "bullish")).toBe(false); // wick through, body above
    expect(brokeEmaWithBody(bar(101, 102, 99, 100), 100, "bullish")).toBe(false); // close exactly ON the EMA is not beyond it
  });

  it("bearish trend: true iff close > ema20", () => {
    expect(brokeEmaWithBody(bar(99, 102, 98, 101), 100, "bearish")).toBe(true);
    expect(brokeEmaWithBody(bar(102, 103, 100.5, 101), 100, "bearish")).toBe(true);
    expect(brokeEmaWithBody(bar(99, 102, 98, 99.5), 100, "bearish")).toBe(false);
    expect(brokeEmaWithBody(bar(99, 102, 98, 100), 100, "bearish")).toBe(false);
  });

  it("range: true iff the body CROSSED the EMA on this bar (open and close on strictly opposite sides)", () => {
    expect(brokeEmaWithBody(bar(99, 102, 98, 101), 100, "range")).toBe(true); // up through
    expect(brokeEmaWithBody(bar(101, 102, 98, 99), 100, "range")).toBe(true); // down through
    expect(brokeEmaWithBody(bar(101, 103, 100.5, 102), 100, "range")).toBe(false); // body entirely above
    expect(brokeEmaWithBody(bar(98, 99.5, 97, 99), 100, "range")).toBe(false); // body entirely below
    expect(brokeEmaWithBody(bar(100, 102, 98, 101), 100, "range")).toBe(false); // open ON the EMA: not a crossing
    expect(brokeEmaWithBody(bar(99, 102, 98, 100), 100, "range")).toBe(false); // close ON the EMA: not a crossing
  });

  it("a non-finite EMA never breaks (defensive; unreachable behind the kernel floor)", () => {
    expect(brokeEmaWithBody(bar(99, 102, 98, 101), Number.NaN, "bullish")).toBe(false);
  });
});

describe("Heikin-Ashi recurrence and flat-back (seed (o+c)/2, whole window, epsilon 0)", () => {
  it("first bar seeds haOpen = (open + close) / 2; subsequent haOpen = (prevHaOpen + prevHaClose) / 2", () => {
    const s = heikinAshiSeries([bar(10, 12, 9, 11), bar(11, 13, 10, 12)]);
    expect(s[0]).toEqual({ open: 10.5, close: 10.5, high: 12, low: 9 });
    expect(s[1].open).toBe((10.5 + 10.5) / 2);
    expect(s[1].close).toBe((11 + 13 + 10 + 12) / 4);
    expect(s[1].high).toBe(Math.max(13, s[1].open, s[1].close));
    expect(s[1].low).toBe(Math.min(10, s[1].open, s[1].close));
  });

  it("bullish flat-back: an up HA bar whose raw low is ≥ haOpen (no lower wick); exact equality counts", () => {
    // Prior bars establish haOpen; the last bar's low sits exactly at haOpen.
    const prev = [bar(100, 101, 99, 100), bar(100, 101, 99, 100)];
    const haOpenLast = (() => {
      const s = heikinAshiSeries([...prev, bar(100, 101, 99, 100)]);
      return s[s.length - 1].open;
    })();
    const flat = [...prev, bar(haOpenLast, haOpenLast + 3, haOpenLast, haOpenLast + 2)];
    expect(latestHaFlatBack(flat)).toBe("bullish");
    const wick = [...prev, bar(haOpenLast, haOpenLast + 3, haOpenLast - 0.0001, haOpenLast + 2)];
    expect(latestHaFlatBack(wick)).toBe("none");
  });

  it("bearish flat-back: a down HA bar whose raw high is ≤ haOpen (no upper wick)", () => {
    const prev = [bar(100, 101, 99, 100), bar(100, 101, 99, 100)];
    const s = heikinAshiSeries([...prev, bar(100, 101, 99, 100)]);
    const haOpenLast = s[s.length - 1].open;
    expect(latestHaFlatBack([...prev, bar(haOpenLast, haOpenLast, haOpenLast - 3, haOpenLast - 2)])).toBe("bearish");
    expect(latestHaFlatBack([...prev, bar(haOpenLast, haOpenLast + 0.0001, haOpenLast - 3, haOpenLast - 2)])).toBe("none");
  });

  it("a doji HA bar (haClose === haOpen) is never a flat-back; an empty window is none", () => {
    expect(latestHaFlatBack([bar(100, 100, 100, 100)])).toBe("none");
    expect(latestHaFlatBack([])).toBe("none");
  });

  it("the seed's influence decays: at the 50-bar kernel floor two different seeds agree on the latest HA bar to <1e-9", () => {
    const window: AfiCandle[] = [];
    for (let i = 0; i < 50; i++) window.push(bar(100 + i, 101 + i, 99 + i, 100.5 + i));
    const a = heikinAshiSeries(window);
    const altered = [bar(50, 60, 40, 55), ...window.slice(1)]; // a wildly different first bar
    const b = heikinAshiSeries(altered);
    expect(Math.abs(a[49].open - b[49].open)).toBeLessThan(1e-9);
  });

  it("confirmation requires side agreement with the lane's trend law; range never confirms", () => {
    expect(haFlatBackConfirmed("bullish", "bullish")).toBe(true);
    expect(haFlatBackConfirmed("bearish", "bearish")).toBe(true);
    expect(haFlatBackConfirmed("bullish", "bearish")).toBe(false);
    expect(haFlatBackConfirmed("bearish", "bullish")).toBe(false);
    expect(haFlatBackConfirmed("bullish", "range")).toBe(false);
    expect(haFlatBackConfirmed("none", "bullish")).toBe(false);
  });
});

describe("computeCandleStructure — both producers over one window", () => {
  it("a trending window with a flat-backed continuation bar: confirmed, not broken", () => {
    const window: AfiCandle[] = [];
    for (let i = 0; i < 60; i++) window.push(bar(100 + i, 101.2 + i, 99.8 + i, 101 + i));
    const ha = heikinAshiSeries(window);
    const haOpenNext = (ha[59].open + ha[59].close) / 2;
    // Continuation bar with no lower wick relative to the next HA open.
    window.push(bar(haOpenNext, haOpenNext + 2, haOpenNext, haOpenNext + 1.5));
    const ema20 = haOpenNext - 5; // the trend's EMA sits below price
    const facts = computeCandleStructure(window, ema20, "bullish");
    expect(facts).toEqual({ brokeEmaWithBody: false, haFlatBack: "bullish", haFlatBackConfirmed: true });
  });

  it("a bullish trend whose last bar closed below EMA20: broken, no confirmation", () => {
    const window: AfiCandle[] = [];
    for (let i = 0; i < 60; i++) window.push(bar(100 + i, 101.2 + i, 99.8 + i, 101 + i));
    window.push(bar(162, 162.5, 150, 151));
    const facts = computeCandleStructure(window, 155, "bullish");
    expect(facts.brokeEmaWithBody).toBe(true);
    expect(facts.haFlatBackConfirmed).toBe(false);
  });
});
