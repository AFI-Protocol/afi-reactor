/**
 * Froggy DAG Pipeline Integration Test
 *
 * Tests the complete Froggy trend_pullback_v1 pipeline using the DAG-aware runner.
 * This validates that runFroggyTrendPullbackDagFromTradingView produces correct
 * results while respecting stage dependencies.
 *
 * Pass C: FROGGY_TREND_PULLBACK_PIPELINE now uses parallel enrichment branches:
 * - tech-pattern and sentiment-news both depend on signal-structurer (parallel execution)
 * - enrichment-adapter depends on both (multi-parent join)
 *
 * This test verifies:
 * 1. DAG execution produces correct results with parallel enrichment
 * 2. Stage metadata includes correct dependsOn information
 * 3. All stages execute in the correct order (conceptual order for summaries)
 * 4. Final result matches expected shape
 * 5. Parallel dependency graph is correctly configured
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { runFroggyTrendPullbackDagFromTradingView } from "../src/services/froggyDemoService.js";
import type { TradingViewAlertPayload } from "../src/services/froggyDemoService.js";
import { FROGGY_TREND_PULLBACK_PIPELINE } from "../src/config/froggyPipeline.js";
import type { CoinalyzePerpMetrics } from "../src/adapters/coinalyze/coinalyzeClient.js";
import { fetchCoinalyzePerpMetrics } from "../src/adapters/coinalyze/coinalyzeClient.js";

// Mock Coinalyze client to avoid real API calls in tests
jest.mock("../src/adapters/coinalyze/coinalyzeClient.js", () => ({
  fetchCoinalyzePerpMetrics: jest.fn(),
}));

describe("Froggy DAG Pipeline Integration", () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Set up default mock response for Coinalyze
    const mockMetrics: CoinalyzePerpMetrics = {
      fundingRate: 0.0005, // 0.05% - normal regime
      fundingHistory: [0.0004, 0.0005, 0.0006],
      oiUsd: 1000000000,
      oiHistoryUsd: [980000000, 990000000, 1000000000], // +2% change
      longShortRatio: 1.05,
    };

    (fetchCoinalyzePerpMetrics as jest.MockedFunction<typeof fetchCoinalyzePerpMetrics>).mockResolvedValue(mockMetrics);
  });

  it("should execute the full pipeline using DAG runner with stage dependencies", async () => {
    // Build TradingView alert payload
    const tvPayload: TradingViewAlertPayload = {
      symbol: "BTC/USDT",
      market: "spot",
      timeframe: "1h",
      strategy: "froggy_trend_pullback_v1",
      direction: "long",
      setupSummary: "Bullish pullback to EMA with liquidity sweep",
      notes: "DAG pipeline test signal",
    };

    // Run pipeline with stage summaries enabled
    const result = await runFroggyTrendPullbackDagFromTradingView(tvPayload, {
      includeStageSummaries: true,
      isDemo: true,
    });

    // Verify result structure
    expect(result).toBeDefined();
    expect(result.signalId).toBeDefined();
    expect(result.signalId).toMatch(/^alpha-/);

    // Verify validator decision
    expect(result.validatorDecision).toBeDefined();
    expect(result.validatorDecision.decision).toMatch(/^(approve|reject|flag|abstain)$/);
    expect(result.validatorDecision.uwrConfidence).toBeGreaterThanOrEqual(0);
    expect(result.validatorDecision.uwrConfidence).toBeLessThanOrEqual(1);

    // Verify execution result
    expect(result.execution).toBeDefined();
    expect(result.execution.status).toMatch(/^(simulated|skipped)$/);
    expect(result.execution.timestamp).toBeDefined();

    // Verify metadata
    expect(result.meta).toBeDefined();
    expect(result.meta.symbol).toBe("BTC/USDT");
    expect(result.meta.timeframe).toBe("1h");
    expect(result.meta.strategy).toBe("froggy_trend_pullback_v1");
    expect(result.meta.direction).toBe("long");

    // Verify stage summaries (now 8 stages with tech+pattern + sentiment+news split)
    expect(result.stageSummaries).toBeDefined();
    expect(result.stageSummaries?.length).toBe(8);

    const stageNames = result.stageSummaries!.map(s => s.stage);
    expect(stageNames).toContain("scout");
    expect(stageNames).toContain("structurer");
    expect(stageNames).toContain("tech-pattern");
    expect(stageNames).toContain("sentiment-news");
    expect(stageNames).toContain("enrichment");
    expect(stageNames).toContain("analyst");
    expect(stageNames).toContain("validator");
    expect(stageNames).toContain("execution");

    // Verify all stages completed successfully
    for (const stageSummary of result.stageSummaries!) {
      expect(stageSummary.status).toBe("complete");
    }

    // Verify demo marker
    expect(result.isDemo).toBe(true);
  });

  it("should have correct parallel enrichment DAG structure", () => {
    // Verify the pipeline configuration has parallel enrichment branches
    const techPatternStage = FROGGY_TREND_PULLBACK_PIPELINE.find(s => s.id === "froggy-enrichment-tech-pattern");
    const sentimentNewsStage = FROGGY_TREND_PULLBACK_PIPELINE.find(s => s.id === "froggy-enrichment-sentiment-news");
    const adapterStage = FROGGY_TREND_PULLBACK_PIPELINE.find(s => s.id === "froggy-enrichment-adapter");

    // Both enrichment stages should depend only on signal-structurer (parallel branches)
    expect(techPatternStage?.dependsOn).toEqual(["signal-structurer"]);
    expect(sentimentNewsStage?.dependsOn).toEqual(["signal-structurer"]);

    // Adapter should depend on both enrichment stages (multi-parent join)
    expect(adapterStage?.dependsOn).toEqual([
      "froggy-enrichment-tech-pattern",
      "froggy-enrichment-sentiment-news"
    ]);
  });

  it("should work without stage summaries", async () => {
    const tvPayload: TradingViewAlertPayload = {
      symbol: "ETH/USDT",
      market: "perp",
      timeframe: "4h",
      strategy: "froggy_trend_pullback_v1",
      direction: "short",
      setupSummary: "Bearish rejection at resistance",
    };

    const result = await runFroggyTrendPullbackDagFromTradingView(tvPayload, {
      includeStageSummaries: false,
      isDemo: true,
    });

    expect(result).toBeDefined();
    expect(result.signalId).toBeDefined();
    expect(result.validatorDecision).toBeDefined();
    expect(result.execution).toBeDefined();
    expect(result.stageSummaries).toBeUndefined();
  });
});

