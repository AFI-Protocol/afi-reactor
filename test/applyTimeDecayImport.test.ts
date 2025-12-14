/**
 * Test that applyTimeDecay can be imported from "afi-core/decay" package export.
 *
 * This test verifies that:
 * 1. Jest can resolve the package export via moduleNameMapper
 * 2. The import matches runtime behavior (package.json exports)
 * 3. The function works correctly when imported this way
 */

import { describe, it, expect } from "@jest/globals";
import { applyTimeDecay } from "afi-core/decay";

describe("applyTimeDecay import from afi-core/decay", () => {
  it("should import and execute applyTimeDecay from package export", () => {
    // Verify the function is imported
    expect(applyTimeDecay).toBeDefined();
    expect(typeof applyTimeDecay).toBe("function");

    // Verify it works correctly
    const baseScore = 1.0;
    const scoredAt = "2025-01-01T00:00:00.000Z";
    const nowIso = "2025-01-01T01:00:00.000Z"; // 60 minutes later
    const decayed = applyTimeDecay(baseScore, scoredAt, nowIso, {
      halfLifeMinutes: 60,
    });

    // After one half-life, score should halve
    expect(decayed).toBeCloseTo(0.5, 10);
  });

  it("should handle edge cases correctly", () => {
    // Test elapsed=0
    const sameTime = "2025-01-01T00:00:00.000Z";
    const noDecay = applyTimeDecay(0.8, sameTime, sameTime, {
      halfLifeMinutes: 60,
    });
    expect(noDecay).toBe(0.8);

    // Test negative elapsed (future-dated signal)
    const futureDecay = applyTimeDecay(
      0.8,
      "2025-01-01T02:00:00.000Z",
      "2025-01-01T01:00:00.000Z",
      { halfLifeMinutes: 60 }
    );
    expect(futureDecay).toBe(0.8); // Should treat as 0 elapsed

    // Test invalid halfLife
    expect(() => {
      applyTimeDecay(0.8, sameTime, sameTime, { halfLifeMinutes: 0 });
    }).toThrow("Invalid halfLifeMinutes");
  });
});

