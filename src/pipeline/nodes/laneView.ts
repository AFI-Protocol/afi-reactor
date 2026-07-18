/**
 * Shared lane-result → FroggyEnrichedView projection helpers (FLPR-GOV).
 *
 * The ONE source of truth for mapping governed category results
 * (afi.enrichment.<lane>.v1) into the analyst-facing view fields. Used by the
 * five-category merge node AND by the aiMl adapter's service-input projection,
 * so the two can never drift apart (no duplicate normalization logic).
 *
 * These are pure functions over validated governed results. They contain no
 * vendor logic, no I/O, and no scoring: the scorer-visible values they carry
 * (technical.emaDistancePct / isInValueSweetSpot / brokeEmaWithBody=false,
 * pattern.patternName / patternConfidence, sentiment.tags) are projected
 * byte-identically to the pre-activation runtime.
 */
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import type { TechnicalLensV1 } from "../../types/UssLenses.js";

/** Governed sentiment axis observation (afi.enrichment.sentiment.v1 item). */
export interface SentimentAxisObservation {
  axis: "positioning" | "funding" | "openInterest" | "longShort" | "impliedVolatility" | "narrative";
  score: number;
  confidence?: number;
  horizon?: "intraday" | "daily" | "weekly" | "swing";
}

/** Governed pattern candlestick observation (FLPR-GOV D-FLPR-3 block). */
export interface CandlestickObservation {
  patternName: "bullish engulfing" | "bearish engulfing" | "pin bar" | "inside bar";
  patternConfidence: number;
  flags?: {
    bullishEngulfing?: boolean;
    bearishEngulfing?: boolean;
    pinBar?: boolean;
    insideBar?: boolean;
  };
  structureBias?: "higher-highs" | "lower-lows" | "choppy";
  trendPullbackConfirmed?: boolean;
}

/** Governed pattern category result minus the category marker. */
export interface PatternLanePayload {
  series: { seriesId: string; length: number; indexBasis: "position" | "epochMs" };
  motifs: unknown[];
  discords: unknown[];
  changePoints: unknown[];
  pivots: unknown[];
  candlestick?: CandlestickObservation;
}

/** Governed aiMl category result minus the category marker. */
export interface AiMlLanePayload {
  forecast: { direction: "long" | "short" | "neutral"; conviction: number; horizon?: string };
  regime?: { label: string; confidence?: number };
  riskFlag?: boolean;
}

/**
 * technical governed result → view.technical (BYTE-IDENTICAL to the
 * pre-activation merge mapping: brokeEmaWithBody pinned false, same renames).
 */
export function viewTechnical(
  payload: TechnicalLensV1["payload"] | null | undefined
): FroggyEnrichedView["technical"] {
  if (!payload) return undefined;
  return {
    emaDistancePct: payload.emaDistancePct,
    isInValueSweetSpot: payload.isInValueSweetSpot,
    brokeEmaWithBody: false,
    indicators: {
      rsi: payload.rsi14,
      ema_20: payload.ema20,
      ema_50: payload.ema50,
      volume_ratio: payload.volumeRatio,
    },
  };
}

/**
 * pattern governed result → view.pattern. Only the candlestick observation is
 * analyst-visible (the kernel observations ride the lens); absent block →
 * undefined view field, which reads identically to the pre-activation
 * no-dominant-pattern case at the scorer seam (patternConfidence undefined).
 */
export function viewPattern(
  payload: PatternLanePayload | null | undefined
): FroggyEnrichedView["pattern"] {
  if (!payload?.candlestick) return undefined;
  return {
    patternName: payload.candlestick.patternName,
    patternConfidence: payload.candlestick.patternConfidence,
  };
}

/**
 * sentiment governed axes → view.sentiment {score, tags}.
 *
 * The tag vocabulary is CLOSED and preserved from the pre-activation runtime:
 * tags[0] ∈ {crowded_long, crowded_short, balanced} (positioning axis),
 * tags[1] ∈ {elevated_positive, elevated_negative, normal} (funding axis).
 * No member contains a sweep substring, so the scorer's liquiditySwept hint
 * stays provably inert (FLPR-GOV D-FLPR-5). score is never read by the scorer.
 */
export function viewSentiment(
  axes: SentimentAxisObservation[] | null | undefined
): FroggyEnrichedView["sentiment"] {
  if (!axes) return undefined;
  const byAxis = new Map<string, number>();
  for (const a of axes) {
    if (!byAxis.has(a.axis)) byAxis.set(a.axis, a.score);
  }
  const positioning = byAxis.get("positioning") ?? 0;
  const funding = byAxis.get("funding") ?? 0;
  const positioningTag =
    positioning >= 0.5 ? "crowded_long" : positioning <= -0.5 ? "crowded_short" : "balanced";
  const fundingTag =
    funding >= 0.4 ? "elevated_positive" : funding <= -0.4 ? "elevated_negative" : "normal";
  const mean =
    axes.length === 0 ? 0 : axes.reduce((s, a) => s + a.score, 0) / axes.length;
  const score = Math.round((mean / 2 + 0.5) * 1e6) / 1e6;
  return { score, tags: [positioningTag, fundingTag] };
}

/** aiMl governed result → view.aiMl (the analyst-facing FroggyAiMlV1 shape). */
export function viewAiMl(
  payload: AiMlLanePayload | null | undefined
): FroggyEnrichedView["aiMl"] {
  if (!payload) return undefined;
  const out: NonNullable<FroggyEnrichedView["aiMl"]> = {
    convictionScore: payload.forecast.conviction,
    direction: payload.forecast.direction,
  };
  if (payload.regime?.label !== undefined) out.regime = payload.regime.label;
  if (payload.riskFlag !== undefined) out.riskFlag = payload.riskFlag;
  return out;
}
