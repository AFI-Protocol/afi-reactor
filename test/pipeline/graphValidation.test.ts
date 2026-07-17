/**
 * Direct negative proofs for the exactly-one-scorer graph invariant
 * (program §9.3 item 15 / afi.pipeline.v1 x-afiConstraints): a zero-scorer
 * and a two-scorer manifest are both refused by validatePipelineGraph with
 * the "exactly one scorer node required" issue. The positive case (a single
 * scorer sink) is exercised by every graph proof and by the boot gate over
 * the seeded registries.
 */
import { jest } from "@jest/globals";

// ccxt's compiled dist pulls ESM-only crypto deps jest cannot parse; the test
// harness's registry module transitively touches the price-feed registry
// (repo idiom — see test/oracle/*.test.ts). No ccxt request is ever issued.
jest.mock("ccxt", () => {
  class UnusedExchange {}
  return {
    __esModule: true,
    default: { blofin: UnusedExchange, coinbase: UnusedExchange },
  };
});

import { validatePipelineGraph } from "../../src/pipeline/executor.js";
import type { PipelineManifest } from "../../src/pipeline/manifestTypes.js";

function baseManifest(): PipelineManifest {
  return {
    schema: "afi.pipeline.v1",
    pipelineId: "scorer-invariant-probe",
    pipelineVersion: "v1.0.0",
    entry: "technical",
    nodes: [
      {
        id: "technical",
        category: "technical",
        pluginId: "afi-analysis-technical",
        pluginVersion: "1.0.0",
        critical: false,
        failurePolicy: "degrade",
      },
      {
        id: "score",
        category: "scorer",
        pluginId: "afi-scorer-froggy-trend-pullback",
        pluginVersion: "1.0.0",
        critical: true,
        failurePolicy: "abort",
      },
    ],
    edges: [{ from: "technical", to: "score" }],
  } as PipelineManifest;
}

describe("exactly-one-scorer invariant — direct negative proofs (§9.3 item 15)", () => {
  it("admits the single-scorer control manifest", () => {
    expect(validatePipelineGraph(baseManifest())).toEqual([]);
  });

  it("refuses a ZERO-scorer manifest", () => {
    const manifest = baseManifest();
    manifest.nodes = manifest.nodes.filter((n) => n.category !== "scorer");
    manifest.edges = [];
    const issues = validatePipelineGraph(manifest);
    expect(issues).toEqual(
      expect.arrayContaining(["exactly one scorer node required, found 0"]),
    );
  });

  it("refuses a TWO-scorer manifest", () => {
    const manifest = baseManifest();
    manifest.nodes.push({
      id: "score-2",
      category: "scorer",
      pluginId: "afi-scorer-froggy-trend-pullback",
      pluginVersion: "1.0.0",
      critical: true,
      failurePolicy: "abort",
    });
    manifest.edges.push({ from: "technical", to: "score-2" });
    const issues = validatePipelineGraph(manifest);
    expect(issues).toEqual(
      expect.arrayContaining(["exactly one scorer node required, found 2"]),
    );
  });
});
