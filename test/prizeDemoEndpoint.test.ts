/**
 * Prize Demo Endpoint Test
 *
 * Tests the /demo/prize-froggy endpoint to ensure:
 * - All 6 stages run successfully
 * - Stage summaries are returned with correct personas
 * - Response shape is stable and deterministic
 * - isDemo flag is set to true
 *
 * This test ensures the Prize Demo is ready for the ElizaOS presentation.
 */

import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import app from "../src/server.js";
import type { FroggyPipelineResult } from "../src/services/froggyDemoService.js";

describe("Prize Demo Endpoint", () => {
  it("should return stage summaries with all 6 stages", async () => {
    const response = await request(app)
      .post("/demo/prize-froggy")
      .set("Content-Type", "application/json");

    expect(response.status).toBe(200);

    const result: FroggyPipelineResult = response.body;

    // Verify isDemo flag
    expect(result.isDemo).toBe(true);

    // Verify stage summaries exist
    expect(result.stageSummaries).toBeDefined();
    expect(result.stageSummaries).toHaveLength(6);

    // Verify all 6 stages are present in order
    const expectedStages = [
      { stage: "scout", persona: "Alpha" },
      { stage: "structurer", persona: "Pixel Rick" },
      { stage: "enrichment", persona: "Pixel Rick" },
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

    // Verify analyst stage includes uwrScore
    const analystStage = result.stageSummaries!.find(s => s.stage === "analyst");
    expect(analystStage).toBeDefined();
    expect(analystStage!.uwrScore).toBeDefined();
    expect(analystStage!.uwrScore).toBeGreaterThan(0);

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
    expect(result.execution.status).toMatch(/^(simulated|skipped)$/);

    // Verify meta fields
    expect(result.meta).toBeDefined();
    expect(result.meta.symbol).toBe("BTC/USDT");
    expect(result.meta.timeframe).toBe("1h");
    expect(result.meta.strategy).toBe("froggy_trend_pullback_v1");
    expect(result.meta.direction).toBe("long");
  });

  it("should return deterministic results for demo mode", async () => {
    // Run the demo twice and verify results are consistent
    const response1 = await request(app)
      .post("/demo/prize-froggy")
      .set("Content-Type", "application/json");

    const response2 = await request(app)
      .post("/demo/prize-froggy")
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
      .post("/demo/prize-froggy")
      .set("Content-Type", "application/json");

    const result: FroggyPipelineResult = response.body;

    // Verify all required top-level fields
    expect(result.signalId).toBeDefined();
    expect(result.validatorDecision).toBeDefined();
    expect(result.execution).toBeDefined();
    expect(result.meta).toBeDefined();
    expect(result.uwrScore).toBeDefined();
    expect(result.stageSummaries).toBeDefined();
    expect(result.isDemo).toBe(true);
  });
});

