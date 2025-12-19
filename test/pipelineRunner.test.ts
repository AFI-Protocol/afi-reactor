/**
 * Pipeline Runner Tests
 *
 * Tests for the generic pipeline runner, focusing on orchestration metadata propagation.
 */

import { describe, it, expect } from "@jest/globals";
import { runPipeline, type PipelineContext, type StageResult } from "../src/services/pipelineRunner.js";
import type { PipelineStage } from "../src/config/froggyPipeline.js";

describe("Pipeline Runner - Orchestration Metadata", () => {
  
  it("should propagate orchestration fields from stage config to StageResult", async () => {
    // Define a test stage with orchestration metadata
    const testStage: PipelineStage = {
      id: "test-stage",
      label: "Test Stage",
      kind: "internal",
      description: "Test stage with orchestration metadata",
      category: "scout",
      persona: "Alpha",
      
      // Orchestration fields
      timeoutMs: 5000,
      maxRetries: 3,
      retryDelayMs: 1000,
      group: "test-group",
      dependsOn: ["upstream-stage"],
      critical: true,
      tags: ["test", "metadata"],
    };

    // Create a simple internal handler
    const handlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();
    handlers.set("test-stage", async (payload: any) => {
      return { ...payload, processed: true };
    });

    // Run pipeline
    const result = await runPipeline(
      [testStage],
      { input: "test" },
      { logger: () => {} }, // Silent logger
      handlers
    );

    // Verify result
    expect(result.payload).toEqual({ input: "test", processed: true });
    expect(result.stageMeta).toBeDefined();
    expect(result.stageMeta?.length).toBe(1);

    const stageResult = result.stageMeta![0];
    
    // Verify basic fields
    expect(stageResult.stageId).toBe("test-stage");
    expect(stageResult.label).toBe("Test Stage");
    expect(stageResult.kind).toBe("internal");
    expect(stageResult.category).toBe("scout");
    expect(stageResult.persona).toBe("Alpha");
    
    // Verify orchestration fields are propagated
    expect(stageResult.timeoutMs).toBe(5000);
    expect(stageResult.maxRetries).toBe(3);
    expect(stageResult.retryDelayMs).toBe(1000);
    expect(stageResult.group).toBe("test-group");
    expect(stageResult.dependsOn).toEqual(["upstream-stage"]);
    expect(stageResult.critical).toBe(true);
    expect(stageResult.tags).toEqual(["test", "metadata"]);
    
    // Verify execution results
    expect(stageResult.status).toBe("success");
    expect(stageResult.durationMs).toBeGreaterThanOrEqual(0);
    expect(stageResult.error).toBeUndefined();
    expect(stageResult.output).toEqual({ input: "test", processed: true });
  });

  it("should omit orchestration fields when not set in stage config", async () => {
    // Define a minimal test stage without orchestration metadata
    const minimalStage: PipelineStage = {
      id: "minimal-stage",
      label: "Minimal Stage",
      kind: "internal",
    };

    // Create a simple internal handler
    const handlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();
    handlers.set("minimal-stage", async (payload: any) => {
      return { ...payload, minimal: true };
    });

    // Run pipeline
    const result = await runPipeline(
      [minimalStage],
      { input: "minimal" },
      { logger: () => {} }, // Silent logger
      handlers
    );

    // Verify result
    expect(result.stageMeta).toBeDefined();
    expect(result.stageMeta?.length).toBe(1);

    const stageResult = result.stageMeta![0];
    
    // Verify basic fields
    expect(stageResult.stageId).toBe("minimal-stage");
    expect(stageResult.label).toBe("Minimal Stage");
    
    // Verify orchestration fields are undefined (not set)
    expect(stageResult.timeoutMs).toBeUndefined();
    expect(stageResult.maxRetries).toBeUndefined();
    expect(stageResult.retryDelayMs).toBeUndefined();
    expect(stageResult.group).toBeUndefined();
    expect(stageResult.dependsOn).toBeUndefined();
    expect(stageResult.critical).toBeUndefined();
    expect(stageResult.tags).toBeUndefined();
    
    // Verify execution results
    expect(stageResult.status).toBe("success");
    expect(stageResult.output).toEqual({ input: "minimal", minimal: true });
  });

  it("should include orchestration fields in error case", async () => {
    // Define a test stage that will fail
    const failingStage: PipelineStage = {
      id: "failing-stage",
      label: "Failing Stage",
      kind: "internal",
      critical: true,
      tags: ["error-test"],
    };

    // Create a handler that throws
    const handlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();
    handlers.set("failing-stage", async () => {
      throw new Error("Intentional test failure");
    });

    // Run pipeline and expect it to throw
    await expect(
      runPipeline(
        [failingStage],
        { input: "test" },
        { logger: () => {} }, // Silent logger
        handlers
      )
    ).rejects.toThrow("Intentional test failure");
  });
});

