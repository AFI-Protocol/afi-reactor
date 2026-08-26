/**
 * DEM-PRODUCER-CANDLE — the technical lane's candle-structure producers
 * (DEM-GOV §9 DEM-PRODUCER-CANDLE, owner-authorized 2026-08-25; the act
 * D5-GOV D-D5-1 reserved). Pure functions over the candle window the lane
 * already fetched — no new fetch, no new provider, no params.
 *
 * Both facts are evaluated on the LAST fetched bar (`candles[len − 1]`), the
 * convention every existing kernel uses (technicalIndicators.ts latestCandle;
 * patternRecognition.ts "current candle"). On a live feed that bar may still
 * be in progress; a closed-bar convention would be a separate ruling that
 * moves every kernel together (recorded open item).
 *
 * brokeEmaWithBody — "breaking the EMA with a body is a structural negative"
 * (froggy.trend_pullback_v1.ts:77). The body — not merely a wick — closed on
 * the counter-trend side of EMA20 (the EMA the sweet-spot law reads):
 *   trend bullish → close < ema20;  trend bearish → close > ema20;
 *   range (no side to break against) → the body CROSSED EMA20 on this bar:
 *   open and close on strictly opposite sides. Colour-free; one law per side.
 *
 * haFlatBack / haFlatBackConfirmed — Heikin-Ashi flat-back: the recurrence
 *   haClose = (o + h + l + c) / 4,  haOpen = (prevHaOpen + prevHaClose) / 2,
 *   seeded with haOpen₀ = (o₀ + c₀) / 2 on the FIRST fetched bar, run over
 *   the WHOLE fetched window. The latest HA bar is a bullish flat-back iff it
 *   is an up bar (haClose > haOpen) with no lower wick — exactly `low ≥ haOpen`
 *   (the HA low is min(low, haOpen, haClose)); a bearish flat-back iff it is a
 *   down bar with no upper wick — `high ≤ haOpen`. Epsilon = 0: exact
 *   comparison, no tolerance. Confirmed iff the flat-back's side agrees with
 *   the lane's own EMA trend law (`trendBias`); range → never confirmed.
 *
 * The trend side used above is the lane's computed fact (EMA20 vs EMA50), never
 * a submitted or declared direction (DIR-GOV D-DIR-3).
 *
 * MATH-GOV: profile math of the reference technical lane; promotes nothing.
 */
import type { AfiCandle } from "../types/AfiCandle.js";

export type TrendBias = "bullish" | "bearish" | "range";
export type HaFlatBack = "bullish" | "bearish" | "none";

export interface HeikinAshiBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** The Heikin-Ashi recurrence over the whole window (oldest first). */
export function heikinAshiSeries(candles: readonly AfiCandle[]): HeikinAshiBar[] {
  const out: HeikinAshiBar[] = [];
  let prev: HeikinAshiBar | undefined;
  for (const c of candles) {
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = prev ? (prev.open + prev.close) / 2 : (c.open + c.close) / 2;
    const bar: HeikinAshiBar = {
      open: haOpen,
      close: haClose,
      high: Math.max(c.high, haOpen, haClose),
      low: Math.min(c.low, haOpen, haClose),
    };
    out.push(bar);
    prev = bar;
  }
  return out;
}

/** The latest HA bar's flat-back side (epsilon 0). */
export function latestHaFlatBack(candles: readonly AfiCandle[]): HaFlatBack {
  if (candles.length === 0) return "none";
  const series = heikinAshiSeries(candles);
  const ha = series[series.length - 1];
  const raw = candles[candles.length - 1];
  if (ha.close > ha.open && raw.low >= ha.open) return "bullish";
  if (ha.close < ha.open && raw.high <= ha.open) return "bearish";
  return "none";
}

/** Confirmed iff the flat-back agrees with the lane's trend law; range → false. */
export function haFlatBackConfirmed(flatBack: HaFlatBack, trendBias: TrendBias): boolean {
  return (flatBack === "bullish" && trendBias === "bullish") || (flatBack === "bearish" && trendBias === "bearish");
}

/** The latest bar's body closed on the counter-trend side of EMA20 (range: crossed it). */
export function brokeEmaWithBody(latest: AfiCandle, ema20: number, trendBias: TrendBias): boolean {
  if (!Number.isFinite(ema20)) return false;
  switch (trendBias) {
    case "bullish":
      return latest.close < ema20;
    case "bearish":
      return latest.close > ema20;
    default:
      return (latest.open < ema20 && latest.close > ema20) || (latest.open > ema20 && latest.close < ema20);
  }
}

export interface CandleStructureFacts {
  brokeEmaWithBody: boolean;
  haFlatBack: HaFlatBack;
  haFlatBackConfirmed: boolean;
}

/** Both producers over one window (the technical kernel's call site). */
export function computeCandleStructure(
  candles: readonly AfiCandle[],
  ema20: number,
  trendBias: TrendBias
): CandleStructureFacts {
  const latest = candles[candles.length - 1];
  const flatBack = latestHaFlatBack(candles);
  return {
    brokeEmaWithBody: brokeEmaWithBody(latest, ema20, trendBias),
    haFlatBack: flatBack,
    haFlatBackConfirmed: haFlatBackConfirmed(flatBack, trendBias),
  };
}
