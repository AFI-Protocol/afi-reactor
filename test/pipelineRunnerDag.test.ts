/**
 * Pipeline Runner DAG Tests
 * 
 * Tests for the DAG-aware pipeline runner (runPipelineDag).
 * Uses only internal handlers for fast, self-contained tests.
 */

import { describe, it, expect } from "@jest/globals";
import { runPipelineDag, type PipelineContext } from "../src/services/pipelineRunner.js";
import type { PipelineStage } from "../src/config/froggyPipeline.js";

describe("Pipeline Runner DAG", () => {
  
  it("should execute a simple linear DAG in order", async () => {
    // Define 3 stages: a -> b -> c
    const stages: PipelineStage[] = [
      {
        id: "a",
        label: "Stage A",
        kind: "internal",
        description: "Add 1",
      },
      {
        id: "b",
        label: "Stage B",
        kind: "internal",
        description: "Multiply by 2",
        dependsOn: ["a"],
      },
      {
        id: "c",
        label: "Stage C",
        kind: "internal",
        description: "Subtract 3",
        dependsOn: ["b"],
      },
    ];
    
    // Internal handlers: a: +1, b: *2, c: -3
    const handlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();
    handlers.set("a", async (payload: number) => payload + 1);
    handlers.set("b", async (payload: number) => payload * 2);
    handlers.set("c", async (payload: number) => payload - 3);
    
    // Run pipeline: 1 -> 2 -> 4 -> 1
    const result = await runPipelineDag(
      stages,
      1,
      { logger: () => {} }, // Silent logger
      handlers
    );
    
    // Verify final result
    expect(result.payload).toBe(1); // (1 + 1) * 2 - 3 = 1
    
    // Verify stage metadata
    expect(result.stageMeta).toBeDefined();
    expect(result.stageMeta?.length).toBe(3);
    
    const stageIds = result.stageMeta!.map(s => s.stageId);
    expect(stageIds).toContain("a");
    expect(stageIds).toContain("b");
    expect(stageIds).toContain("c");
    
    // Verify all stages succeeded
    for (const stageMeta of result.stageMeta!) {
      expect(stageMeta.status).toBe("success");
      expect(stageMeta.durationMs).toBeGreaterThanOrEqual(0);
    }
    
    // Verify dependsOn is preserved in metadata
    const stageA = result.stageMeta!.find(s => s.stageId === "a");
    const stageB = result.stageMeta!.find(s => s.stageId === "b");
    const stageC = result.stageMeta!.find(s => s.stageId === "c");
    
    expect(stageA?.dependsOn).toBeUndefined();
    expect(stageB?.dependsOn).toEqual(["a"]);
    expect(stageC?.dependsOn).toEqual(["b"]);
    
    // Verify intermediate payloads
    expect(result.intermediatePayloads).toBeDefined();
    expect(result.intermediatePayloads?.get("a")).toBe(2);  // 1 + 1
    expect(result.intermediatePayloads?.get("b")).toBe(4);  // 2 * 2
    expect(result.intermediatePayloads?.get("c")).toBe(1);  // 4 - 3
  });
  
  it("should execute parallel branches that share a common parent", async () => {
    // Define DAG:
    //       root
    //      /    \
    //  branch1  branch2
    //      \    /
    //       join
    const stages: PipelineStage[] = [
      {
        id: "root",
        label: "Root",
        kind: "internal",
        description: "Start with array",
      },
      {
        id: "branch1",
        label: "Branch 1",
        kind: "internal",
        description: "Add b1",
        dependsOn: ["root"],
      },
      {
        id: "branch2",
        label: "Branch 2",
        kind: "internal",
        description: "Add b2",
        dependsOn: ["root"],
      },
      {
        id: "join",
        label: "Join",
        kind: "internal",
        description: "Merge branches",
        dependsOn: ["branch1", "branch2"],
      },
    ];
    
    // Internal handlers
    const handlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();
    
    handlers.set("root", async (payload: string[]) => {
      return [...payload, "root"];
    });
    
    handlers.set("branch1", async (payload: string[]) => {
      return [...payload, "b1"];
    });
    
    handlers.set("branch2", async (payload: string[]) => {
      return [...payload, "b2"];
    });
    
    handlers.set("join", async (payload: any) => {
      // Expect multi-parent input structure
      expect(payload.parents).toEqual(["branch1", "branch2"]);
      expect(payload.inputs).toBeDefined();
      expect(Object.keys(payload.inputs).sort()).toEqual(["branch1", "branch2"]);

      // Merge both branches
      const branch1Data = payload.inputs.branch1;
      const branch2Data = payload.inputs.branch2;

      return ["joined", ...branch1Data, ...branch2Data];
    });

    // Run pipeline
    const result = await runPipelineDag(
      stages,
      [],
      { logger: () => {} },
      handlers
    );

    // Verify final result
    expect(result.payload).toBeDefined();
    expect(Array.isArray(result.payload)).toBe(true);
    expect(result.payload).toContain("joined");
    expect(result.payload).toContain("root");
    expect(result.payload).toContain("b1");
    expect(result.payload).toContain("b2");

    // Verify all 4 stages executed
    expect(result.stageMeta).toBeDefined();
    expect(result.stageMeta?.length).toBe(4);

    const stageIds = result.stageMeta!.map(s => s.stageId);
    expect(stageIds).toContain("root");
    expect(stageIds).toContain("branch1");
    expect(stageIds).toContain("branch2");
    expect(stageIds).toContain("join");

    // Verify all stages succeeded
    for (const stageMeta of result.stageMeta!) {
      expect(stageMeta.status).toBe("success");
    }

    // Verify join stage saw both parents
    const joinMeta = result.stageMeta!.find(s => s.stageId === "join");
    expect(joinMeta?.dependsOn).toEqual(["branch1", "branch2"]);
  });

  it("should surface cycles or bad dependsOn with a helpful error", async () => {
    // Case A: dependsOn references non-existent stage
    const badRefStages: PipelineStage[] = [
      {
        id: "a",
        kind: "internal",
        dependsOn: ["nonexistent"],
      },
    ];

    const handlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();
    handlers.set("a", async (p) => p);

    await expect(
      runPipelineDag(badRefStages, {}, { logger: () => {} }, handlers)
    ).rejects.toThrow(/unknown stage.*nonexistent/i);

    // Case B: Simple cycle (a -> b -> a)
    const cycleStages: PipelineStage[] = [
      {
        id: "a",
        kind: "internal",
        dependsOn: ["b"],
      },
      {
        id: "b",
        kind: "internal",
        dependsOn: ["a"],
      },
    ];

    handlers.set("b", async (p) => p);

    await expect(
      runPipelineDag(cycleStages, {}, { logger: () => {} }, handlers)
    ).rejects.toThrow(/cycle/i);
  });

  it("should handle multiple sink nodes by returning object with all sink payloads", async () => {
    // Define DAG with 2 sinks:
    //       root
    //      /    \
    //   sink1  sink2
    const stages: PipelineStage[] = [
      {
        id: "root",
        kind: "internal",
      },
      {
        id: "sink1",
        kind: "internal",
        dependsOn: ["root"],
      },
      {
        id: "sink2",
        kind: "internal",
        dependsOn: ["root"],
      },
    ];

    const handlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();
    handlers.set("root", async () => ({ value: 100 }));
    handlers.set("sink1", async (p) => ({ ...p, sink: "sink1" }));
    handlers.set("sink2", async (p) => ({ ...p, sink: "sink2" }));

    const result = await runPipelineDag(
      stages,
      {},
      { logger: () => {} },
      handlers
    );

    // With multiple sinks, result.payload should be an object mapping sink IDs to payloads
    expect(result.payload).toBeDefined();
    expect(typeof result.payload).toBe("object");
    expect(result.payload.sink1).toEqual({ value: 100, sink: "sink1" });
    expect(result.payload.sink2).toEqual({ value: 100, sink: "sink2" });
  });

  it("should handle stages with no dependencies using initialPayload", async () => {
    // Multiple root nodes (no dependencies)
    const stages: PipelineStage[] = [
      {
        id: "root1",
        kind: "internal",
      },
      {
        id: "root2",
        kind: "internal",
      },
    ];

    const handlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();
    handlers.set("root1", async (p) => ({ ...p, from: "root1" }));
    handlers.set("root2", async (p) => ({ ...p, from: "root2" }));

    const result = await runPipelineDag(
      stages,
      { initial: true },
      { logger: () => {} },
      handlers
    );

    // Both roots should receive initialPayload
    expect(result.intermediatePayloads?.get("root1")).toEqual({ initial: true, from: "root1" });
    expect(result.intermediatePayloads?.get("root2")).toEqual({ initial: true, from: "root2" });
  });

  it("should fail-fast when a stage throws an error", async () => {
    const stages: PipelineStage[] = [
      {
        id: "a",
        kind: "internal",
      },
      {
        id: "b",
        kind: "internal",
        dependsOn: ["a"],
      },
    ];

    const handlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();
    handlers.set("a", async () => {
      throw new Error("Stage A failed intentionally");
    });
    handlers.set("b", async (p) => p);

    await expect(
      runPipelineDag(stages, {}, { logger: () => {} }, handlers)
    ).rejects.toThrow("Stage A failed intentionally");
  });

  it("should detect duplicate stage IDs", async () => {
    const stages: PipelineStage[] = [
      { id: "duplicate", kind: "internal" },
      { id: "duplicate", kind: "internal" },
    ];

    const handlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();
    handlers.set("duplicate", async (p) => p);

    await expect(
      runPipelineDag(stages, {}, { logger: () => {} }, handlers)
    ).rejects.toThrow(/duplicate.*stage.*id/i);
  });
});


