/**
 * Froggy Sentiment Profile
 *
 * Strategy-specific sentiment configuration for Froggy's trend-pullback pipeline.
 * Focuses on perp market positioning (funding rates, open interest) from Coinalyze.
 *
 * This is NOT a universal sentiment definition - it's tailored specifically for
 * Froggy's trend-pullback strategy (froggy_trend_pullback_v1).
 *
 * @module froggySentimentProfile
 */

import type { SentimentLensV1 } from "../types/UssLenses.js";
import { fetchCoinalyzePerpMetrics } from "../adapters/coinalyze/coinalyzeClient.js";
import {
  computeFundingRegime,
  computePositioningBias,
  computePerpSentimentScore,
} from "../enrichment/sentiment/perpSentimentMapper.js";

/**
 * Compute Froggy's sentiment lens from Coinalyze perp metrics.
 *
 * Fetches funding rate and open interest data from Coinalyze,
 * then derives sentiment signals using Froggy's heuristics.
 *
 * Default symbol: "BTCUSDT_PERP.A" (Binance BTC perp)
 * Can be overridden for other assets (ETH, SOL, etc.)
 *
 * @param symbol - Coinalyze symbol (e.g. "BTCUSDT_PERP.A")
 * @param timeframe - Timeframe for history ("1h" or "1d")
 * @returns SentimentLensV1 payload or null if data unavailable
 */
export async function computeFroggySentiment(
  symbol: string = "BTCUSDT_PERP.A",
  timeframe: "1h" | "1d" = "1h"
): Promise<SentimentLensV1["payload"] | null> {
  try {
    // Fetch perp metrics from Coinalyze
    const metrics = await fetchCoinalyzePerpMetrics(symbol, timeframe);

    // Derive OI change over 24h (last vs first in history)
    const oiHistoryUsd = metrics.oiHistoryUsd;
    if (oiHistoryUsd.length < 1) {
      console.warn(
        `⚠️  Froggy sentiment: No OI data for ${symbol}.`
      );
      return null;
    }

    // If we only have 1 data point, assume 0% change (no historical comparison)
    let oiChange24hPct = 0;
    if (oiHistoryUsd.length >= 2) {
      const oiFirst = oiHistoryUsd[0];
      const oiLast = oiHistoryUsd[oiHistoryUsd.length - 1];
      oiChange24hPct = ((oiLast - oiFirst) / oiFirst) * 100;
    } else {
      console.log(
        `ℹ️  Froggy sentiment: Only 1 OI data point for ${symbol}, assuming 0% change`
      );
    }

    // Derive OI trend (rising / falling / flat)
    let oiTrend: "rising" | "falling" | "flat";
    if (oiChange24hPct > 5) {
      oiTrend = "rising";
    } else if (oiChange24hPct < -5) {
      oiTrend = "falling";
    } else {
      oiTrend = "flat";
    }

    // Compute funding regime
    const fundingRegime = computeFundingRegime(metrics.fundingRate);

    // Compute positioning bias
    const positioningBias = computePositioningBias({
      fundingRegime,
      oiChange24hPct,
      longShortRatio: metrics.longShortRatio,
    });

    // Compute perp sentiment score (0-100)
    const perpSentimentScore = computePerpSentimentScore({
      fundingRate: metrics.fundingRate,
      fundingRegime,
      positioningBias,
      oiChange24hPct,
    });

    // Build SentimentLensV1 payload
    const payload: SentimentLensV1["payload"] = {
      // Perp sentiment fields
      perpSentimentScore,
      fundingRegime,
      positioningBias,
      oiChange24hPct,
      oiTrend,
      providerMeta: {
        primary: "coinalyze",
        symbols: [symbol],
      },
    };

    console.log(
      `✅ Froggy sentiment: ${symbol} - Score: ${perpSentimentScore}, Funding: ${fundingRegime}, Positioning: ${positioningBias}, OI: ${oiTrend} (${oiChange24hPct.toFixed(1)}%)`
    );

    return payload;
  } catch (error) {
    // Fail-soft: return null if Coinalyze is down or API key is missing
    if (error instanceof Error) {
      console.warn(
        `⚠️  Froggy sentiment: Failed to fetch Coinalyze metrics for ${symbol}:`,
        error.message
      );
    } else {
      console.warn(
        `⚠️  Froggy sentiment: Unknown error fetching metrics for ${symbol}`
      );
    }
    return null;
  }
}

