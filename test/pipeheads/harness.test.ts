/**
 * Tests for the full-DAG harness (District 2 M2 surface), covering
 * VAL-PIPEHEAD-001, VAL-PIPEHEAD-002, VAL-HARNESS-001, VAL-HARNESS-002,
 * VAL-SCHEMA-001 and VAL-SCHEMA-005.
 *
 * The harness wires the pipeheads in the fixed order
 * validate -> fan-out -> normalize -> envelope -> score -> provenance and
 * returns a single aggregate whose OUTWARD artifacts are D2-native:
 * { envelope, scoredSignal, provenanceRecord, replayProfile } (+ clearly
 * marked internal intermediates for tests). On a schema-validation failure it
 * short-circuits gracefully (structured failure surfaced as a value, no
 * uncaught throw) and emits NO downstream artifacts.
 *
 * Runtime note (mirrors scoring.test.ts): Jest's resolver cannot load the
 * afi-core `./analysts/*` VALUE subpath, so these tests inject a deterministic
 * stub scorer. The REAL afi-core scorer is exercised end-to-end by the
 * spawned-CLI suites (the same resolution path as the CLI).
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import type {
  AnalysisLaneResult,
  InternalScoringResult,
  PipeheadContext,
} from "../../src/pipeheads/types.js";
import { createFrozenClock, FROZEN_CLOCK_ISO } from "../../src/pipeheads/clock.js";
import { schemaValidationPipehead } from "../../src/pipeheads/schemaValidationPipehead.js";
import { fanOut } from "../../src/pipeheads/fanOut.js";
import { normalizePipehead, normalizeToBundle } from "../../src/pipeheads/normalizePipehead.js";
import {
  createScoringPipehead,
  buildInternalScoringResult,
  type FroggyScorer,
} from "../../src/pipeheads/scoringPipehead.js";
import { technicalLane } from "../../src/pipeheads/lanes/technicalLane.js";
import { patternLane } from "../../src/pipeheads/lanes/patternLane.js";
import { newsLane } from "../../src/pipeheads/lanes/newsLane.js";
import { socialLane } from "../../src/pipeheads/lanes/socialLane.js";
import { aimlLane } from "../../src/pipeheads/lanes/aimlLane.js";
import {
  envelopePipehead,
  buildEnvelopeFromBundle,
} from "../../src/pipeheads/provenance/envelopePipehead.js";
import { provenancePipehead } from "../../src/pipeheads/provenance/provenancePipehead.js";
import {
  computeEnrichmentHash,
  computeInputHash,
  computeScoredOutputHash,
} from "../../src/pipeheads/provenance/builders.js";
import {
  runPipeheadHarness,
  isHarnessFailure,
  HARNESS_ID,
  type HarnessAggregate,
} from "../../src/pipeheads/harness.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const SIGNAL_ID = "btc-usdt-perp-4h-0001";

type UwrAxes = InternalScoringResult["uwrAxes"];
const STUB_AXES: UwrAxes = { structure: 0.15, execution: 0, risk: 0.2, insight: 0.4 };

function mean(axes: UwrAxes): number {
  return (axes.structure + axes.execution + axes.risk + axes.insight) / 4;
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), rel), "utf-8")) as T;
}

function loadRawUss(): Record<string, unknown> {
  return loadJson<Record<string, unknown>>("test/pipeheads/fixtures/signal.uss.json");
}

function loadOhlcv(): AfiCandle[] {
  return loadJson<AfiCandle[]>("test/pipeheads/fixtures/ohlcv.json");
}

/**
 * Deterministic stub afi-core score result, so the FULL aggregate is byte-stable
 * across runs even though the real scorer embeds its own wall-clock `scoredAt`
 * (which the internal carrier holds verbatim and the hashes exclude).
 * `embeddedScoredAt` models that afi-core-injected wall-clock so a test can vary
 * it independently of our fixed clock and prove it is excluded from every
 * content hash.
 */
function fakeScoreResult(
  axes: UwrAxes = STUB_AXES,
  embeddedScoredAt = "2024-06-01T12:34:56.789Z"
): FroggyTrendPullbackScore {
  const uwrScore = mean(axes);
  return {
    analystScore: {
      analystId: "froggy",
      strategyId: "trend_pullback_v1",
      strategyVersion: "1.0.0",
      direction: "neutral",
      riskBucket: "medium",
      conviction: uwrScore,
      uwrAxes: { ...axes },
      uwrScore,
      scoredAt: embeddedScoredAt,
    },
    notes: ["stub note"],
  } as unknown as FroggyTrendPullbackScore;
}

function stubScorer(axes: UwrAxes = STUB_AXES): FroggyScorer {
  return () => fakeScoreResult(axes);
}

/**
 * A deterministic stub scorer whose embedded afi-core `analystScore.scoredAt`
 * wall-clock is set explicitly (modelling the read-only afi-core field our fixed
 * clock cannot reach), holding everything else constant.
 */
function stubScorerWithEmbeddedScoredAt(
  embeddedScoredAt: string,
  axes: UwrAxes = STUB_AXES
): FroggyScorer {
  return () => fakeScoreResult(axes, embeddedScoredAt);
}

function ctx(rawUss: unknown = loadRawUss(), iso?: string): PipeheadContext {
  return { signalId: SIGNAL_ID, rawUss, clock: createFrozenClock(iso) };
}

async function runOk(iso?: string): Promise<HarnessAggregate> {
  return runOkWith(stubScorer(), iso);
}

async function runOkWith(scorer: FroggyScorer, iso?: string): Promise<HarnessAggregate> {
  const result = await runPipeheadHarness(
    { rawUss: loadRawUss(), candles: loadOhlcv() },
    { clock: createFrozenClock(iso), scorer }
  );
  if (isHarnessFailure(result)) {
    throw new Error(`expected a successful harness aggregate: ${JSON.stringify(result)}`);
  }
  return result;
}

/** The four OUTWARD D2 artifacts of an aggregate (order-stable serialization). */
function outwardArtifacts(agg: HarnessAggregate): unknown[] {
  return [agg.envelope, agg.scoredSignal, agg.provenanceRecord, agg.replayProfile];
}

describe("harness — full-DAG assembly (VAL-HARNESS-001, VAL-SCHEMA-001)", () => {
  it("VAL-SCHEMA-001: a valid fixture proceeds end-to-end producing the D2 artifact set", async () => {
    const agg = await runOk();
    expect(agg.ok).toBe(true);
    expect(agg.validation.ok).toBe(true);
    expect(agg.envelope).toBeDefined();
    expect(agg.scoredSignal).toBeDefined();
    expect(agg.provenanceRecord).toBeDefined();
    expect(agg.replayProfile).toBeDefined();
    // internal intermediates are present and clearly segregated
    expect(agg.internal.bundle).toBeDefined();
    expect(agg.internal.scored).toBeDefined();
  });

  it("VAL-HARNESS-001: one call returns all four outward D2 artifacts", async () => {
    const agg = await runOk();
    expect(Object.keys(agg)).toEqual(
      expect.arrayContaining([
        "envelope",
        "scoredSignal",
        "provenanceRecord",
        "replayProfile",
        "internal",
      ])
    );
    // schema self-identification
    expect(agg.envelope.schema).toBe("afi.analyst-input-envelope.v1");
    expect(agg.scoredSignal.schema).toBe("afi.scored-signal.v1");
    expect(agg.provenanceRecord.schema).toBe("afi.provenance-record.v1");
    expect(agg.replayProfile.schema).toBe("afi.replay-profile.v1");
  });

  it("VAL-HARNESS-001: artifacts share one signalId", async () => {
    const agg = await runOk();
    expect(agg.envelope.signalId).toBe(SIGNAL_ID);
    expect(agg.scoredSignal.signalId).toBe(SIGNAL_ID);
    expect(agg.provenanceRecord.signalId).toBe(SIGNAL_ID);
    expect(agg.internal.bundle.signalId).toBe(SIGNAL_ID);
    expect(agg.internal.scored.signalId).toBe(SIGNAL_ID);
  });

  it("VAL-HARNESS-001: provenance hashes reference the prior steps (input/enrichment/output linkage)", async () => {
    const agg = await runOk();
    const record = agg.provenanceRecord;
    expect(record.inputHash.value).toBe(agg.internal.bundle.provenance?.inputHash);
    expect(record.inputHash).toEqual(computeInputHash(loadRawUss()));
    expect(record.enrichmentHash).toEqual(computeEnrichmentHash(agg.internal.bundle));
    expect(record.outputHash).toEqual(computeScoredOutputHash(agg.scoredSignal));
    expect(record.inputHash.value).toMatch(HEX_64);
    expect(record.enrichmentHash?.value).toMatch(HEX_64);
    expect(record.outputHash.value).toMatch(HEX_64);
    // domain separation across the three surfaces
    expect(record.inputHash.domainTag).toBe("afi.d2.signal-input");
    expect(record.enrichmentHash?.domainTag).toBe("afi.d2.enrichment-bundle");
    expect(record.outputHash.domainTag).toBe("afi.d2.scored-output");
  });

  it("VAL-HARNESS-001: scoring values are consistent across the internal carrier and the outward projection", async () => {
    const agg = await runOk();
    expect(agg.scoredSignal.uwrScore).toBe(agg.internal.scored.uwrScore);
    expect(agg.scoredSignal.uwrAxes).toEqual(agg.internal.scored.uwrAxes);
    expect(agg.envelope.strategyLocalView).toEqual(agg.internal.bundle.enrichedView);
    expect(agg.internal.bundle.provisionalLanes).toEqual(["news", "social", "ai-ml"]);
    // envelope lane provenance mirrors the wired/provisional split
    const provisional = (agg.envelope.enrichmentProvenance ?? [])
      .filter((lane) => lane.provisional)
      .map((lane) => lane.laneId);
    expect(provisional).toEqual(["news", "social", "ai-ml"]);
  });

  it("exposes a stable harness id", () => {
    expect(typeof HARNESS_ID).toBe("string");
    expect(HARNESS_ID.length).toBeGreaterThan(0);
  });
});

describe("harness — structured-failure short-circuit (VAL-PIPEHEAD-002, VAL-SCHEMA-005)", () => {
  const malformed: Array<{ name: string; rawUss: unknown }> = [
    { name: "missing provenance.signalId", rawUss: { schema: "afi.usignal.v1.1", provenance: { source: "x", providerId: "y" }, facts: {} } },
    { name: "missing provenance block", rawUss: { schema: "afi.usignal.v1.1", facts: {} } },
    { name: "wrong schema id", rawUss: { schema: "afi.usignal.v1.0", provenance: { source: "x", providerId: "y", signalId: "z" }, facts: {} } },
    { name: "not an object", rawUss: 42 },
  ];

  for (const { name, rawUss } of malformed) {
    it(`VAL-SCHEMA-005: ${name} -> structured failure, no throw, no downstream artifacts`, async () => {
      const result = await runPipeheadHarness(
        { rawUss, candles: loadOhlcv() },
        { scorer: stubScorer() }
      );
      expect(isHarnessFailure(result)).toBe(true);
      if (!isHarnessFailure(result)) return;
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("validation");
      // VAL-PIPEHEAD-002 / VAL-SCHEMA-006: structured field-level errors, not a vague boolean
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
      for (const e of result.errors) {
        expect(typeof e.field).toBe("string");
        expect(e.field.length).toBeGreaterThan(0);
        expect(typeof e.message).toBe("string");
        expect(e.message.length).toBeGreaterThan(0);
      }
      // VAL-SCHEMA-005: no downstream D2 artifact present on a failure
      const asAny = result as unknown as Record<string, unknown>;
      expect(asAny.envelope).toBeUndefined();
      expect(asAny.scoredSignal).toBeUndefined();
      expect(asAny.provenanceRecord).toBeUndefined();
      expect(asAny.replayProfile).toBeUndefined();
      expect(asAny.internal).toBeUndefined();
    });
  }

  it("VAL-PIPEHEAD-002: a malformed input never throws (resolves to a value)", async () => {
    await expect(
      runPipeheadHarness({ rawUss: null, candles: loadOhlcv() }, { scorer: stubScorer() })
    ).resolves.toBeDefined();
  });
});

describe("harness — full-aggregate determinism (VAL-HARNESS-002)", () => {
  // VAL-HARNESS-002 part (a): with the SAME fixed clock AND a DETERMINISTIC stub
  // scorer, two harness runs over the canonical fixture produce a deeply-equal
  // FULL aggregate — outward artifacts AND internal intermediates.
  it("part (a): two same-fixed-clock runs with a deterministic scorer yield a deeply-equal full aggregate", async () => {
    const a = await runOk(FROZEN_CLOCK_ISO);
    const b = await runOk(FROZEN_CLOCK_ISO);
    expect(a.envelope).toEqual(b.envelope);
    expect(a.scoredSignal).toEqual(b.scoredSignal);
    expect(a.provenanceRecord).toEqual(b.provenanceRecord);
    expect(a.replayProfile).toEqual(b.replayProfile);
    expect(a.internal).toEqual(b.internal);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // VAL-HARNESS-002 part (b) — STRONGER under the D2 surface: the outward
  // artifacts carry NO runtime timestamps at all, so runs under DIFFERENT
  // clocks are byte-identical outward, not merely hash-equal. Only the
  // internal carrier's clock-derived scoredAt differs.
  it("part (b): different clocks ⇒ byte-identical OUTWARD D2 artifacts", async () => {
    const frozen = await runOk(FROZEN_CLOCK_ISO);
    const future = await runOk("2099-12-31T23:59:59.000Z");
    expect(JSON.stringify(outwardArtifacts(future))).toBe(
      JSON.stringify(outwardArtifacts(frozen))
    );
    // internal clock-derived timestamps DO differ across clocks...
    expect(frozen.internal.scored.scoredAt).toBe(FROZEN_CLOCK_ISO);
    expect(future.internal.scored.scoredAt).toBe("2099-12-31T23:59:59.000Z");
    // ...but never leak outward: no volatile timestamp key appears in any artifact.
    const outwardJson = JSON.stringify(outwardArtifacts(frozen));
    for (const volatileKey of ["scoredAt", "createdAt", "updatedAt", "storedAt", "processedAt", "ingestedAt", "startedAt", "finishedAt"]) {
      expect(outwardJson).not.toContain(`"${volatileKey}"`);
    }
  });

  // The REAL afi-core scorer embeds its OWN wall-clock `analystScore.scoredAt`
  // VERBATIM in the internal carrier. afi-core is read-only, so our injected
  // fixed clock CANNOT reach that field. It is, however, EXCLUDED from every
  // content hash (afi.hash.v1 volatile-timestamp policy) and the outward
  // ScoredSignal v1 projection omits it entirely. We prove the exclusion here
  // by running the harness with two stub scorers that differ ONLY in their
  // embedded analystScore.scoredAt and asserting the outward artifacts stay
  // byte-equal. Full REAL-scorer determinism is proven end-to-end at the CLI
  // level under VAL-CROSS-007/009 (where the real afi-core scorer loads).
  it("embedded analystScore.scoredAt is a wall-clock field EXCLUDED from every outward artifact and hash", async () => {
    const early = await runOkWith(
      stubScorerWithEmbeddedScoredAt("2001-01-01T00:00:00.000Z"),
      FROZEN_CLOCK_ISO
    );
    const late = await runOkWith(
      stubScorerWithEmbeddedScoredAt("2099-12-31T23:59:59.000Z"),
      FROZEN_CLOCK_ISO
    );

    // The afi-core-injected wall-clock really does differ in the carried-through
    // analystScore (our fixed clock did NOT control it).
    const earlyScoredAt = (early.internal.scored.analystScore as Record<string, unknown>).scoredAt;
    const lateScoredAt = (late.internal.scored.analystScore as Record<string, unknown>).scoredAt;
    expect(earlyScoredAt).toBe("2001-01-01T00:00:00.000Z");
    expect(lateScoredAt).toBe("2099-12-31T23:59:59.000Z");
    expect(earlyScoredAt).not.toBe(lateScoredAt);

    // ...yet the outward artifacts are byte-identical (hashes included).
    expect(JSON.stringify(outwardArtifacts(late))).toBe(
      JSON.stringify(outwardArtifacts(early))
    );
    expect(late.provenanceRecord.outputHash).toEqual(early.provenanceRecord.outputHash);
    // The outward projection never carries scoredAt at all.
    expect(Object.keys(early.scoredSignal)).not.toContain("scoredAt");
  });
});

describe("pipehead typed contract — purity for identical (input, ctx) (VAL-PIPEHEAD-001)", () => {
  it("each pipehead exposes execute() and returns deeply-equal results for identical input+ctx", async () => {
    const rawUss = loadRawUss();
    const candles = loadOhlcv();
    const laneResults: AnalysisLaneResult[] = await fanOut({ candles }, ctx(rawUss));
    const bundle = normalizeToBundle(laneResults, rawUss);
    const envelope = buildEnvelopeFromBundle(bundle, candles, rawUss);
    const scored = buildInternalScoringResult(fakeScoreResult(), SIGNAL_ID, FROZEN_CLOCK_ISO);

    const cases: Array<{ name: string; run: (c: PipeheadContext) => Promise<unknown> }> = [
      { name: "schema-validation", run: (c) => schemaValidationPipehead.execute(rawUss, c) },
      { name: "technical lane", run: (c) => technicalLane.execute(candles, c) },
      { name: "pattern lane", run: (c) => patternLane.execute(candles, c) },
      { name: "news lane", run: (c) => newsLane.execute(undefined, c) },
      { name: "social lane", run: (c) => socialLane.execute(undefined, c) },
      { name: "ai-ml lane", run: (c) => aimlLane.execute(undefined, c) },
      { name: "normalize", run: (c) => normalizePipehead.execute(laneResults, c) },
      { name: "envelope", run: (c) => envelopePipehead.execute({ bundle, candles }, c) },
      { name: "scoring", run: (c) => createScoringPipehead(stubScorer()).execute(envelope, c) },
      {
        name: "provenance",
        run: (c) => provenancePipehead.execute({ bundle, envelope, scored }, c),
      },
    ];

    for (const { name, run } of cases) {
      const first = await run(ctx(rawUss));
      const second = await run(ctx(rawUss));
      expect(typeof (run as unknown)).toBe("function");
      expect({ name, value: first }).toEqual({ name, value: second });
    }
  });

  it("no pipehead source reads ambient time/randomness/network/DB directly", () => {
    const dir = join(process.cwd(), "src/pipeheads");
    const offenders = [
      /Date\.now\s*\(/,
      /Math\.random\s*\(/,
      /\bfetch\s*\(/,
      /from\s+["']axios["']/,
      /from\s+["']mongodb["']/,
      /\bnew\s+WebSocket\b/,
      /\.listen\s*\(/,
    ];
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      for (const pattern of offenders) {
        expect({ file, pattern: pattern.source, matched: pattern.test(src) }).toEqual({
          file,
          pattern: pattern.source,
          matched: false,
        });
      }
    }
  });
});
