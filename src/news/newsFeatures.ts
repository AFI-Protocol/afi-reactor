/**
 * News Features - Derived summary for UWR-ready context
 * 
 * Computes structured features from news enrichment data.
 * These features are intended as future inputs to UWR or other scoring systems.
 * 
 * Currently NOT used by UWR math - this is an additive layer for future integration.
 */

import type { NewsShockSummary } from "./newsProvider.js";

/**
 * NewsFeatures - Structured summary of news enrichment
 * 
 * Derived from NewsShockSummary (headlines, items, timestamps).
 * All fields are safe to use even if news data is missing.
 */
export interface NewsFeatures {
  /** True if hasShockEvent === true */
  hasNewsShock: boolean;
  /** Number of unique headlines in the time window */
  headlineCount: number;
  /** Minutes since most recent article (null if no items) */
  mostRecentMinutesAgo: number | null;
  /** Minutes since oldest article (null if no items) */
  oldestMinutesAgo: number | null;
  /** True if headlines mention exchanges (Binance, Coinbase, etc.) */
  hasExchangeEvent: boolean;
  /** True if headlines mention regulation (SEC, ETF, lawsuit, etc.) */
  hasRegulatoryEvent: boolean;
  /** True if headlines mention macro events (Fed, inflation, etc.) */
  hasMacroEvent: boolean;
}

// Keyword lists for categorical flags
const EXCHANGE_KEYWORDS = [
  "binance",
  "coinbase",
  "bybit",
  "okx",
  "blofin",
  "bitget",
  "kraken",
  "gemini",
  "ftx",
  "bitfinex",
  "huobi",
  "kucoin",
];

const REGULATORY_KEYWORDS = [
  "sec",
  "cftc",
  "regulation",
  "lawsuit",
  "ban",
  "etf",
  "approval",
  "denied",
  "fined",
  "penalty",
  "enforcement",
  "compliance",
  "ruling",
];

const MACRO_KEYWORDS = [
  "fed",
  "federal reserve",
  "interest rate",
  "inflation",
  "jobs report",
  "gdp",
  "recession",
  "treasury",
  "bond yield",
  "stock market",
  "s&p",
  "nasdaq",
  "dow",
  "unemployment",
];

/**
 * Check if text contains any of the keywords (case-insensitive)
 */
function containsKeyword(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some((keyword) => lowerText.includes(keyword));
}

/**
 * Compute NewsFeatures from NewsShockSummary
 * 
 * Returns null if news data is missing or empty.
 * Otherwise derives structured features from headlines and items.
 * 
 * @param news - News enrichment summary (or null if no news)
 * @returns NewsFeatures or null
 */
export function computeNewsFeatures(
  news: NewsShockSummary | null
): NewsFeatures | null {
  // If no news data, return null
  if (!news) {
    return null;
  }

  // Basic intensity
  const hasNewsShock = news.hasShockEvent;
  const headlineCount = news.headlines?.length ?? 0;

  // If no items, we can't compute timing or categorical flags
  if (!news.items || news.items.length === 0) {
    return {
      hasNewsShock,
      headlineCount,
      mostRecentMinutesAgo: null,
      oldestMinutesAgo: null,
      hasExchangeEvent: false,
      hasRegulatoryEvent: false,
      hasMacroEvent: false,
    };
  }

  // Timing: compute minutes ago for most recent and oldest articles
  const now = Date.now();
  const timestamps = news.items.map((item) => item.publishedAt.getTime());
  const mostRecentTimestamp = Math.max(...timestamps);
  const oldestTimestamp = Math.min(...timestamps);

  const mostRecentMinutesAgo = Math.round((now - mostRecentTimestamp) / 60000);
  const oldestMinutesAgo = Math.round((now - oldestTimestamp) / 60000);

  // Categorical flags: check all titles and sources for keywords
  let hasExchangeEvent = false;
  let hasRegulatoryEvent = false;
  let hasMacroEvent = false;

  for (const item of news.items) {
    const combinedText = `${item.title} ${item.source}`;

    if (containsKeyword(combinedText, EXCHANGE_KEYWORDS)) {
      hasExchangeEvent = true;
    }
    if (containsKeyword(combinedText, REGULATORY_KEYWORDS)) {
      hasRegulatoryEvent = true;
    }
    if (containsKeyword(combinedText, MACRO_KEYWORDS)) {
      hasMacroEvent = true;
    }
  }

  return {
    hasNewsShock,
    headlineCount,
    mostRecentMinutesAgo,
    oldestMinutesAgo,
    hasExchangeEvent,
    hasRegulatoryEvent,
    hasMacroEvent,
  };
}

