/**
 * Tests for the hash-projection layer (District 2 M2) — the NARROW
 * field-specific number policy for afi.hash.v1 preimages. Proves:
 *
 *  - known score/enrichment/OHLCV fields are converted to deterministic
 *    canonical decimal strings (plain notation, shortest round-trip);
 *  - declared fields are ALWAYS stringified (integer or not) so a field's
 *    preimage type never flips with its value;
 *  - undeclared floats remain rejected downstream (fail-closed);
 *  - decimal strings stay strings;
 *  - no float-times-1e18 / base-unit scaling anti-pattern exists (behavioral
 *    + source scan).
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  toCanonicalDecimalString,
  projectDecimalFieldsForHash,
  SCORE_DECIMAL_KEYS,
  ENRICHMENT_DECIMAL_KEYS,
  OHLCV_DECIMAL_KEYS,
} from "../../../src/evidence/provenance/hashProjection.js";
import {
  computeCanonicalHashV1,
  CanonicalHashPolicyError,
} from "../../../src/evidence/provenance/canonicalHashV1.js";

const TAG = "afi.d2.test-domain";

describe("toCanonicalDecimalString", () => {
  it("uses shortest round-trip plain decimal notation (no scaled integers)", () => {
    expect(toCanonicalDecimalString(0.1875)).toBe("0.1875");
    expect(toCanonicalDecimalString(0.15)).toBe("0.15");
    expect(toCanonicalDecimalString(0.2)).toBe("0.2");
    expect(toCanonicalDecimalString(0.4)).toBe("0.4");
    expect(toCanonicalDecimalString(42000.5)).toBe("42000.5");
    expect(toCanonicalDecimalString(-3.25)).toBe("-3.25");
  });

  it("stringifies integers deterministically too", () => {
    expect(toCanonicalDecimalString(0)).toBe("0");
    expect(toCanonicalDecimalString(-0)).toBe("0");
    expect(toCanonicalDecimalString(7)).toBe("7");
    expect(toCanonicalDecimalString(1000)).toBe("1000");
  });

  it("expands exponent notation to plain decimal notation", () => {
    expect(toCanonicalDecimalString(1e-8)).toBe("0.00000001");
    expect(toCanonicalDecimalString(1.5e-7)).toBe("0.00000015");
    expect(toCanonicalDecimalString(1e21)).toBe("1000000000000000000000");
    expect(toCanonicalDecimalString(1.5e21)).toBe("1500000000000000000000");
    expect(toCanonicalDecimalString(-2.5e-9)).toBe("-0.0000000025");
  });

  it("rejects non-finite numbers", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => toCanonicalDecimalString(bad)).toThrow(CanonicalHashPolicyError);
    }
  });

  it("never produces a float-times-1e18 base-unit encoding", () => {
    // 0.1875 must project to "0.1875" — NOT "187500000000000000".
    expect(toCanonicalDecimalString(0.1875)).toBe("0.1875");
    expect(toCanonicalDecimalString(0.1875)).not.toBe("187500000000000000");
    expect(toCanonicalDecimalString(1.5)).toBe("1.5");
    expect(toCanonicalDecimalString(1.5)).not.toBe("1500000000000000000");
  });

  it("no scaling constants exist in the provenance sources (source scan)", () => {
    const dir = join(process.cwd(), "src/evidence/provenance");
    const offenders = [/1e18/i, /10\s*\*\*\s*18/, /BigInt\s*\(/, /\b1000000000000000000\b/];
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".ts")) continue;
      const src = readFileSync(join(dir, entry), "utf-8");
      for (const pattern of offenders) {
        expect({ file: entry, pattern: pattern.source, matched: pattern.test(src) }).toEqual({
          file: entry,
          pattern: pattern.source,
          matched: false,
        });
      }
    }
  });
});

describe("projectDecimalFieldsForHash", () => {
  it("converts declared score fields to canonical decimal strings", () => {
    const projected = projectDecimalFieldsForHash(
      {
        uwrScore: 0.1875,
        conviction: 0.1875,
        uwrAxes: { structure: 0.15, execution: 0, risk: 0.2, insight: 0.4 },
        signalId: "s1",
      },
      SCORE_DECIMAL_KEYS
    ) as Record<string, unknown>;
    expect(projected).toEqual({
      uwrScore: "0.1875",
      conviction: "0.1875",
      uwrAxes: { structure: "0.15", execution: "0", risk: "0.2", insight: "0.4" },
      signalId: "s1",
    });
  });

  it("ALWAYS stringifies declared fields (integer values too) so preimage type never flips", () => {
    const zero = projectDecimalFieldsForHash({ execution: 0 }, SCORE_DECIMAL_KEYS);
    const frac = projectDecimalFieldsForHash({ execution: 0.5 }, SCORE_DECIMAL_KEYS);
    expect(zero).toEqual({ execution: "0" });
    expect(frac).toEqual({ execution: "0.5" });
  });

  it("projects declared keys inside arrays/nested objects (OHLCV candles)", () => {
    const projected = projectDecimalFieldsForHash(
      [
        { timestamp: 1700000000000, open: 100, high: 101.9, low: 99.1, close: 101, volume: 1000 },
      ],
      OHLCV_DECIMAL_KEYS
    );
    expect(projected).toEqual([
      {
        timestamp: 1700000000000, // undeclared integer stays a number
        open: "100",
        high: "101.9",
        low: "99.1",
        close: "101",
        volume: "1000",
      },
    ]);
  });

  it("leaves undeclared fields untouched — undeclared floats are then rejected downstream (fail-closed)", () => {
    const projected = projectDecimalFieldsForHash(
      { score: 0.42, sneaky: 0.99 },
      ENRICHMENT_DECIMAL_KEYS
    );
    expect(projected).toEqual({ score: "0.42", sneaky: 0.99 });
    expect(() => computeCanonicalHashV1(projected, { domainTag: TAG })).toThrow(
      CanonicalHashPolicyError
    );
  });

  it("does not mutate its input", () => {
    const input = { uwrScore: 0.5, nested: { conviction: 0.25 } };
    const snapshot = JSON.parse(JSON.stringify(input));
    projectDecimalFieldsForHash(input, SCORE_DECIMAL_KEYS);
    expect(input).toEqual(snapshot);
  });

  it("decimal strings already present stay strings (never re-coerced)", () => {
    const projected = projectDecimalFieldsForHash(
      { uwrScore: "0.1875", other: "42000.50" },
      SCORE_DECIMAL_KEYS
    );
    expect(projected).toEqual({ uwrScore: "0.1875", other: "42000.50" });
  });

  it("projection + hash is deterministic across repeated runs", () => {
    const value = {
      uwrScore: 0.1875,
      uwrAxes: { structure: 0.15, execution: 0, risk: 0.2, insight: 0.4 },
    };
    const first = computeCanonicalHashV1(
      projectDecimalFieldsForHash(value, SCORE_DECIMAL_KEYS),
      { domainTag: TAG }
    ).value;
    for (let i = 0; i < 5; i += 1) {
      expect(
        computeCanonicalHashV1(projectDecimalFieldsForHash(value, SCORE_DECIMAL_KEYS), {
          domainTag: TAG,
        }).value
      ).toBe(first);
    }
  });

  it("declared key sets are narrow and documented (exact contents)", () => {
    expect([...SCORE_DECIMAL_KEYS]).toEqual([
      "uwrScore",
      "conviction",
      "structure",
      "execution",
      "risk",
      "insight",
    ]);
    expect([...OHLCV_DECIMAL_KEYS]).toEqual(["open", "high", "low", "close", "volume"]);
    expect([...ENRICHMENT_DECIMAL_KEYS]).toEqual([
      "ema20",
      "ema50",
      "rsi14",
      "atr14",
      "emaDistancePct",
      "patternConfidence",
      "score",
      "convictionScore",
      "confidence",
    ]);
  });
});
