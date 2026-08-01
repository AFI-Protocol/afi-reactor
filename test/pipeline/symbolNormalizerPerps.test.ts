/**
 * Symbol normalization — TradingView perpetual (`.P`) contract suffixes.
 *
 * TradingView appends `.P` to perpetual futures tickers. A BloFin BTC/USDT perp
 * charts as `BTCUSDT.P` and `{{ticker}}` emits `BLOFIN:BTCUSDT.P`. Before this,
 * the `.` tripped CONTAINS_FORBIDDEN_CHARS and every TradingView perp alert was
 * rejected — the whole perps use case, not an edge case.
 *
 * The deliberate non-behaviour matters as much as the behaviour: the strip is an
 * explicit allowlist, so dotted symbols that are NOT contract types (BRK.B — a
 * share class, part of the identity) must still be rejected rather than silently
 * mangled into BRK.
 */

import { describe, it, expect } from "@jest/globals";
import { normalizeSymbolStrict } from "../../src/uss/symbolNormalizer.js";
import { splitTicker } from "../../src/uss/markitTickMapper.js";

describe("normalizeSymbolStrict — TradingView perpetual suffix", () => {
  it("normalizes a concatenated perp to canonical BASE/QUOTE", () => {
    const r = normalizeSymbolStrict("BTCUSDT.P");
    expect(r.success).toBe(true);
    expect(r.canonical).toBe("BTC/USDT");
  });

  it("normalizes a slash-form perp", () => {
    const r = normalizeSymbolStrict("BTC/USDT.P");
    expect(r.success).toBe(true);
    expect(r.canonical).toBe("BTC/USDT");
  });

  it("is case-insensitive", () => {
    const r = normalizeSymbolStrict("btcusdt.p");
    expect(r.success).toBe(true);
    expect(r.canonical).toBe("BTC/USDT");
  });

  it("preserves the untouched symbolRaw for provenance", () => {
    const r = normalizeSymbolStrict("BTCUSDT.P");
    expect(r.symbolRaw).toBe("BTCUSDT.P");
  });

  it("still applies 1000-style handling under a perp suffix", () => {
    const r = normalizeSymbolStrict("1000PEPEUSDT.P");
    expect(r.success).toBe(true);
    expect(r.canonical).toBe("1000PEPE/USDT");
  });

  it("handles the real BloFin ticker end-to-end through splitTicker", () => {
    // {{ticker}} on a BloFin perp chart emits EXCHANGE:SYMBOL.P
    const { symbol, exchange } = splitTicker("BLOFIN:BTCUSDT.P");
    expect(exchange).toBe("BLOFIN");
    expect(symbol).toBe("BTCUSDT.P");
    const r = normalizeSymbolStrict(symbol);
    expect(r.success).toBe(true);
    expect(r.canonical).toBe("BTC/USDT");
  });
});

describe("normalizeSymbolStrict — the strip must NOT generalize", () => {
  it("still REJECTS a dotted suffix that is part of the identity (share class)", () => {
    // BRK.B is a distinct security from BRK.A — stripping would corrupt it.
    const r = normalizeSymbolStrict("BRK.B");
    expect(r.success).toBe(false);
    expect(r.canonical).toBeUndefined();
  });

  it("still REJECTS an unknown contract-type suffix rather than guessing", () => {
    const r = normalizeSymbolStrict("BTCUSDT.XYZ");
    expect(r.success).toBe(false);
  });

  it("does not strip a bare suffix into an empty symbol", () => {
    const r = normalizeSymbolStrict(".P");
    expect(r.success).toBe(false);
  });
});

describe("normalizeSymbolStrict — pre-existing behaviour is unchanged", () => {
  it("concatenated spot pair", () => {
    expect(normalizeSymbolStrict("BTCUSDT").canonical).toBe("BTC/USDT");
  });

  it("slash form", () => {
    expect(normalizeSymbolStrict("BTC/USDT").canonical).toBe("BTC/USDT");
  });

  it("hyphen form", () => {
    expect(normalizeSymbolStrict("BTC-USD").canonical).toBe("BTC/USD");
  });

  it("colon venue suffix", () => {
    expect(normalizeSymbolStrict("BTC/USDT:USDT").canonical).toBe("BTC/USDT");
  });

  it("rejects genuinely forbidden characters", () => {
    expect(normalizeSymbolStrict("BTC USDT").success).toBe(false);
  });
});
