/**
 * AFI Eliza Demo Endpoint Test
 *
 * Tests the /demo/afi-eliza-demo endpoint to ensure:
 * - All 8 stages run successfully (with parallel enrichment in Pass C)
 * - Stage summaries are returned with correct personas in deterministic order
 * - Response shape is stable and deterministic
 * - isDemo flag is set to true
 *
 * Pass C: The pipeline now uses parallel enrichment branches under the hood:
 * - tech-pattern and sentiment-news run in parallel after structurer
 * - enrichment-adapter joins both branches
 * - Stage summaries maintain conceptual order for client compatibility
 *
 * This test ensures the AFI Eliza Demo is ready for the ElizaOS integration.
 *
 * Uses in-process testing with supertest (no external server required).
 */

import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import app from "../src/server.js";
import type { FroggyPipelineResult } from "../src/services/froggyDemoService.js";

describe("AFI Eliza Demo Endpoint", () => {
  it("should return stage summaries with all 7 stages (canonical USS v1.1 flow)", async () => {
    const response = await request(app)
      .post("/demo/afi-eliza-demo")
      .set("Content-Type", "application/json");

    expect(response.status).toBe(200);

    const result: FroggyPipelineResult = response.body;

    // Verify isDemo flag
    expect(result.isDemo).toBe(true);

    // Verify stage summaries exist
    expect(result.stageSummaries).toBeDefined();
    expect(result.stageSummaries).toHaveLength(7);

    // Verify all 7 stages are present in deterministic order (canonical USS v1.1 flow)
    // No scout stage - USS telemetry deriver replaces scout + structurer
    const expectedStages = [
      { stage: "structurer", persona: "Pixel Rick" },          // USS telemetry deriver
      { stage: "tech-pattern", persona: "Pixel Rick" },        // Parallel branch 1
      { stage: "sentiment-news", persona: "Pixel Rick" },      // Parallel branch 2
      { stage: "enrichment", persona: "Pixel Rick" },          // Multi-parent join
      { stage: "analyst", persona: "Froggy" },
      { stage: "validator", persona: "Val Dook" },
      { stage: "execution", persona: "Execution Sim" },
    ];

    expectedStages.forEach((expected, index) => {
      expect(result.stageSummaries![index].stage).toBe(expected.stage);
      expect(result.stageSummaries![index].persona).toBe(expected.persona);
      expect(result.stageSummaries![index].status).toBe("complete");
      expect(result.stageSummaries![index].summary).toBeDefined();
    });

    // Verify enrichment stage includes enrichmentCategories
    const enrichmentStage = result.stageSummaries!.find(s => s.stage === "enrichment");
    expect(enrichmentStage).toBeDefined();
    expect(enrichmentStage!.enrichmentCategories).toBeDefined();
    expect(enrichmentStage!.enrichmentCategories).toContain("technical");
    expect(enrichmentStage!.enrichmentCategories).toContain("pattern");

    // Verify analyst stage exists
    const analystStage = result.stageSummaries!.find(s => s.stage === "analyst");
    expect(analystStage).toBeDefined();

    // Verify validator stage includes decision
    const validatorStage = result.stageSummaries!.find(s => s.stage === "validator");
    expect(validatorStage).toBeDefined();
    expect(validatorStage!.decision).toBeDefined();
    expect(["approve", "reject", "flag", "abstain"]).toContain(validatorStage!.decision);

    // Verify final validator decision
    expect(result.validatorDecision).toBeDefined();
    expect(result.validatorDecision.decision).toBeDefined();
    expect(result.validatorDecision.uwrConfidence).toBeGreaterThan(0);

    // Verify execution result
    expect(result.execution).toBeDefined();
    // Execution status can be "simulated" (if approved) or "skipped" (if rejected/flagged)
    expect(["simulated", "skipped"]).toContain(result.execution.status);

    // Verify meta fields (derived from USS facts block, not providerRef)
    expect(result.meta).toBeDefined();
    expect(result.meta.symbol).toBe("BTC/USDT"); // From rawUss.facts.symbol (replay-canonical)
    expect(result.meta.timeframe).toBe("1h");
    expect(result.meta.strategy).toBe("froggy_trend_pullback_v1");
    expect(result.meta.direction).toBe("long");

    // Verify that symbol is NOT the strategy name (regression test for facts block)
    // Before facts block, symbol was incorrectly derived from provenance.providerRef
    expect(result.meta.symbol).not.toBe("froggy_trend_pullback_v1");
  });

  it("should return deterministic results for demo mode", async () => {
    // Run the demo twice and verify results are consistent
    const response1 = await request(app)
      .post("/demo/afi-eliza-demo")
      .set("Content-Type", "application/json");

    const response2 = await request(app)
      .post("/demo/afi-eliza-demo")
      .set("Content-Type", "application/json");

    const result1: FroggyPipelineResult = response1.body;
    const result2: FroggyPipelineResult = response2.body;

    // Verify both runs have the same number of stages
    expect(result1.stageSummaries?.length).toBe(result2.stageSummaries?.length);

    // Verify both runs have the same meta fields
    expect(result1.meta.symbol).toBe(result2.meta.symbol);
    expect(result1.meta.timeframe).toBe(result2.meta.timeframe);
    expect(result1.meta.strategy).toBe(result2.meta.strategy);

    // Note: UWR scores and decisions may vary slightly due to randomness in demo mode
    // In production, we'd want to mock the random number generator for full determinism
  });

  it("should include all required fields in response", async () => {
    const response = await request(app)
      .post("/demo/afi-eliza-demo")
      .set("Content-Type", "application/json");

    const result: FroggyPipelineResult = response.body;

    // Verify all required top-level fields
    expect(result.signalId).toBeDefined();
    expect(result.validatorDecision).toBeDefined();
    expect(result.execution).toBeDefined();
    expect(result.meta).toBeDefined();
    expect(result.stageSummaries).toBeDefined();
    expect(result.isDemo).toBe(true);
  });
});

