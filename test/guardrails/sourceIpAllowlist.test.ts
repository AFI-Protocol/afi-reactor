/**
 * Source-IP allowlist unit tests.
 *
 * The load-bearing case is SPOOF RESISTANCE: a client that supplies its own
 * `X-Forwarded-For` must not be able to impersonate an allowlisted origin. If
 * that test ever goes green under a leftmost-entry implementation, the filter is
 * decorative.
 */

import { describe, it, expect } from "@jest/globals";
import {
  parseForwardedFor,
  resolveClientIp,
  evaluateSourceIp,
  allowlistFromEnv,
  TRADINGVIEW_WEBHOOK_IPS,
} from "../../src/utils/sourceIpAllowlist.js";

const TV = [...TRADINGVIEW_WEBHOOK_IPS];

describe("parseForwardedFor", () => {
  it("splits a comma-separated chain and trims whitespace", () => {
    expect(parseForwardedFor("1.2.3.4, 5.6.7.8 ,9.10.11.12")).toEqual([
      "1.2.3.4",
      "5.6.7.8",
      "9.10.11.12",
    ]);
  });

  it("returns an empty chain for a missing header", () => {
    expect(parseForwardedFor(undefined)).toEqual([]);
  });

  it("joins repeated headers delivered as an array", () => {
    expect(parseForwardedFor(["1.2.3.4", "5.6.7.8"])).toEqual(["1.2.3.4", "5.6.7.8"]);
  });

  it("strips an IPv4 port suffix", () => {
    expect(parseForwardedFor("52.89.214.238:41234")).toEqual(["52.89.214.238"]);
  });

  it("unwraps bracketed IPv6 and leaves the address intact", () => {
    expect(parseForwardedFor("[2600:1f14::1]:443")).toEqual(["2600:1f14::1"]);
  });

  it("unwraps IPv4-mapped IPv6", () => {
    expect(parseForwardedFor("::ffff:52.89.214.238")).toEqual(["52.89.214.238"]);
  });
});

describe("resolveClientIp", () => {
  it("takes the rightmost entry by default", () => {
    expect(resolveClientIp(["1.1.1.1", "2.2.2.2", "3.3.3.3"])).toBe("3.3.3.3");
  });

  it("counts hops leftward from the right", () => {
    expect(resolveClientIp(["1.1.1.1", "2.2.2.2", "3.3.3.3"], 1)).toBe("2.2.2.2");
  });

  it("returns null when the chain is shorter than the hop count", () => {
    expect(resolveClientIp(["1.1.1.1"], 3)).toBeNull();
  });

  it("returns null for an empty chain", () => {
    expect(resolveClientIp([])).toBeNull();
  });
});

describe("evaluateSourceIp — spoof resistance", () => {
  it("REJECTS a client that prepends an allowlisted address", () => {
    // Cloud Run appends the observed peer, so the attacker's value lands left.
    const decision = evaluateSourceIp("52.89.214.238, 203.0.113.7", TV);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("not-in-allowlist");
    expect(decision.clientIp).toBe("203.0.113.7");
  });

  it("REJECTS a client that prepends the entire allowlist", () => {
    const decision = evaluateSourceIp(`${TV.join(", ")}, 203.0.113.7`, TV);
    expect(decision.allowed).toBe(false);
    expect(decision.clientIp).toBe("203.0.113.7");
  });

  it("allows a genuine TradingView origin with no client-supplied header", () => {
    const decision = evaluateSourceIp("52.89.214.238", TV);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("allowed");
  });

  it("allows a genuine origin whose own junk header was appended to", () => {
    const decision = evaluateSourceIp("garbage-value, 34.212.75.30", TV);
    expect(decision.allowed).toBe(true);
    expect(decision.clientIp).toBe("34.212.75.30");
  });
});

describe("evaluateSourceIp — policy behaviour", () => {
  it("is DISABLED by an empty allowlist and reports why", () => {
    const decision = evaluateSourceIp("203.0.113.7", []);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("disabled");
  });

  it("refuses when no source address can be established", () => {
    const decision = evaluateSourceIp(undefined, TV);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no-source-ip");
  });

  it("falls back to the socket peer when no header is present", () => {
    expect(evaluateSourceIp(undefined, TV, 0, "52.32.178.7").allowed).toBe(true);
    expect(evaluateSourceIp(undefined, TV, 0, "203.0.113.7").allowed).toBe(false);
  });

  it("honours a hop count for a load balancer placed in front", () => {
    // LB appends its own address, shifting the real client one place left.
    const decision = evaluateSourceIp("54.218.53.128, 10.0.0.9", TV, 1);
    expect(decision.allowed).toBe(true);
    expect(decision.clientIp).toBe("54.218.53.128");
  });

  it("surfaces the full chain for diagnosing a wrong hop count", () => {
    const decision = evaluateSourceIp("52.89.214.238, 10.0.0.9", TV);
    expect(decision.chain).toEqual(["52.89.214.238", "10.0.0.9"]);
  });
});

describe("allowlistFromEnv", () => {
  it("treats unset and empty as disabled", () => {
    expect(allowlistFromEnv(undefined)).toEqual([]);
    expect(allowlistFromEnv("   ")).toEqual([]);
  });

  it("expands the `tradingview` token to the published set", () => {
    expect(allowlistFromEnv("tradingview")).toEqual(TV);
    expect(allowlistFromEnv("TradingView")).toEqual(TV);
  });

  it("parses an explicit comma-separated list", () => {
    expect(allowlistFromEnv("1.2.3.4, 5.6.7.8")).toEqual(["1.2.3.4", "5.6.7.8"]);
  });

  it("pins the published TradingView addresses", () => {
    expect(TV).toEqual(["52.89.214.238", "34.212.75.30", "54.218.53.128", "52.32.178.7"]);
  });
});
