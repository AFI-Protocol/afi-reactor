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
// DEM-PRODUCER-PLAN: the retired adapter no longer yields a full scorer
// input (its rrMultiplePlanned synthesis is deleted), so the seam is proven
// against the COMPOSITION REFERENCE — the production assembly (registered
// mapping fragment + residual → composer → rubric) run out-of-band — with the
// mapping resolved by the fixture registration's mappingRef, exactly as boot
// resolves it (never the afi-config example).
import { compositionReference, froggyMappingCarrier } from "../pipeline/support/froggyMapping.js";

const REPO_ROOT = process.cwd();
const FIXTURE_CONFIG_ROOT = path.resolve(REPO_ROOT, "test/pipeline/fixtures/afi-config");
const CONFIG_REL = "registries/analyst-strategies/froggy--trend_pullback_v1--1.0.0.config.json";
const REGISTRATION_REL = "registries/analyst-strategies/froggy--trend_pullback_v1--1.0.0.json";
const FROGGY_KEY = "froggy/trend_pullback_v1@1.0.0";
// The registered 1.0.0 mapping, from the fixture registry (byte-identical to
// the afi-config canonical example; DEM-PRODUCER-PLAN registered 1.1.0 beside it).
const REGISTERED_MAPPING_100 = path.resolve(
  FIXTURE_CONFIG_ROOT,
  "registries/enrichment-mappings/froggy-trend-pullback--1.0.0.json"
);

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
  const doc = JSON.parse(readFileSync(REGISTERED_MAPPING_100, "utf-8"));
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
        // Version-agnostic: remove the whole registry family, whatever version
        // the fixture config names (DEM-PRODUCER-PLAN registered 1.1.0).
        rmSync(join(r, "registries/enrichment-mappings"), { recursive: true, force: true });
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
  const skipIfNoMapping = existsSync(REGISTERED_MAPPING_100) ? describe : describe.skip;

  skipIfNoMapping("with the canonical froggy mapping", () => {
    function carrier(): ResolvedMappingCarrier {
      return froggyMappingCarrier(FIXTURE_CONFIG_ROOT);
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
        technical: {
          emaDistancePct: 1.5,
          isInValueSweetSpot: true,
          atrRegime: "low",
          // DEM-PRODUCER-CANDLE: computed lane facts, bound as REQUIRED.
          brokeEmaWithBody: false,
          haFlatBack: "none",
          haFlatBackConfirmed: false,
          // DEM-PRODUCER-HTF: the lane's higher-timeframe trend facts, which
          // the registered mapping recodes into the rubric's bias vocabulary.
          htf: {
            daily: { timeframe: "1d", trendBias: "bullish", ema20: 101, ema50: 100, barCount: 100 },
            weekly: { timeframe: "1w", trendBias: "bullish", ema20: 102, ema50: 100, barCount: 100 },
          },
        },
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

    /** The production assembly, run out-of-band (the composition reference). */
    function referenceAnalysis(enriched: FroggyEnrichedView) {
      const uwr = getUwrRuntimeConfigForProfile("uwr-weighted-lifts-v0.1");
      return compositionReference(enriched, uwr.config, carrier()).analysis;
    }

    /** A view carrying the technical lane's verified plan facts (DEM-PRODUCER-PLAN). */
    function viewWithPlan(): FroggyEnrichedView {
      const v = view();
      return {
        ...v,
        technical: {
          ...v.technical,
          plan: { entryPrice: 100, stopPrice: 98, firstTargetPrice: 104, rrToFirstTarget: 2, targetCount: 1 },
        },
      };
    }

    it("mapping path output equals the composition reference (no fired defaults when the plan fact is present)", async () => {
      const withMapping = await scorerFroggyTrendPullbackNode.run(viewWithPlan(), ctx(true));
      const a = withMapping.output as { analysis: unknown };
      expect(normalized(a.analysis)).toEqual(normalized(referenceAnalysis(viewWithPlan())));
      expect(withMapping.degradations).toEqual([]);
    });

    it("a plan-less view fires ONLY the rrMultiplePlanned floor default — recorded, never silent (D-DEM-5(3); §9 determination D-5)", async () => {
      const result = await scorerFroggyTrendPullbackNode.run(view(), ctx(true));
      expect(result.degradations).toEqual([{ class: "declared-default-fired", detail: "rrMultiplePlanned" }]);
      // The HTF recodes did NOT fire: this view carries the lane's bias facts.
      const a = result.output as { analysis: { analystScore: { uwrAxes: { risk: number } } } };
      // The rubric floor (rr 1 → 0.2) — a hash-committed, recorded degradation.
      expect(a.analysis.analystScore.uwrAxes.risk).toBe(0.2);
      expect(normalized(a.analysis)).toEqual(normalized(referenceAnalysis(view())));
    });

    it("a fired grandfathered default is a RECORDED degradation (D-DEM-5(3)), never silent", async () => {
      // DEM-PRODUCER-CANDLE: the candle facts are REQUIRED binds, so a bare
      // technical namespace refuses; the grandfather/floor firings are probed
      // with the lane's computed facts present and everything else absent.
      const bare = {
        ...view(),
        technical: { brokeEmaWithBody: false, haFlatBack: "none" as const, haFlatBackConfirmed: false },
        pattern: { patternName: "bull flag" },
      };
      const result = await scorerFroggyTrendPullbackNode.run(bare, ctx(true));
      const classes = (result.degradations ?? []).map((d) => d.class);
      expect(classes).toEqual(Array(7).fill("declared-default-fired"));
      const targets = (result.degradations ?? []).map((d) => d.detail).sort();
      expect(targets).toEqual([
        "atrRegime",
        // DEM-PRODUCER-HTF: no htf block on this bare view, so both recodes
        // fire their declared `absent` member — a RECORDED absence, exactly
        // like every other declared default.
        "dailyBias",
        "distanceFromDailyEmaPct",
        "pulledBackIntoSweetSpot",
        "rrMultiplePlanned",
        "triggerPatternQuality",
        "weeklyBias",
      ]);
      // The composition reference scores the same INPUT VALUES (the
      // grandfather exists so DEM-BIND reproduces today's scored values
      // exactly, D-DEM-5(4); the plan floor is the PLAN slot's declared
      // default).
      const a = result.output as { analysis: unknown };
      expect(normalized(a.analysis)).toEqual(normalized(referenceAnalysis(bare)));
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
