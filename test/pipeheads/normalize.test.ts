/**
 * Tests for the normalize pipehead (m1-normalize-bundle), covering
 * VAL-BUNDLE-001..008. The bundle fans-in the five AnalysisLaneResults into an
 * AnalysisBundle whose `enrichedView` is a FroggyEnrichedView the afi-core
 * scorer consumes verbatim. Determinism is enforced with a frozen clock.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type {
  AnalysisLaneId,
  AnalysisLaneResult,
  PipeheadContext,
} from "../../src/pipeheads/types.js";
import { ANALYSIS_LANE_IDS } from "../../src/pipeheads/types.js";
import { createFrozenClock } from "../../src/pipeheads/clock.js";
import {
  computeEnrichmentHash,
  computeInputHash,
} from "../../src/pipeheads/provenance/builders.js";
import { fanOut, DEFAULT_LANE_RUNNERS, type LaneRunner } from "../../src/pipeheads/fanOut.js";
import {
  normalizeToBundle,
  normalizePipehead,
  extractIdentityFromUss,
  buildEnrichedView,
  NORMALIZE_PIPEHEAD_ID,
  BUNDLE_PROVISIONAL_LANES,
} from "../../src/pipeheads/normalizePipehead.js";

const CANONICAL: AnalysisLaneId[] = [
  "technical-indicators",
  "pattern-recognition",
  "news",
  "social",
  "ai-ml",
];

function loadOhlcv(): AfiCandle[] {
  return JSON.parse(
    readFileSync(join(process.cwd(), "test/pipeheads/fixtures/ohlcv.json"), "utf-8")
  ) as AfiCandle[];
}

function loadRawUss(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(process.cwd(), "test/pipeheads/fixtures/signal.uss.json"), "utf-8")
  ) as Record<string, unknown>;
}

function ctx(rawUss: unknown = loadRawUss(), iso?: string): PipeheadContext {
  return {
    signalId: "btc-usdt-perp-4h-0001",
    rawUss,
    clock: createFrozenClock(iso),
  };
}

async function laneResults(candles: AfiCandle[] = loadOhlcv()): Promise<AnalysisLaneResult[]> {
  return fanOut({ candles }, ctx());
}

describe("normalize pipehead — AnalysisBundle fan-in (VAL-BUNDLE-001..008)", () => {
  it("VAL-BUNDLE-001: bundle.lanes contains all five canonical keys, each mapping to its lane result", async () => {
    const results = await laneResults();
    const bundle = normalizeToBundle(results, loadRawUss());
    expect(Object.keys(bundle.lanes).sort()).toEqual([...CANONICAL].sort());
    for (const lane of CANONICAL) {
      expect(bundle.lanes[lane].lane).toBe(lane);
      const expected = results.find((r) => r.lane === lane)!;
      expect(bundle.lanes[lane]).toEqual(expected);
    }
  });

  it("VAL-BUNDLE-002: provisionalLanes is exactly ['news','social','ai-ml']", async () => {
    const bundle = normalizeToBundle(await laneResults(), loadRawUss());
    expect(bundle.provisionalLanes).toEqual(["news", "social", "ai-ml"]);
    expect(BUNDLE_PROVISIONAL_LANES).toEqual(["news", "social", "ai-ml"]);
  });

  it("VAL-BUNDLE-003: enrichedView is a FroggyEnrichedView (afi-core scorer consumable shape)", async () => {
    const bundle = normalizeToBundle(await laneResults(), loadRawUss());
    // buildEnrichedView is typed `FroggyEnrichedView`, so the bundle's view is
    // statically assignable to the afi-core scorer's input type. The runtime
    // scorer invocation (uwrScore in [0,1] + 4 axes) is exercised by the
    // ts-node ESM driver, since Jest's resolver cannot load the afi-core
    // `./analysts/*` value subpath (no `require`/`default` export condition).
    const enriched: FroggyEnrichedView = bundle.enrichedView as FroggyEnrichedView;
    expect(typeof enriched.signalId).toBe("string");
    expect(enriched.symbol).toBe("BTC/USDT");
    expect(enriched.market).toBe("perp");
    expect(enriched.timeframe).toBe("4h");
    expect(enriched.technical).toBeDefined();
    expect(typeof enriched.technical?.emaDistancePct).toBe("number");
    expect(enriched.pattern).toBeDefined();
    expect(enriched.sentiment).toBeDefined();
    // identity inside the enrichedView matches the bundle identity
    expect(enriched.signalId).toBe(bundle.signalId);
    expect(enriched.symbol).toBe(bundle.symbol);
    expect(enriched.market).toBe(bundle.market);
    expect(enriched.timeframe).toBe(bundle.timeframe);
  });

  it("VAL-BUNDLE-004: social lane maps to enrichedView.sentiment", async () => {
    const results = await laneResults();
    const bundle = normalizeToBundle(results, loadRawUss());
    const enriched = bundle.enrichedView as FroggyEnrichedView;
    const social = bundle.lanes["social"].payload as { score: number; tags: string[] };
    expect(enriched.sentiment?.score).toBe(social.score);
    expect(enriched.sentiment?.tags).toEqual(social.tags);
  });

  it("VAL-BUNDLE-005: wired lanes map to technical and pattern projection sections", async () => {
    const bundle = normalizeToBundle(await laneResults(), loadRawUss());
    const enriched = bundle.enrichedView as FroggyEnrichedView;
    const tech = bundle.lanes["technical-indicators"].payload as {
      emaDistancePct: number;
      ema20: number;
      ema50: number;
      rsi14: number;
      atr14: number;
    };
    const pattern = bundle.lanes["pattern-recognition"].payload as {
      patternName?: string;
      patternConfidence?: number;
    };
    expect(enriched.technical?.emaDistancePct).toBe(tech.emaDistancePct);
    expect(enriched.technical?.indicators?.ema20).toBe(tech.ema20);
    expect(enriched.technical?.indicators?.ema50).toBe(tech.ema50);
    expect(enriched.technical?.indicators?.rsi14).toBe(tech.rsi14);
    expect(enriched.technical?.indicators?.atr14).toBe(tech.atr14);
    expect(enriched.pattern?.patternConfidence ?? null).toBe(pattern.patternConfidence ?? null);
    expect(enriched.pattern?.patternName ?? null).toBe(pattern.patternName ?? null);
  });

  it("VAL-BUNDLE-006: bundle (and its enrichment digest) is deterministic across runs for a fixed fixture", async () => {
    const a = normalizeToBundle(await laneResults(), loadRawUss());
    const b = normalizeToBundle(await laneResults(), loadRawUss());
    expect(a).toEqual(b);
    expect(computeEnrichmentHash(a).value).toBe(computeEnrichmentHash(b).value);
    // a different injected clock must not change the bundle content/hash
    const resultsAltClock = await fanOut({ candles: loadOhlcv() }, ctx(loadRawUss(), "2099-12-31T23:59:59.000Z"));
    const c = normalizeToBundle(resultsAltClock, loadRawUss());
    expect(computeEnrichmentHash(c).value).toBe(computeEnrichmentHash(a).value);
  });

  it("VAL-BUNDLE-007: identity fields equal the validated USS fixture facts (not fabricated)", async () => {
    const rawUss = loadRawUss();
    const bundle = normalizeToBundle(await laneResults(), rawUss);
    const provenance = (rawUss.provenance ?? {}) as Record<string, unknown>;
    const facts = (rawUss.facts ?? {}) as Record<string, unknown>;
    expect(bundle.signalId).toBe(provenance.signalId);
    expect(bundle.signalId).toBe("btc-usdt-perp-4h-0001");
    expect(bundle.symbol).toBe(facts.symbol);
    expect(bundle.market).toBe(facts.market);
    expect(bundle.timeframe).toBe(facts.timeframe);
    expect(bundle.symbol).toBe("BTC/USDT");
    expect(bundle.market).toBe("perp");
    expect(bundle.timeframe).toBe("4h");
  });

  it("VAL-BUNDLE-008: provenance references the validated input (signalId + inputHash)", async () => {
    const rawUss = loadRawUss();
    const bundle = normalizeToBundle(await laneResults(), rawUss);
    const provenance = (rawUss.provenance ?? {}) as Record<string, unknown>;
    expect(bundle.provenance?.signalId).toBe(provenance.signalId);
    expect(bundle.provenance?.inputHash).toBe(computeInputHash(rawUss).value);
    expect(bundle.provenance?.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalize helpers and pipehead", () => {
  it("extractIdentityFromUss carries identity through from the fixture", () => {
    const id = extractIdentityFromUss(loadRawUss());
    expect(id).toEqual({
      signalId: "btc-usdt-perp-4h-0001",
      symbol: "BTC/USDT",
      market: "perp",
      timeframe: "4h",
    });
  });

  it("buildEnrichedView omits a wired section when its lane is degraded but keeps identity", () => {
    const identity = extractIdentityFromUss(loadRawUss());
    const degradedTech: AnalysisLaneResult = {
      lane: "technical-indicators",
      provisional: false,
      payload: { error: true, degraded: true, laneId: "technical-indicators", message: "boom", note: "x" },
    };
    const lanes = {
      "technical-indicators": degradedTech,
      "pattern-recognition": { lane: "pattern-recognition", provisional: false, payload: { patternConfidence: 50 } },
      news: { lane: "news", provisional: true, payload: { hasShockEvent: false } },
      social: { lane: "social", provisional: true, payload: { score: 0.4, tags: ["x"] } },
      "ai-ml": { lane: "ai-ml", provisional: true, payload: { convictionScore: 0.6, direction: "long" } },
    } as Record<AnalysisLaneId, AnalysisLaneResult>;
    const enriched = buildEnrichedView(identity, lanes);
    expect(enriched.signalId).toBe("btc-usdt-perp-4h-0001");
    expect(enriched.technical).toBeUndefined();
    expect(enriched.pattern).toBeDefined();
    expect(enriched.sentiment?.score).toBe(0.4);
  });

  it("normalizePipehead.execute returns an ok normalize result wrapping the bundle, deterministic over clocks", async () => {
    const results = await laneResults();
    const a = await normalizePipehead.execute(results, ctx(loadRawUss(), "2025-01-01T00:00:00.000Z"));
    const b = await normalizePipehead.execute(results, ctx(loadRawUss(), "2099-12-31T23:59:59.000Z"));
    expect(a.pipeheadId).toBe(NORMALIZE_PIPEHEAD_ID);
    expect(a.kind).toBe("normalize");
    expect(a.status).toBe("ok");
    expect(computeEnrichmentHash(a.output).value).toBe(computeEnrichmentHash(b.output).value);
    expect(a.output.lanes["social"]).toBeDefined();
  });

  it("the degraded fault-injected fan-out still yields a five-key bundle", async () => {
    const throwing: Record<AnalysisLaneId, LaneRunner> = {
      ...DEFAULT_LANE_RUNNERS,
      news: () => {
        throw new Error("injected fault in news");
      },
    };
    const results = await fanOut({ candles: loadOhlcv() }, ctx(), throwing);
    const bundle = normalizeToBundle(results, loadRawUss());
    expect(Object.keys(bundle.lanes).sort()).toEqual([...ANALYSIS_LANE_IDS].sort());
    expect(bundle.provisionalLanes).toEqual(["news", "social", "ai-ml"]);
  });
});
