/**
 * Tests for NewsFeatures computation
 * 
 * Verifies that newsFeatures are correctly derived from news enrichment data.
 */

import { describe, it, expect } from "@jest/globals";
import { computeNewsFeatures } from "../../src/news/newsFeatures.js";
import type { NewsShockSummary } from "../../src/news/newsProvider.js";

describe("computeNewsFeatures", () => {
  it("should return null when news is null", () => {
    const result = computeNewsFeatures(null);
    expect(result).toBeNull();
  });

  it("should return basic features when news has no items", () => {
    const news: NewsShockSummary = {
      hasShockEvent: true,
      shockDirection: "unknown",
      headlines: ["Bitcoin hits new high", "Ethereum surges"],
      items: [],
    };

    const result = computeNewsFeatures(news);
    expect(result).toEqual({
      hasNewsShock: true,
      headlineCount: 2,
      mostRecentMinutesAgo: null,
      oldestMinutesAgo: null,
      hasExchangeEvent: false,
      hasRegulatoryEvent: false,
      hasMacroEvent: false,
    });
  });

  it("should compute timing features from items", () => {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    const news: NewsShockSummary = {
      hasShockEvent: true,
      shockDirection: "bullish",
      headlines: ["Recent news", "Older news"],
      items: [
        {
          id: "1",
          title: "Recent news",
          source: "CoinDesk",
          url: "https://example.com/1",
          publishedAt: tenMinutesAgo,
        },
        {
          id: "2",
          title: "Older news",
          source: "CoinTelegraph",
          url: "https://example.com/2",
          publishedAt: thirtyMinutesAgo,
        },
      ],
    };

    const result = computeNewsFeatures(news);
    expect(result).not.toBeNull();
    expect(result!.hasNewsShock).toBe(true);
    expect(result!.headlineCount).toBe(2);
    expect(result!.mostRecentMinutesAgo).toBeGreaterThanOrEqual(9);
    expect(result!.mostRecentMinutesAgo).toBeLessThanOrEqual(11);
    expect(result!.oldestMinutesAgo).toBeGreaterThanOrEqual(29);
    expect(result!.oldestMinutesAgo).toBeLessThanOrEqual(31);
  });

  it("should detect exchange events", () => {
    const news: NewsShockSummary = {
      hasShockEvent: true,
      shockDirection: "unknown",
      headlines: ["Binance launches new feature"],
      items: [
        {
          id: "1",
          title: "Binance launches new feature",
          source: "CryptoNews",
          url: "https://example.com/1",
          publishedAt: new Date(),
        },
      ],
    };

    const result = computeNewsFeatures(news);
    expect(result!.hasExchangeEvent).toBe(true);
    expect(result!.hasRegulatoryEvent).toBe(false);
    expect(result!.hasMacroEvent).toBe(false);
  });

  it("should detect regulatory events", () => {
    const news: NewsShockSummary = {
      hasShockEvent: true,
      shockDirection: "bearish",
      headlines: ["SEC approves Bitcoin ETF"],
      items: [
        {
          id: "1",
          title: "SEC approves Bitcoin ETF",
          source: "Bloomberg",
          url: "https://example.com/1",
          publishedAt: new Date(),
        },
      ],
    };

    const result = computeNewsFeatures(news);
    expect(result!.hasExchangeEvent).toBe(false);
    expect(result!.hasRegulatoryEvent).toBe(true);
    expect(result!.hasMacroEvent).toBe(false);
  });

  it("should detect macro events", () => {
    const news: NewsShockSummary = {
      hasShockEvent: true,
      shockDirection: "unknown",
      headlines: ["Fed raises interest rates"],
      items: [
        {
          id: "1",
          title: "Fed raises interest rates",
          source: "Reuters",
          url: "https://example.com/1",
          publishedAt: new Date(),
        },
      ],
    };

    const result = computeNewsFeatures(news);
    expect(result!.hasExchangeEvent).toBe(false);
    expect(result!.hasRegulatoryEvent).toBe(false);
    expect(result!.hasMacroEvent).toBe(true);
  });

  it("should detect multiple event types", () => {
    const news: NewsShockSummary = {
      hasShockEvent: true,
      shockDirection: "unknown",
      headlines: ["Coinbase faces SEC lawsuit", "Fed signals rate cut"],
      items: [
        {
          id: "1",
          title: "Coinbase faces SEC lawsuit",
          source: "WSJ",
          url: "https://example.com/1",
          publishedAt: new Date(),
        },
        {
          id: "2",
          title: "Fed signals rate cut",
          source: "CNBC",
          url: "https://example.com/2",
          publishedAt: new Date(),
        },
      ],
    };

    const result = computeNewsFeatures(news);
    expect(result!.hasExchangeEvent).toBe(true);  // Coinbase
    expect(result!.hasRegulatoryEvent).toBe(true); // SEC
    expect(result!.hasMacroEvent).toBe(true);      // Fed
  });
});

