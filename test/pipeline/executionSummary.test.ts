/**
 * Execution summary determinism: timestamp-free canonical object, stable
 * hash under the registered domain tag, operational extras never leak.
 */
import {
  EXECUTION_SUMMARY_SCHEMA,
  buildExecutionSummary,
  computeExecutionSummaryHash,
  type ExecutionSummaryEntry,
} from "../../src/pipeline/executionSummary.js";
import { canonicalize } from "../../src/pipeline/hashing.js";

const entries: ExecutionSummaryEntry[] = [
  { nodeId: "technical", pluginId: "afi-analysis-technical", pluginVersion: "1.0.0", status: "executed" },
  { nodeId: "news", pluginId: "afi-analysis-news", pluginVersion: "1.0.0", status: "skipped" },
  { nodeId: "merge", pluginId: "afi-merge-enriched-view", pluginVersion: "1.0.0", status: "executed" },
  { nodeId: "scorer", pluginId: "afi-scorer-froggy-trend-pullback", pluginVersion: "1.0.0", status: "executed" },
];

describe("execution summary (canonical, timestamp-free)", () => {
  it("builds the governed shape", () => {
    const summary = buildExecutionSummary(entries);
    expect(summary.schema).toBe(EXECUTION_SUMMARY_SCHEMA);
    expect(summary.nodes).toHaveLength(4);
    expect(Object.keys(summary.nodes[0]).sort()).toEqual([
      "nodeId",
      "pluginId",
      "pluginVersion",
      "status",
    ]);
  });

  it("strips operational extras from hash material", () => {
    const withExtras = buildExecutionSummary(
      entries.map((e) => ({ ...e, durationMs: Math.random(), enrichedAt: new Date().toISOString() })) as never
    );
    expect(canonicalize(withExtras)).toBe(canonicalize(buildExecutionSummary(entries)));
    expect(canonicalize(withExtras)).not.toContain("durationMs");
    expect(canonicalize(withExtras)).not.toContain("enrichedAt");
  });

  it("hash is deterministic and carries the registered domain tag", () => {
    const a = computeExecutionSummaryHash(buildExecutionSummary(entries));
    const b = computeExecutionSummaryHash(buildExecutionSummary(entries.map((e) => ({ ...e }))));
    expect(a).toEqual(b);
    expect(a.domainTag).toBe("afi.d2.execution-summary");
    expect(a.canonicalizationVersion).toBe("afi.hash.v1");
    expect(a.value).toMatch(/^[a-f0-9]{64}$/);
  });

  it("order and status are hash material (different run shapes hash differently)", () => {
    const base = computeExecutionSummaryHash(buildExecutionSummary(entries));
    const reordered = computeExecutionSummaryHash(
      buildExecutionSummary([entries[1], entries[0], entries[2], entries[3]])
    );
    const degraded = computeExecutionSummaryHash(
      buildExecutionSummary(entries.map((e, i) => (i === 0 ? { ...e, status: "degraded" as const } : e)))
    );
    expect(reordered.value).not.toBe(base.value);
    expect(degraded.value).not.toBe(base.value);
  });
});
