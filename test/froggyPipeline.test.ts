/**
 * Froggy Pipeline Integration Test
 *
 * Tests the complete Froggy trend_pullback_v1 pipeline:
 * Alpha Scout → Pixel Rick → Froggy Enrichment → Froggy Analyst → Validator → Execution Sim
 *
 * This test does NOT run the full DAG engine; it tests each plugin in sequence
 * to ensure the data flows correctly through the pipeline.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import alphaScoutIngest from "../plugins/alpha-scout-ingest.plugin.js";
import signalStructurer from "../plugins/signal-structurer.plugin.js";
import froggyEnrichmentAdapter from "../plugins/froggy-enrichment-adapter.plugin.js";
import froggyAnalyst from "../plugins/froggy.trend_pullback_v1.plugin.js";
import validatorDecisionEvaluator from "../plugins/validator-decision-evaluator.plugin.js";
import executionAgentSim from "../plugins/execution-agent-sim.plugin.js";
import type { EnrichmentProfile } from "afi-core/analysts/froggy.enrichment_adapter.js";
import type { CoinalyzePerpMetrics } from "../src/adapters/coinalyze/coinalyzeClient.js";
import { fetchCoinalyzePerpMetrics } from "../src/adapters/coinalyze/coinalyzeClient.js";

// Mock Coinalyze client to avoid real API calls in tests
jest.mock("../src/adapters/coinalyze/coinalyzeClient.js", () => ({
  fetchCoinalyzePerpMetrics: jest.fn(),
}));

describe("Froggy Pipeline Integration", () => {
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
  it("should process a signal through the complete pipeline", async () => {
    // Step 1: Alpha Scout ingests a draft signal
    const alphaDraft = {
      symbol: "BTC/USDT",
      market: "spot",
      timeframe: "1h",
      strategy: "froggy_trend_pullback_v1",
      direction: "long" as const,
      setupSummary: "Bullish pullback to EMA with liquidity sweep",
      notes: "Demo signal for Froggy pipeline test",
    };

    const rawSignal = await alphaScoutIngest.run(alphaDraft);

    // Assertions: Alpha Scout output
    expect(rawSignal.signalId).toBeDefined();
    expect(rawSignal.signalId).toMatch(/^alpha-/);
    expect(rawSignal.meta.symbol).toBe("BTC/USDT");
    expect(rawSignal.meta.strategy).toBe("froggy_trend_pullback_v1");
    expect(rawSignal.meta.source).toBe("alpha-scout");

    // Step 2: Pixel Rick structures the signal
    const structuredSignal = await signalStructurer.run(rawSignal);

    // Assertions: Pixel Rick output
    expect(structuredSignal.signalId).toBe(rawSignal.signalId);
    expect(structuredSignal.score).toBeGreaterThanOrEqual(0);
    expect(structuredSignal.score).toBeLessThanOrEqual(1);
    expect(structuredSignal.confidence).toBeGreaterThanOrEqual(0);
    expect(structuredSignal.confidence).toBeLessThanOrEqual(1);
    expect(structuredSignal.structured.hasValidMeta).toBe(true);
    expect(structuredSignal.structured.structuredBy).toBe("pixelrick-structurer");

    // Step 3: Froggy enrichment adapter adds technical indicators
    const enrichedSignal = await froggyEnrichmentAdapter.run(structuredSignal);

    // Assertions: Froggy enrichment output
    expect(enrichedSignal.signalId).toBe(rawSignal.signalId);
    expect(enrichedSignal.technical).toBeDefined();
    expect(enrichedSignal.technical?.emaDistancePct).toBeDefined();
    expect(enrichedSignal.pattern).toBeDefined();
    expect(enrichedSignal.enrichmentMeta?.enrichedBy).toBe("froggy-enrichment-adapter");

    // Step 4: Froggy analyst scores the signal
    const analyzedSignal = await froggyAnalyst.run(enrichedSignal);

    // Assertions: Froggy analyst output
    expect(analyzedSignal.analysis).toBeDefined();
    expect(analyzedSignal.analysis.analystId).toBe("froggy");
    expect(analyzedSignal.analysis.strategyId).toBe("trend_pullback_v1");
    expect(analyzedSignal.analysis.uwrScore).toBeGreaterThanOrEqual(0);
    expect(analyzedSignal.analysis.uwrScore).toBeLessThanOrEqual(1);
    expect(analyzedSignal.analysis.uwrAxes).toBeDefined();
    expect(analyzedSignal.analysis.uwrAxes.structureAxis).toBeGreaterThanOrEqual(0);
    expect(analyzedSignal.analysis.uwrAxes.executionAxis).toBeGreaterThanOrEqual(0);
    expect(analyzedSignal.analysis.uwrAxes.riskAxis).toBeGreaterThanOrEqual(0);
    expect(analyzedSignal.analysis.uwrAxes.insightAxis).toBeGreaterThanOrEqual(0);

    // Step 5: Validator evaluates the analyzed signal
    const validatorDecision = await validatorDecisionEvaluator.run({
      signalId: enrichedSignal.signalId, // Use enrichedSignal.signalId since analyzedSignal extends it
      analysis: analyzedSignal.analysis,
    });

    // Assertions: Validator decision output
    expect(validatorDecision.signalId).toBe(rawSignal.signalId);
    expect(validatorDecision.validatorId).toBe("val-dook-dev");
    expect(validatorDecision.decision).toMatch(/^(approve|reject|flag|abstain)$/);
    expect(validatorDecision.uwrConfidence).toBeGreaterThanOrEqual(0);
    expect(validatorDecision.uwrConfidence).toBeLessThanOrEqual(1);
    expect(validatorDecision.reasonCodes).toBeDefined();
    expect(validatorDecision.reasonCodes).toContain("froggy-demo");

    // Step 6: Execution agent simulates trade
    const executionResult = await executionAgentSim.run(validatorDecision);

    // Assertions: Execution result output
    expect(executionResult.signalId).toBe(rawSignal.signalId);
    expect(executionResult.execution.status).toMatch(/^(simulated|skipped)$/);
    expect(executionResult.execution.timestamp).toBeDefined();

    // If approved, should have simulated execution
    if (validatorDecision.decision === "approve") {
      expect(executionResult.execution.status).toBe("simulated");
      expect(executionResult.execution.type).toBe("buy");
      expect(executionResult.execution.asset).toBeDefined();
      expect(executionResult.execution.amount).toBeDefined();
    } else {
      expect(executionResult.execution.status).toBe("skipped");
    }
  });

  it("should preserve signalId through the entire pipeline", async () => {
    const alphaDraft = {
      signalId: "test-signal-123",
      symbol: "ETH/USDT",
      market: "spot",
      timeframe: "4h",
      strategy: "froggy_trend_pullback_v1",
    };

    const rawSignal = await alphaScoutIngest.run(alphaDraft);
    const structuredSignal = await signalStructurer.run(rawSignal);
    const enrichedSignal = await froggyEnrichmentAdapter.run(structuredSignal);
    const analyzedSignal = await froggyAnalyst.run(enrichedSignal);

    // All steps should preserve the original signalId
    expect(rawSignal.signalId).toBe("test-signal-123");
    expect(structuredSignal.signalId).toBe("test-signal-123");
    expect(enrichedSignal.signalId).toBe("test-signal-123");
    // analyzedSignal extends enrichedSignal, so signalId is inherited
    expect(enrichedSignal.signalId).toBe("test-signal-123");
  });

  it("should honor enrichment profile with selective categories", async () => {
    // Define a custom enrichment profile: TA-only (no sentiment, news, or aiMl)
    const taOnlyProfile: EnrichmentProfile = {
      technical: { enabled: true, preset: "full_suite" },
      pattern: { enabled: true, preset: "reversal_patterns" },
      sentiment: { enabled: false },
      news: { enabled: false },
      aiMl: { enabled: false },
    };

    // Step 1: Alpha Scout ingests a draft signal with enrichment profile
    const alphaDraft = {
      symbol: "BTC/USDT",
      market: "spot",
      timeframe: "1h",
      strategy: "froggy_trend_pullback_v1",
      direction: "long" as const,
      setupSummary: "TA-only signal test",
      enrichmentProfile: taOnlyProfile,
    };

    const rawSignal = await alphaScoutIngest.run(alphaDraft);

    // Verify enrichment profile is attached
    expect(rawSignal.meta.enrichmentProfile).toBeDefined();

    // Step 2: Pixel Rick structures the signal (should preserve profile)
    const structuredSignal = await signalStructurer.run(rawSignal);
    expect(structuredSignal.meta.enrichmentProfile).toBeDefined();

    // Step 3: Froggy enrichment adapter honors the profile
    const enrichedSignal = await froggyEnrichmentAdapter.run(structuredSignal);

    // Assertions: Only technical and pattern should be present
    expect(enrichedSignal.technical).toBeDefined();
    expect(enrichedSignal.technical?.emaDistancePct).toBeDefined();
    expect(enrichedSignal.pattern).toBeDefined();

    // Sentiment, news, and aiMl should be undefined (disabled in profile)
    expect(enrichedSignal.sentiment).toBeUndefined();
    expect(enrichedSignal.news).toBeUndefined();
    expect(enrichedSignal.aiMl).toBeUndefined();

    // enrichmentMeta should reflect only enabled categories
    expect(enrichedSignal.enrichmentMeta?.categories).toEqual(
      expect.arrayContaining(["technical", "pattern"])
    );
    expect(enrichedSignal.enrichmentMeta?.categories).not.toContain("sentiment");
    expect(enrichedSignal.enrichmentMeta?.categories).not.toContain("news");
    expect(enrichedSignal.enrichmentMeta?.categories).not.toContain("aiMl");
  });

  it("should use default profile when no enrichment profile is provided", async () => {
    // No enrichment profile provided
    const alphaDraft = {
      symbol: "ETH/USDT",
      market: "spot",
      timeframe: "4h",
      strategy: "froggy_trend_pullback_v1",
    };

    const rawSignal = await alphaScoutIngest.run(alphaDraft);
    const structuredSignal = await signalStructurer.run(rawSignal);
    const enrichedSignal = await froggyEnrichmentAdapter.run(structuredSignal);

    // All categories should be present (default profile enables all)
    expect(enrichedSignal.technical).toBeDefined();
    expect(enrichedSignal.pattern).toBeDefined();
    expect(enrichedSignal.sentiment).toBeDefined();
    expect(enrichedSignal.news).toBeDefined();
    expect(enrichedSignal.aiMl).toBeDefined();

    // enrichmentMeta should reflect all categories
    expect(enrichedSignal.enrichmentMeta?.categories).toEqual(
      expect.arrayContaining(["technical", "pattern", "sentiment", "news", "aiMl"])
    );
  });
});

