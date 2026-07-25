/**
 * MarkitTick → USS v1.1 mapper unit tests (TradingView Low-Latency Origin Prep
 * v0.1). Pure mapper tests — no server, no scoring. Placed under test/pipeline/
 * so the jest testMatch allowlist discovers it (test/uss/ is ignored).
 */
import { describe, it, expect } from "@jest/globals";
import {
  adaptMarkitTickToTradingView,
  mapMarkitTickToUssV11,
  splitTicker,
  normalizeTimeframe,
  MARKITTICK_INDICATOR_ID,
  MARKITTICK_DEFAULT_PROVIDER_ID,
  ORIGIN_MODE_PREFLIGHT,
  type MarkitTickAlertPayload,
} from "../../src/uss/markitTickMapper.js";

const RESOLVED = { strategyId: "trend_pullback_v1" };
const bull = (): MarkitTickAlertPayload => ({
  ticker: "BINANCE:BTCUSDT",
  tf: "5",
  event: "bull_cross",
  arsi: "61.25",
  merged: "58.90",
});

describe("splitTicker", () => {
  it("splits EXCHANGE:PAIR taking the segment AFTER the colon (not the CPJ normalizer behavior)", () => {
    expect(splitTicker("BINANCE:BTCUSDT")).toEqual({ symbol: "BTCUSDT", exchange: "BINANCE" });
  });
  it("passes a bare pair through with no exchange", () => {
    expect(splitTicker("BTCUSDT")).toEqual({ symbol: "BTCUSDT" });
  });
  it("trims whitespace", () => {
    expect(splitTicker(" COINBASE:ETHUSD ")).toEqual({ symbol: "ETHUSD", exchange: "COINBASE" });
  });
});

describe("normalizeTimeframe", () => {
  it.each([
    ["5", "5m"],
    ["15", "15m"],
    ["60", "1h"],
    ["240", "4h"],
    ["D", "1d"],
    ["W", "1w"],
    ["M", "1M"],
  ])("normalizes %s → %s", (tf, expected) => {
    expect(normalizeTimeframe(tf)).toBe(expected);
  });
  it("passes unknown forms through unchanged", () => {
    expect(normalizeTimeframe("3S")).toBe("3S");
  });
});

describe("adaptMarkitTickToTradingView — event → direction (v0.1 scope)", () => {
  it("maps bull_cross → long", () => {
    const r = adaptMarkitTickToTradingView(bull());
    expect(r.ok).toBe(true);
    expect(r.direction).toBe("long");
    expect(r.tvPayload!.symbol).toBe("BTCUSDT");
    expect(r.tvPayload!.timeframe).toBe("5m");
    expect(r.tvPayload!.direction).toBe("long");
    expect(r.tvPayload!.providerId).toBe(MARKITTICK_DEFAULT_PROVIDER_ID);
    // raw indicator readings carried as TOP-LEVEL payload fields (enter the ingestHash)
    expect((r.tvPayload as any).arsi).toBe("61.25");
    expect((r.tvPayload as any).merged).toBe("58.90");
    expect((r.tvPayload as any).markitTick).toBeUndefined();
    expect(r.event).toBe("bull_cross");
    expect(r.arsi).toBe("61.25");
    expect(r.merged).toBe("58.90");
  });

  it("maps bear_cross → short", () => {
    const r = adaptMarkitTickToTradingView({ ...bull(), event: "bear_cross" });
    expect(r.ok).toBe(true);
    expect(r.direction).toBe("short");
    expect(r.tvPayload!.direction).toBe("short");
  });

  it.each(["squeeze_breakout", "st_flip_bull", "st_flip_bear", "ob_entry", "os_entry"])(
    "defers unsupported v0.1 event %s with code deferred_event",
    (event) => {
      const r = adaptMarkitTickToTradingView({ ...bull(), event });
      expect(r.ok).toBe(false);
      expect(r.error!.code).toBe("deferred_event");
      expect(r.error!.detail).toEqual({ event });
    }
  );

  it("rejects an entirely unknown event with code unsupported_event", () => {
    const r = adaptMarkitTickToTradingView({ ...bull(), event: "banana" });
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe("unsupported_event");
  });

  it.each(["ticker", "tf", "event"])("rejects missing required field %s", (field) => {
    const p = bull() as Record<string, any>;
    delete p[field];
    const r = adaptMarkitTickToTradingView(p as MarkitTickAlertPayload);
    expect(r.ok).toBe(false);
    expect(r.error!.code).toBe("missing_field");
  });

  it("honors an explicit providerId and signalId", () => {
    const r = adaptMarkitTickToTradingView({ ...bull(), providerId: "custom_p", signalId: "sig-1" });
    expect(r.tvPayload!.providerId).toBe("custom_p");
    expect(r.tvPayload!.signalId).toBe("sig-1");
  });
});

describe("mapMarkitTickToUssV11 — canonical USS + source metadata", () => {
  it("produces a valid-shaped USS with source metadata on provenance (no schema change)", () => {
    const r = mapMarkitTickToUssV11(bull(), RESOLVED);
    expect(r.ok).toBe(true);
    const uss = r.uss!;
    expect(uss.schema).toBe("afi.usignal.v1.1");
    // facts (additionalProperties:false — only the canonical five keys)
    expect(uss.facts).toMatchObject({
      symbol: "BTCUSDT",
      market: "perp",
      timeframe: "5m",
      strategy: "trend_pullback_v1", // the RESOLVED strategyId, never raw payload text
      direction: "long",
    });
    // source metadata on the free-form provenance slots
    expect(uss.provenance.source).toBe("tradingview");
    expect(uss.provenance.providerType).toBe("tradingview");
    expect(uss.provenance.indicatorId).toBe(MARKITTICK_INDICATOR_ID);
    expect(uss.provenance.indicatorEvent).toBe("bull_cross");
    expect(uss.provenance.originMode).toBe(ORIGIN_MODE_PREFLIGHT);
    expect(uss.provenance.providerId).toBe(MARKITTICK_DEFAULT_PROVIDER_ID);
    // raw float readings are NOT stamped into the hashed provenance (afi.hash.v1
    // forbids raw floats); they ride the ingestHash + the HTTP response instead.
    expect(uss.provenance.indicatorValues).toBeUndefined();
    expect(uss.provenance.sourceExchange).toBe("BINANCE");
    expect(typeof uss.provenance.signalId).toBe("string");
    expect(typeof uss.provenance.ingestHash).toBe("string");
    // meta echo
    expect(r.meta).toMatchObject({
      indicatorId: MARKITTICK_INDICATOR_ID,
      event: "bull_cross",
      direction: "long",
      originMode: ORIGIN_MODE_PREFLIGHT,
      symbol: "BTCUSDT",
      timeframe: "5m",
      exchange: "BINANCE",
    });
  });

  it("honors an explicit originMode (live)", () => {
    const r = mapMarkitTickToUssV11(bull(), RESOLVED, { originMode: "tradingview-webhook" });
    expect(r.uss!.provenance.originMode).toBe("tradingview-webhook");
  });

  it("propagates a mapper reject (deferred event) without producing a USS", () => {
    const r = mapMarkitTickToUssV11({ ...bull(), event: "ob_entry" }, RESOLVED);
    expect(r.ok).toBe(false);
    expect(r.uss).toBeUndefined();
    expect(r.error!.code).toBe("deferred_event");
  });

  it("commits the indicator readings into the ingestHash (different readings ⇒ different ingestHash)", () => {
    const a = mapMarkitTickToUssV11({ ...bull(), arsi: "61.25", merged: "58.90" }, RESOLVED);
    const b = mapMarkitTickToUssV11({ ...bull(), arsi: "12.34", merged: "99.99" }, RESOLVED);
    expect(a.ok && b.ok).toBe(true);
    expect(typeof a.uss!.provenance.ingestHash).toBe("string");
    expect(a.uss!.provenance.ingestHash).not.toBe(b.uss!.provenance.ingestHash);
  });

  it("omits indicatorValues when arsi/merged are absent", () => {
    const r = mapMarkitTickToUssV11({ ticker: "BINANCE:BTCUSDT", tf: "5", event: "bull_cross" }, RESOLVED);
    expect(r.ok).toBe(true);
    expect(r.uss!.provenance.indicatorValues).toBeUndefined();
  });
});
