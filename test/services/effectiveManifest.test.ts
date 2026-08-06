/**
 * CFG-GOV D-CFG-3(3) — nodeOverrides.enabled:false is lane SELECTION, not a
 * failure: the disabled analysis-lane node and its edges are removed from the
 * effective graph (so the lane is not executed, not bound, and not owed a
 * proof). Disabling any non-lane node stays fail-closed, and a residual graph
 * the executor's structural validation refuses (e.g. the entry disabled)
 * still fails closed — this suite proves all three behaviours over the real
 * froggy v1.3.0 topology.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveManifest } from "../../src/services/graphScoringService.js";
import { validatePipelineGraph } from "../../src/pipeline/executor.js";
import type { ResolvedStrategy } from "../../src/pipeline/registryLoader.js";
import type { PipelineManifest } from "../../src/pipeline/manifestTypes.js";

const FROGGY_MANIFEST_PATH = join(
  __dirname,
  "../pipeline/fixtures/afi-config/registries/pipelines/froggy-trend-pullback--v1.3.0.json"
);

function froggyManifest(): PipelineManifest {
  return JSON.parse(readFileSync(FROGGY_MANIFEST_PATH, "utf8")) as PipelineManifest;
}

/** The minimal ResolvedStrategy slice effectiveManifest reads. */
function resolvedWith(
  pipeline: PipelineManifest,
  nodeOverrides: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>
): ResolvedStrategy {
  return { pipeline, config: { nodeOverrides } } as unknown as ResolvedStrategy;
}

describe("CFG-GOV D-CFG-3(3) — effectiveManifest lane selection", () => {
  it("removes a disabled analysis-lane node AND its edges (deliberate non-selection, never a failure)", () => {
    const manifest = effectiveManifest(resolvedWith(froggyManifest(), { news: { enabled: false } }));
    expect(manifest.nodes.map((n) => n.id)).toEqual([
      "technical",
      "pattern",
      "sentiment",
      "aiml",
      "merge",
      "scorer",
    ]);
    for (const edge of manifest.edges) {
      expect(edge.from).not.toBe("news");
      expect(edge.to).not.toBe("news");
    }
    // The residual graph is still structurally admissible to the executor
    // (reachable, acyclic, single scorer sink) — the run proceeds with the
    // four declared lanes.
    expect(validatePipelineGraph(manifest)).toEqual([]);
  });

  it("still applies config overrides to the remaining nodes", () => {
    const manifest = effectiveManifest(
      resolvedWith(froggyManifest(), {
        news: { enabled: false },
        technical: { config: { limit: 9 } },
      })
    );
    expect(manifest.nodes.find((n) => n.id === "technical")?.config).toMatchObject({ limit: 9 });
  });

  it("REFUSES enabled:false on a non-lane node (merge/scorer are not lane selection)", () => {
    for (const nodeId of ["merge", "scorer"]) {
      expect(() =>
        effectiveManifest(resolvedWith(froggyManifest(), { [nodeId]: { enabled: false } }))
      ).toThrow(/admissible only on an analysis-lane node/);
    }
  });

  it("REFUSES enabled:false naming a node absent from the pipeline", () => {
    expect(() =>
      effectiveManifest(resolvedWith(froggyManifest(), { ghost: { enabled: false } }))
    ).toThrow(/admissible only on an analysis-lane node/);
  });

  it("disabling the ENTRY lane leaves a graph the executor refuses (fail closed, no silent serve)", () => {
    // 'technical' is froggy's entry: removing it orphans the graph. The lane
    // removal itself is admissible (it IS an analysis lane), but the residual
    // graph fails the executor's structural validation before any execution.
    const manifest = effectiveManifest(
      resolvedWith(froggyManifest(), { technical: { enabled: false } })
    );
    expect(validatePipelineGraph(manifest)).not.toEqual([]);
  });

  it("no overrides returns the registered manifest untouched", () => {
    const pipeline = froggyManifest();
    expect(effectiveManifest(resolvedWith(pipeline, {}))).toBe(pipeline);
  });
});
