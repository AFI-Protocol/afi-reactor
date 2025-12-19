/**
 * Perp Sentiment Mapper
 *
 * Maps raw perp market metrics (funding rates, open interest) into
 * structured sentiment signals for Froggy's trend-pullback strategy.
 *
 * Heuristics are tuned for BTC/ETH baseline but can be adjusted per asset.
 *
 * @module perpSentimentMapper
 */

import type { FundingRegime, PositioningBias } from "../../types/UssLenses.js";

/**
 * Compute funding regime classification from funding rate.
 *
 * Thresholds (BTC/ETH baseline):
 * - elevated_positive: > +0.10% per funding period (8h)
 * - elevated_negative: < -0.10% per funding period
 * - normal: between -0.10% and +0.10%
 *
 * @param fundingRate - Funding rate in decimal (e.g. 0.0001 = 0.01%)
 * @returns FundingRegime classification
 */
export function computeFundingRegime(fundingRate: number): FundingRegime {
  // Convert to percentage for easier threshold comparison
  const fundingPct = fundingRate * 100;

  if (fundingPct > 0.10) {
    return "elevated_positive";
  } else if (fundingPct < -0.10) {
    return "elevated_negative";
  } else {
    return "normal";
  }
}

/**
 * Compute positioning bias from funding regime, OI change, and long/short ratio.
 *
 * Heuristics:
 * - crowded_long:
 *     - fundingRegime is elevated_positive OR longShortRatio > 1.3
 *     - AND oiChange24hPct > 5%
 * - crowded_short:
 *     - fundingRegime is elevated_negative OR longShortRatio < 0.7
 *     - AND oiChange24hPct > 5%
 * - balanced: otherwise
 *
 * @param params - Funding regime, OI change, and optional long/short ratio
 * @returns PositioningBias classification
 */
export function computePositioningBias(params: {
  fundingRegime: FundingRegime;
  oiChange24hPct: number;
  longShortRatio?: number;
}): PositioningBias {
  const { fundingRegime, oiChange24hPct, longShortRatio } = params;

  // Check for crowded longs
  const isFundingBullish = fundingRegime === "elevated_positive";
  const isLongHeavy = longShortRatio !== undefined && longShortRatio > 1.3;
  const isOIRising = oiChange24hPct > 5;

  if ((isFundingBullish || isLongHeavy) && isOIRising) {
    return "crowded_long";
  }

  // Check for crowded shorts
  const isFundingBearish = fundingRegime === "elevated_negative";
  const isShortHeavy = longShortRatio !== undefined && longShortRatio < 0.7;

  if ((isFundingBearish || isShortHeavy) && isOIRising) {
    return "crowded_short";
  }

  // Default to balanced
  return "balanced";
}

/**
 * Compute perp sentiment score (0-100) from funding rate, regime, positioning, and OI change.
 *
 * Scoring logic:
 * - Start at 50 (neutral)
 * - Map funding rate (capped at ±0.30%) to ±30 points
 * - Adjust ±10 points for strong OI change (> ±10%)
 * - Nudge ±5 points for crowded_long / crowded_short
 * - Clamp result to [0, 100], round to nearest integer
 *
 * @param input - Funding rate, regime, positioning bias, and OI change
 * @returns Perp sentiment score (0-100)
 */
export function computePerpSentimentScore(input: {
  fundingRate: number;
  fundingRegime: FundingRegime;
  positioningBias: PositioningBias;
  oiChange24hPct: number;
}): number {
  const { fundingRate, positioningBias, oiChange24hPct } = input;

  // Start at neutral
  let score = 50;

  // Map funding rate to ±30 points (capped at ±0.30%)
  const fundingPct = fundingRate * 100;
  const cappedFundingPct = Math.max(-0.30, Math.min(0.30, fundingPct));
  const fundingContribution = (cappedFundingPct / 0.30) * 30;
  score += fundingContribution;

  // Adjust for strong OI change (> ±10%)
  if (oiChange24hPct > 10) {
    score += 10; // Rising OI = bullish
  } else if (oiChange24hPct < -10) {
    score -= 10; // Falling OI = bearish
  }

  // Nudge for crowded positioning
  if (positioningBias === "crowded_long") {
    score += 5; // Crowded longs = slightly bullish (but risky)
  } else if (positioningBias === "crowded_short") {
    score -= 5; // Crowded shorts = slightly bearish (but risky)
  }

  // Clamp to [0, 100] and round
  return Math.round(Math.max(0, Math.min(100, score)));
}

