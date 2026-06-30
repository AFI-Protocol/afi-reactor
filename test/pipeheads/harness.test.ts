/**
 * Tests for the full-DAG harness (m2-harness-full-assembly), covering
 * VAL-PIPEHEAD-001, VAL-PIPEHEAD-002, VAL-HARNESS-001, VAL-HARNESS-002,
 * VAL-SCHEMA-001 and VAL-SCHEMA-005.
 *
 * The harness wires the pipeheads in the fixed order
 * validate -> fan-out -> normalize -> score -> receipt -> audit and returns a
 * single aggregate {bundle, scored, receipt, audit}. On a schema-validation
 * failure it short-circuits gracefully (structured failure surfaced as a value,
 * no uncaught throw) and emits NO downstream scored/audit artifacts.
 *
 * Runtime note (mirrors scoring.test.ts): Jest's resolver cannot load the
 * afi-core `./analysts/*` VALUE subpath, so these tests inject a deterministic
 * stub scorer. The REAL afi-core scorer is exercised end-to-end by a
 * `node --loader ts-node/esm` driver (the same resolution path as the CLI).
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import type {
  AnalysisLaneResult,
  DemoScoredSignal,
  PipeheadContext,
} from "../../src/pipeheads/types.js";
import { createFrozenClock, FROZEN_CLOCK_ISO } from "../../src/pipeheads/clock.js";
import {
  canonicalHash,
  canonicalize,
  buildScoringProjection,
} from "../../src/pipeheads/canonicalHash.js";
import { schemaValidationPipehead } from "../../src/pipeheads/schemaValidationPipehead.js";
import { fanOut } from "../../src/pipeheads/fanOut.js";
import { normalizePipehead, normalizeToBundle } from "../../src/pipeheads/normalizePipehead.js";
import {
  createScoringPipehead,
  buildDemoScoredSignal,
  type FroggyScorer,
} from "../../src/pipeheads/scoringPipehead.js";
import { reputationReceiptPipehead } from "../../src/pipeheads/reputationReceipt.js";
import { auditPipehead } from "../../src/pipeheads/auditPipehead.js";
import { technicalLane } from "../../src/pipeheads/lanes/technicalLane.js";
import { patternLane } from "../../src/pipeheads/lanes/patternLane.js";
import { newsLane } from "../../src/pipeheads/lanes/newsLane.js";
import { socialLane } from "../../src/pipeheads/lanes/socialLane.js";
import { aimlLane } from "../../src/pipeheads/lanes/aimlLane.js";
import {
  runPipeheadHarness,
  isHarnessFailure,
  HARNESS_ID,
  type HarnessAggregate,
} from "../../src/pipeheads/harness.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const SIGNAL_ID = "btc-usdt-perp-4h-0001";

type UwrAxes = DemoScoredSignal["uwrAxes"];
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
 * (which the harness carries verbatim and the hashes exclude). `embeddedScoredAt`
 * models that afi-core-injected wall-clock so a test can vary it independently of
 * our fixed clock and prove it is excluded from every content hash.
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
    throw new Error("expected a successful harness aggregate");
  }
  return result;
}

describe("harness — full-DAG assembly (VAL-HARNESS-001, VAL-SCHEMA-001)", () => {
  it("VAL-SCHEMA-001: a valid fixture proceeds end-to-end producing bundle + scored + audit", async () => {
    const agg = await runOk();
    expect(agg.ok).toBe(true);
    expect(agg.validation.ok).toBe(true);
    expect(agg.bundle).toBeDefined();
    expect(agg.scored).toBeDefined();
    expect(agg.receipt).toBeDefined();
    expect(agg.audit).toBeDefined();
  });

  it("VAL-HARNESS-001: one call returns all four artifacts", async () => {
    const agg = await runOk();
    expect(Object.keys(agg)).toEqual(
      expect.arrayContaining(["bundle", "scored", "receipt", "audit"])
    );
  });

  it("VAL-HARNESS-001: artifacts share one signalId", async () => {
    const agg = await runOk();
    expect(agg.bundle.signalId).toBe(SIGNAL_ID);
    expect(agg.scored.signalId).toBe(SIGNAL_ID);
    expect(agg.receipt.signalId).toBe(SIGNAL_ID);
    expect(agg.audit.signalId).toBe(SIGNAL_ID);
  });

  it("VAL-HARNESS-001: audit hashes reference the prior steps (input/bundle/output linkage)", async () => {
    const agg = await runOk();
    expect(agg.audit.inputHash).toBe(agg.bundle.provenance?.inputHash);
    expect(agg.audit.inputHash).toBe(canonicalHash(loadRawUss()));
    expect(agg.audit.bundleHash).toBe(canonicalHash(agg.bundle));
    expect(agg.audit.outputHash).toBe(canonicalHash(buildScoringProjection(agg.scored)));
    expect(agg.audit.inputHash).toMatch(HEX_64);
    expect(agg.audit.bundleHash).toMatch(HEX_64);
    expect(agg.audit.outputHash).toMatch(HEX_64);
  });

  it("VAL-HARNESS-001: the echoed uwrScore is consistent across scored/receipt/audit", async () => {
    const agg = await runOk();
    expect(agg.receipt.uwrScore).toBe(agg.scored.uwrScore);
    expect(agg.audit.uwrScore).toBe(agg.scored.uwrScore);
    expect(agg.audit.uwrAxes).toEqual(agg.scored.uwrAxes);
    expect(agg.bundle.provisionalLanes).toEqual(["news", "social", "ai-ml"]);
    expect(agg.receipt.provisionalLanes).toEqual(agg.bundle.provisionalLanes);
    expect(agg.audit.provisionalLanes).toEqual(agg.bundle.provisionalLanes);
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
      // VAL-SCHEMA-005: no scored/bundle/audit artifact present on a failure
      const asAny = result as unknown as Record<string, unknown>;
      expect(asAny.bundle).toBeUndefined();
      expect(asAny.scored).toBeUndefined();
      expect(asAny.receipt).toBeUndefined();
      expect(asAny.audit).toBeUndefined();
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
  // scorer (injected because Jest's resolver cannot load the afi-core
  // `./analysts/*` value subpath), two harness runs over the canonical fixture
  // produce a deeply-equal FULL aggregate — bundle, scored, receipt, AND audit —
  // not merely identical hashes.
  it("part (a): two same-fixed-clock runs with a deterministic scorer yield a deeply-equal full aggregate", async () => {
    const a = await runOk(FROZEN_CLOCK_ISO);
    const b = await runOk(FROZEN_CLOCK_ISO);
    // each of the four artifacts is deeply equal...
    expect(a.bundle).toEqual(b.bundle);
    expect(a.scored).toEqual(b.scored);
    expect(a.receipt).toEqual(b.receipt);
    expect(a.audit).toEqual(b.audit);
    // ...and the whole four-artifact aggregate is byte-identical when serialized.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // VAL-HARNESS-002 part (b): two runs under DIFFERENT clocks keep all three
  // content hashes (inputHash/bundleHash/outputHash) byte-equal while the
  // human-facing timestamps differ — proving timestamps are excluded from hashing.
  it("part (b): different clocks ⇒ byte-equal content hashes but differing human timestamps", async () => {
    const frozen = await runOk(FROZEN_CLOCK_ISO);
    const future = await runOk("2099-12-31T23:59:59.000Z");
    expect(future.audit.inputHash).toBe(frozen.audit.inputHash);
    expect(future.audit.bundleHash).toBe(frozen.audit.bundleHash);
    expect(future.audit.outputHash).toBe(frozen.audit.outputHash);
    // human-facing timestamps DO differ across clocks
    expect(frozen.scored.scoredAt).toBe(FROZEN_CLOCK_ISO);
    expect(future.scored.scoredAt).toBe("2099-12-31T23:59:59.000Z");
    expect(future.scored.scoredAt).not.toBe(frozen.scored.scoredAt);
    expect(future.receipt.issuedAt).not.toBe(frozen.receipt.issuedAt);
  });

  // VAL-HARNESS-002 (documented exclusion): the REAL afi-core scorer embeds its
  // OWN wall-clock `analystScore.scoredAt` VERBATIM in the scored output.
  // afi-core is read-only, so our injected fixed clock CANNOT reach that field —
  // it is the single field that may vary run-to-run on the real-scorer path.
  // It is, however, EXCLUDED from every content hash: `scoredAt` is in
  // EXCLUDED_TIMESTAMP_KEYS (stripped recursively before hashing) and `outputHash`
  // commits to buildScoringProjection(), which omits scoredAt entirely. We prove
  // the exclusion here by running the harness with two stub scorers that differ
  // ONLY in their embedded analystScore.scoredAt and asserting all three content
  // hashes stay byte-equal. Full REAL-scorer determinism is proven end-to-end at
  // the CLI level under VAL-CROSS-007/009 (where the real afi-core scorer loads),
  // not in Jest.
  it("embedded analystScore.scoredAt is a wall-clock field EXCLUDED from every content hash", async () => {
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
    const earlyScoredAt = (early.scored.analystScore as Record<string, unknown>).scoredAt;
    const lateScoredAt = (late.scored.analystScore as Record<string, unknown>).scoredAt;
    expect(earlyScoredAt).toBe("2001-01-01T00:00:00.000Z");
    expect(lateScoredAt).toBe("2099-12-31T23:59:59.000Z");
    expect(earlyScoredAt).not.toBe(lateScoredAt);

    // ...yet NONE of the three content hashes move, because scoredAt is excluded.
    expect(late.audit.inputHash).toBe(early.audit.inputHash);
    expect(late.audit.bundleHash).toBe(early.audit.bundleHash);
    expect(late.audit.outputHash).toBe(early.audit.outputHash);

    // The projection outputHash commits to never carries scoredAt at all...
    expect(buildScoringProjection(early.scored)).not.toHaveProperty("scoredAt");
    // ...and the canonical form of the scored object strips the embedded wall-clock,
    // so the two differ ONLY in that one excluded field.
    expect(canonicalize(early.scored)).toBe(canonicalize(late.scored));
    expect(canonicalHash(early.scored)).toBe(canonicalHash(late.scored));
  });
});

describe("pipehead typed contract — purity for identical (input, ctx) (VAL-PIPEHEAD-001)", () => {
  it("each pipehead exposes execute() and returns deeply-equal results for identical input+ctx", async () => {
    const rawUss = loadRawUss();
    const candles = loadOhlcv();
    const laneResults: AnalysisLaneResult[] = await fanOut({ candles }, ctx(rawUss));
    const bundle = normalizeToBundle(laneResults, rawUss);
    const scored = buildDemoScoredSignal(fakeScoreResult(), SIGNAL_ID, FROZEN_CLOCK_ISO);

    const cases: Array<{ name: string; run: (c: PipeheadContext) => Promise<unknown> }> = [
      { name: "schema-validation", run: (c) => schemaValidationPipehead.execute(rawUss, c) },
      { name: "technical lane", run: (c) => technicalLane.execute(candles, c) },
      { name: "pattern lane", run: (c) => patternLane.execute(candles, c) },
      { name: "news lane", run: (c) => newsLane.execute(undefined, c) },
      { name: "social lane", run: (c) => socialLane.execute(undefined, c) },
      { name: "ai-ml lane", run: (c) => aimlLane.execute(undefined, c) },
      { name: "normalize", run: (c) => normalizePipehead.execute(laneResults, c) },
      { name: "scoring", run: (c) => createScoringPipehead(stubScorer()).execute(bundle, c) },
      {
        name: "reputation",
        run: (c) =>
          reputationReceiptPipehead.execute(
            { scored, provisionalLanes: bundle.provisionalLanes },
            c
          ),
      },
      { name: "audit", run: (c) => auditPipehead.execute({ bundle, scored }, c) },
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
