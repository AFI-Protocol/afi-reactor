/**
 * DEM-BIND (c), reworked at (e2): per-strategy enrichment-mapping resolution —
 * fail-closed boot, the bounded ctx.mapping carrier, and the seam's
 * byte-equivalence against the adapter export (the sanctioned test-side
 * oracle, ruling R1 — the legacy in-node branch is gone).
 *
 * DEM-GOV §9 slot DEM-BIND (owner-authorized 2026-08-22), clauses D-DEM-2(6)
 * (fail-closed resolution; no built-in mapping, no code-path fallback) and
 * D-DEM-5(3) (a fired declared default is recorded, never silent). The
 * ctx.mapping carrier is authorized by the slot's "resolution seam" scope item
 * exactly as CFG-GOV's ctx.uwr was (precedent: uwrPerStrategyResolution).
 */

import { describe, it, expect } from "@jest/globals";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import {
  validateRuntimeConfig,
  RuntimeConfigValidationError,
} from "../../src/pipeline/registryLoader.js";
import { computeAnalystConfigHash } from "../../src/pipeline/hashing.js";
import { builtinPluginRegistry } from "../../src/pipeline/pluginRegistry.js";
import { buildProviderRuntime } from "../../src/providers/index.js";
import { scorerFroggyTrendPullbackNode } from "../../src/pipeline/nodes/scorerFroggyTrendPullback.js";
import { getUwrRuntimeConfigForProfile } from "../../src/config/uwrRuntimeProfile.js";
import {
  SILENT_NODE_LOGGER,
  type NodeRunContext,
  type ResolvedMappingCarrier,
} from "../../src/pipeline/nodeSdk.js";
import type { FroggyEnrichedView } from "../../node_modules/afi-core/analysts/froggy.enrichment_adapter.js";
// DEM-BIND (e2) seam-test rework (ruling R1): the adapter's expressible half
// survives as the TEST-SIDE byte-equivalence oracle — the export the FLPR
// guards and the golden harness already sanction. The live path composes
// fragment+residual only; equivalence is proven against the adapter export
// imported directly here, never via a removed legacy branch.
import { buildFroggyTrendPullbackInputFromEnriched } from "../../node_modules/afi-core/analysts/froggy.enrichment_adapter.js";
import { scoreFroggyTrendPullback } from "../../node_modules/afi-core/analysts/froggy.trend_pullback_v1.js";

const REPO_ROOT = process.cwd();
const FIXTURE_CONFIG_ROOT = path.resolve(REPO_ROOT, "test/pipeline/fixtures/afi-config");
const CONFIG_REL = "registries/analyst-strategies/froggy--trend_pullback_v1--1.0.0.config.json";
const REGISTRATION_REL = "registries/analyst-strategies/froggy--trend_pullback_v1--1.0.0.json";
const CANONICAL_MAPPING = path.resolve(
  REPO_ROOT,
  "node_modules/afi-config/examples/enrichment-mapping/v1/enrichment-mapping.example.json"
);
const FROGGY_KEY = "froggy/trend_pullback_v1@1.0.0";

/** The production plugin registry over an empty provider runtime (binding only). */
function testBuiltinRegistry() {
  return builtinPluginRegistry(buildProviderRuntime());
}

function scratchRoot(mutate?: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "afi-mapping-seam-"));
  cpSync(FIXTURE_CONFIG_ROOT, root, { recursive: true });
  mutate?.(root);
  return root;
}

function editJson(root: string, rel: string, edit: (doc: any) => void): void {
  const p = join(root, rel);
  const doc = JSON.parse(readFileSync(p, "utf-8"));
  edit(doc);
  writeFileSync(p, JSON.stringify(doc, null, 2));
}

function repinConfigHash(root: string): void {
  const config = JSON.parse(readFileSync(join(root, CONFIG_REL), "utf-8"));
  editJson(root, REGISTRATION_REL, (reg) => {
    reg.analystConfigHash = computeAnalystConfigHash(config);
  });
}

function addMappingRef(root: string): void {
  editJson(root, CONFIG_REL, (config) => {
    config.mappingRef = { mappingId: "froggy-trend-pullback", version: "1.0.0" };
  });
  repinConfigHash(root);
}

/** DEM-BIND (d′): the fixture tree now SHIPS with mappingRef + the registered
 * mapping — absence cases are exercised by removal. */
function removeMappingRef(root: string): void {
  editJson(root, CONFIG_REL, (config) => {
    delete config.mappingRef;
  });
  repinConfigHash(root);
}

function registerFroggyMapping(root: string, mutateDoc?: (doc: any) => void): void {
  const dir = join(root, "registries/enrichment-mappings");
  mkdirSync(dir, { recursive: true });
  const doc = JSON.parse(readFileSync(CANONICAL_MAPPING, "utf-8"));
  mutateDoc?.(doc);
  writeFileSync(join(dir, "froggy-trend-pullback--1.0.0.json"), JSON.stringify(doc, null, 2));
}

function bootRefusal(root: string, pattern: RegExp): void {
  try {
    expect(() =>
      validateRuntimeConfig({ pluginRegistry: testBuiltinRegistry(), configRoot: root })
    ).toThrow(RuntimeConfigValidationError);
    expect(() =>
      validateRuntimeConfig({ pluginRegistry: testBuiltinRegistry(), configRoot: root })
    ).toThrow(pattern);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("D-DEM-2(6): fail-closed mapping resolution at boot", () => {
  it("the SHIPPED fixture tree resolves froggy's registered mapping (d′ state)", () => {
    const validated = validateRuntimeConfig({
      pluginRegistry: testBuiltinRegistry(),
      configRoot: FIXTURE_CONFIG_ROOT,
    });
    const mapping = validated.strategies.get(FROGGY_KEY)!.mapping!;
    expect(mapping.mappingId).toBe("froggy-trend-pullback");
  });

  it("a config WITHOUT mappingRef refuses boot (required since the final bounded step)", () => {
    // DEM-BIND (e2): the (c)-era optional-tolerance case, inverted — the
    // re-vendored governed schema requires mappingRef, so absence is a
    // schema-layer boot refusal (D-DEM-2(5)(e), fail-closed D-DEM-2(6)).
    bootRefusal(scratchRoot(removeMappingRef), /mappingRef/);
  });

  it("mappingRef with NO registered document refuses boot — never a silent skip", () => {
    bootRefusal(
      scratchRoot((r) => {
        rmSync(join(r, "registries/enrichment-mappings/froggy-trend-pullback--1.0.0.json"));
      }),
      /does not resolve.*fail-closed, D-DEM-2\(6\)/
    );
  });

  it("a schema-invalid mapping document refuses boot", () => {
    const root = scratchRoot((r) => {
      addMappingRef(r);
      registerFroggyMapping(r, (doc) => {
        delete doc.bindings;
      });
    });
    bootRefusal(root, /enrichment mapping/);
  });

  it("a document whose identity mismatches the ref refuses boot", () => {
    const root = scratchRoot((r) => {
      addMappingRef(r);
      registerFroggyMapping(r, (doc) => {
        doc.version = "1.0.1";
      });
    });
    bootRefusal(root, /does not match mappingRef/);
  });

  it("a valid registration resolves and carries the AJV-validated document", () => {
    const root = scratchRoot((r) => {
      addMappingRef(r);
      registerFroggyMapping(r);
    });
    try {
      const validated = validateRuntimeConfig({
        pluginRegistry: testBuiltinRegistry(),
        configRoot: root,
      });
      const mapping = validated.strategies.get(FROGGY_KEY)!.mapping!;
      expect(mapping.mappingId).toBe("froggy-trend-pullback");
      expect(mapping.version).toBe("1.0.0");
      expect(Object.keys(mapping.doc.bindings as Record<string, unknown>).sort()).toEqual([
        "atrRegime",
        "distanceFromDailyEmaPct",
        "pulledBackIntoSweetSpot",
        "triggerPatternQuality",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the ctx.mapping carrier is bounded: the scorer node is its sole reader", () => {
  function scanTsTree(dir: string, matches: (content: string) => boolean): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          walk(full);
        } else if (entry.name.endsWith(".ts")) {
          if (matches(readFileSync(full, "utf8"))) {
            out.push(path.relative(REPO_ROOT, full));
          }
        }
      }
    };
    walk(dir);
    return out;
  }

  it("only the scorer node reads ctx.mapping / context.mapping in src/", () => {
    const SOLE_READER = "src/pipeline/nodes/scorerFroggyTrendPullback.ts";
    const offenders = scanTsTree(path.resolve(REPO_ROOT, "src"), (content) =>
      /ctx\.mapping|context\.mapping/.test(content)
    ).filter((rel) => rel !== SOLE_READER);
    expect(offenders).toEqual([]);
  });
});

describe("the seam: fragment+residual equals the legacy path; fired defaults are recorded", () => {
  const skipIfNoMapping = existsSync(CANONICAL_MAPPING) ? describe : describe.skip;

  skipIfNoMapping("with the canonical froggy mapping", () => {
    function carrier(): ResolvedMappingCarrier {
      return {
        mappingId: "froggy-trend-pullback",
        version: "1.0.0",
        doc: JSON.parse(readFileSync(CANONICAL_MAPPING, "utf-8")),
      };
    }

    function ctx(withMapping: boolean): NodeRunContext {
      process.env.AFI_UWR_PROFILE_SOURCE = "builtin";
      return {
        signal: {
          schema: "afi.usignal.v1.1",
          provenance: {
            source: "test",
            providerId: "mapping-seam-test-provider",
            signalId: "sig-mapping-seam-test",
          },
        },
        config: {},
        logger: SILENT_NODE_LOGGER,
        abort: new AbortController().signal,
        uwr: getUwrRuntimeConfigForProfile("uwr-weighted-lifts-v0.1"),
        ...(withMapping ? { mapping: carrier() } : {}),
      };
    }

    function view(): FroggyEnrichedView {
      return {
        signalId: "sig-mapping-seam-test",
        symbol: "BTCUSDT",
        market: "crypto",
        timeframe: "4h",
        technical: { emaDistancePct: 1.5, isInValueSweetSpot: true, atrRegime: "low" },
        pattern: { patternName: "bull flag", patternConfidence: 80 },
        sentiment: { score: 0.4, tags: ["liquidity sweep"] },
      };
    }

    function normalized(analysis: unknown) {
      const clone = JSON.parse(JSON.stringify(analysis)) as {
        analystScore?: Record<string, unknown>;
      };
      if (clone.analystScore) delete clone.analystScore.scoredAt;
      return clone;
    }

    /** The adapter export, applied as the sanctioned test-side oracle (R1). */
    function adapterOracleAnalysis(enriched: FroggyEnrichedView) {
      const uwr = getUwrRuntimeConfigForProfile("uwr-weighted-lifts-v0.1");
      return scoreFroggyTrendPullback(
        buildFroggyTrendPullbackInputFromEnriched(enriched),
        uwr.config,
        enriched
      );
    }

    it("mapping path output is byte-identical to the adapter oracle (no fired defaults)", async () => {
      const withMapping = await scorerFroggyTrendPullbackNode.run(view(), ctx(true));
      const a = withMapping.output as { analysis: unknown };
      expect(normalized(a.analysis)).toEqual(normalized(adapterOracleAnalysis(view())));
      expect(withMapping.degradations).toEqual([]);
    });

    it("a fired grandfathered default is a RECORDED degradation (D-DEM-5(3)), never silent", async () => {
      const bare = {
        ...view(),
        technical: {},
        pattern: { patternName: "bull flag" },
      };
      const result = await scorerFroggyTrendPullbackNode.run(bare, ctx(true));
      const classes = (result.degradations ?? []).map((d) => d.class);
      expect(classes).toEqual([
        "declared-default-fired",
        "declared-default-fired",
        "declared-default-fired",
        "declared-default-fired",
      ]);
      const targets = (result.degradations ?? []).map((d) => d.detail).sort();
      expect(targets).toEqual([
        "atrRegime",
        "distanceFromDailyEmaPct",
        "pulledBackIntoSweetSpot",
        "triggerPatternQuality",
      ]);
      // The adapter oracle scores the same INPUT VALUES (the grandfather
      // exists so DEM-BIND reproduces today's scored values exactly,
      // D-DEM-5(4)).
      const a = result.output as { analysis: unknown };
      expect(normalized(a.analysis)).toEqual(normalized(adapterOracleAnalysis(bare)));
    });

    it("an absent resolved mapping yields NO determination (D-DEM-2(6), D-DEM-5(7))", async () => {
      // DEM-BIND (e2): the legacy branch is gone — the node refuses exactly
      // as it refuses without the resolved UWR config. No fallback exists.
      await expect(scorerFroggyTrendPullbackNode.run(view(), ctx(false))).rejects.toThrow(
        /no resolved enrichment mapping.*fail-closed/
      );
    });
  });
});
