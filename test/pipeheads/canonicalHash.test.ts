import { describe, it, expect } from "@jest/globals";
import {
  canonicalize,
  canonicalHash,
  buildScoringProjection,
  EXCLUDED_TIMESTAMP_KEYS,
} from "../../src/pipeheads/canonicalHash.js";

const HEX_64 = /^[0-9a-f]{64}$/;

describe("canonicalHash", () => {
  it("produces a 64-char lowercase hex digest", () => {
    const hash = canonicalHash({ symbol: "BTC/USDT", market: "perp" });
    expect(hash).toMatch(HEX_64);
  });

  it("is key-order independent (top-level)", () => {
    const a = canonicalHash({ a: 1, b: 2, c: 3 });
    const b = canonicalHash({ c: 3, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("is key-order independent (nested objects)", () => {
    const a = canonicalHash({ outer: { x: 1, y: { p: 1, q: 2 } }, z: [1, 2] });
    const b = canonicalHash({ z: [1, 2], outer: { y: { q: 2, p: 1 }, x: 1 } });
    expect(a).toBe(b);
  });

  it("preserves array order (array order is substantive)", () => {
    const a = canonicalHash({ list: [1, 2, 3] });
    const b = canonicalHash({ list: [3, 2, 1] });
    expect(a).not.toBe(b);
  });

  it("drops the fixed timestamp key set so adding/removing them does not change the hash", () => {
    const base = { signalId: "s1", uwrScore: 0.5 };
    const withTimestamps = {
      signalId: "s1",
      uwrScore: 0.5,
      scoredAt: "2025-01-01T00:00:00.000Z",
      issuedAt: "2025-01-01T00:00:00.000Z",
      producedAt: "2025-01-01T00:00:00.000Z",
      normalizedAt: "2025-01-01T00:00:00.000Z",
      startedAt: "2025-01-01T00:00:00.000Z",
      finishedAt: "2025-01-01T00:00:00.000Z",
      at: "2025-01-01T00:00:00.000Z",
      timestamp: "2025-01-01T00:00:00.000Z",
    };
    expect(canonicalHash(withTimestamps)).toBe(canonicalHash(base));
  });

  it("excludes timestamp keys at any nesting depth", () => {
    const a = { meta: { scoredAt: "A", value: 1 } };
    const b = { meta: { scoredAt: "B", value: 1 } };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("changing a different value changes the timestamp-stripped hash", () => {
    const a = { value: 1, scoredAt: "x" };
    const b = { value: 2, scoredAt: "x" };
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  it("supports additional excludeKeys beyond the timestamp set", () => {
    const a = { value: 1, drop: "one" };
    const b = { value: 1, drop: "two" };
    expect(canonicalHash(a, { excludeKeys: ["drop"] })).toBe(
      canonicalHash(b, { excludeKeys: ["drop"] })
    );
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  it("EXCLUDED_TIMESTAMP_KEYS is the documented fixed set", () => {
    expect([...EXCLUDED_TIMESTAMP_KEYS].sort()).toEqual(
      [
        "scoredAt",
        "issuedAt",
        "producedAt",
        "normalizedAt",
        "startedAt",
        "finishedAt",
        "at",
        "timestamp",
      ].sort()
    );
  });

  it("canonicalize returns a deterministic key-sorted JSON string", () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});

describe("buildScoringProjection", () => {
  const scored = {
    signalId: "btc-4h-1",
    uwrScore: 0.5,
    uwrAxes: { structure: 0.5, execution: 0.5, risk: 0.5, insight: 0.5 },
    analystScore: {
      analystId: "froggy",
      strategyId: "trend_pullback_v1",
      direction: "long",
      riskBucket: "medium",
      conviction: 0.5,
      uwrScore: 0.5,
      uwrAxes: { structure: 0.5, execution: 0.5, risk: 0.5, insight: 0.5 },
      scoredAt: "2025-01-01T00:00:00.000Z",
    },
    provisional: true as const,
    demoOnly: true as const,
    scoredAt: "2025-01-01T00:00:00.000Z",
  };

  it("projects exactly the deterministic scoring fields", () => {
    const projection = buildScoringProjection(scored);
    expect(projection).toEqual({
      uwrScore: 0.5,
      uwrAxes: { structure: 0.5, execution: 0.5, risk: 0.5, insight: 0.5 },
      analystId: "froggy",
      strategyId: "trend_pullback_v1",
      direction: "long",
      riskBucket: "medium",
      conviction: 0.5,
    });
  });

  it("projection carries no timestamp key", () => {
    const projection = buildScoringProjection(scored) as unknown as Record<string, unknown>;
    expect(projection.scoredAt).toBeUndefined();
  });

  it("hash of the projection is invariant to analystScore.scoredAt", () => {
    const other = {
      ...scored,
      scoredAt: "2099-12-31T23:59:59.000Z",
      analystScore: { ...scored.analystScore, scoredAt: "2099-12-31T23:59:59.000Z" },
    };
    expect(canonicalHash(buildScoringProjection(scored))).toBe(
      canonicalHash(buildScoringProjection(other))
    );
  });

  it("hash of the projection changes when a projected field changes", () => {
    const other = {
      ...scored,
      uwrScore: 0.6,
      analystScore: { ...scored.analystScore, conviction: 0.6 },
    };
    expect(canonicalHash(buildScoringProjection(scored))).not.toBe(
      canonicalHash(buildScoringProjection(other))
    );
  });
});
