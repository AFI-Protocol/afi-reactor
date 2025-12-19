/**
 * TradingView to USS v1.1 Mapper Tests
 * 
 * Tests the deterministic mapping of TradingView payloads to canonical USS v1.1 format.
 */

import { mapTradingViewToUssV11, type TradingViewAlertPayload } from "../../src/uss/tradingViewMapper";

describe("TradingView to USS v1.1 Mapper", () => {
  beforeEach(() => {
    // Clear environment variables
    delete process.env.AFI_DEFAULT_PROVIDER_ID;
  });

  it("should map minimal TradingView payload to canonical USS v1.1", () => {
    const tvPayload: TradingViewAlertPayload = {
      symbol: "BTC/USDT",
      timeframe: "15m",
      strategy: "froggy_trend_pullback_v1",
      direction: "long",
    };

    const uss = mapTradingViewToUssV11(tvPayload);

    // Verify schema version
    expect(uss.schema).toBe("afi.usignal.v1.1");

    // Verify provenance fields
    expect(uss.provenance.source).toBe("tradingview-webhook");
    expect(uss.provenance.providerId).toBe("tradingview-default"); // Fallback (no strategy derivation)
    expect(uss.provenance.signalId).toMatch(/^btcusdt-15m-froggy-trend-pullback-v1-long-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(uss.provenance.ingestedAt).toBeDefined();
    expect(uss.provenance.ingestHash).toBeDefined();
    expect(uss.provenance.providerType).toBe("tradingview");
    expect(uss.provenance.providerRef).toBe("froggy_trend_pullback_v1");

    // Verify NO decay mapping at ingest
    expect(uss.core).toBeUndefined();
  });

  it("should use explicit providerId when provided", () => {
    const tvPayload: TradingViewAlertPayload = {
      symbol: "ETH/USDT",
      timeframe: "1h",
      strategy: "some_strategy",
      direction: "short",
      providerId: "custom-provider-123",
    };

    const uss = mapTradingViewToUssV11(tvPayload);

    expect(uss.provenance.providerId).toBe("custom-provider-123");
  });

  it("should use explicit signalId when provided", () => {
    const tvPayload: TradingViewAlertPayload = {
      symbol: "SOL/USDT",
      timeframe: "4h",
      strategy: "test_strategy",
      direction: "neutral",
      signalId: "custom-signal-id-456",
    };

    const uss = mapTradingViewToUssV11(tvPayload);

    expect(uss.provenance.signalId).toBe("custom-signal-id-456");
  });

  it("should derive providerId from environment variable when not in payload", () => {
    process.env.AFI_DEFAULT_PROVIDER_ID = "env-provider-789";

    const tvPayload: TradingViewAlertPayload = {
      symbol: "AVAX/USDT",
      timeframe: "1d",
      strategy: "unknown_strategy",
      direction: "long",
    };

    const uss = mapTradingViewToUssV11(tvPayload);

    expect(uss.provenance.providerId).toBe("env-provider-789");
  });

  it("should use fallback providerId when no other source available", () => {
    const tvPayload: TradingViewAlertPayload = {
      symbol: "MATIC/USDT",
      timeframe: "5m",
      strategy: "",
      direction: "short",
    };

    const uss = mapTradingViewToUssV11(tvPayload);

    expect(uss.provenance.providerId).toBe("tradingview-default");
  });

  it("should NOT map timeframes to decay (no ingest-time decay)", () => {
    const testCases = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];

    testCases.forEach((timeframe) => {
      const tvPayload: TradingViewAlertPayload = {
        symbol: "BTC/USDT",
        timeframe,
        strategy: "test",
        direction: "long",
      };

      const uss = mapTradingViewToUssV11(tvPayload);

      // NO decay at ingest - handled by analyst/scoring stages
      expect(uss.core).toBeUndefined();
    });
  });

  it("should generate deterministic ingestHash", () => {
    const tvPayload: TradingViewAlertPayload = {
      symbol: "BTC/USDT",
      timeframe: "1h",
      strategy: "test",
      direction: "long",
      notes: "test notes",
    };

    const uss1 = mapTradingViewToUssV11(tvPayload);
    const uss2 = mapTradingViewToUssV11(tvPayload);

    // Hash should be deterministic for same payload
    expect(uss1.provenance.ingestHash).toBe(uss2.provenance.ingestHash);
    expect(uss1.provenance.ingestHash).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
  });
});

