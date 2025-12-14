/**
 * ESM Import Smoke Test
 *
 * Validates that afi-core package exports work correctly at Node runtime.
 * This test runs against compiled JavaScript (NOT Jest, NOT ts-jest).
 *
 * Purpose:
 * - Verify package.json exports resolve correctly in real Node.js ESM environment
 * - Confirm applyTimeDecay from "afi-core/decay" works without moduleNameMapper
 * - Provide deterministic smoke test for CI/CD pipelines
 */

import { applyTimeDecay } from "afi-core/decay";

/**
 * Run deterministic decay calculation and verify result.
 */
function runSmokeTest(): void {
  const baseScore = 1.0;
  const scoredAt = "2025-01-01T00:00:00.000Z";
  const nowIso = "2025-01-01T01:00:00.000Z"; // 60 minutes later
  const halfLifeMinutes = 60;

  const decayed = applyTimeDecay(baseScore, scoredAt, nowIso, {
    halfLifeMinutes,
  });

  // After one half-life, score should halve
  const expected = 0.5;
  const tolerance = 1e-9;
  const delta = Math.abs(decayed - expected);

  if (delta > tolerance) {
    console.error(
      `❌ ESM Import Smoke Test FAILED: applyTimeDecay returned ${decayed}, expected ${expected} (delta: ${delta})`
    );
    process.exit(1);
  }

  console.log(
    `✅ ESM Import Smoke Test PASSED: applyTimeDecay correctly computed decay (${decayed})`
  );
  process.exit(0);
}

// Run the test
runSmokeTest();

