/**
 * Tests for the scoring pipehead (District 2 M2 surface), covering
 * VAL-SCORING-001..008. The scoring pipehead INVOKES the afi-core
 * deterministic scorer `scoreFroggyTrendPullbackFromEnriched` with
 * `defaultUwrConfig` UNCHANGED over the AnalystInputEnvelope v1's opaque
 * strategy-local view and projects its output into the INTERNAL
 * {@link InternalScoringResult} carrier (never emitted outward; the outward
 * scored surface is the ScoredSignal v1 projection).
 *
 * Runtime note: Jest's resolver cannot load the afi-core `./analysts/*` VALUE
 * subpath (its export key declares only `import`/`types`, no `require`/
 * `default`), so these Jest tests exercise the projection/shape with an
 * INJECTED stub scorer and pin the canonical numbers against the committed
 * `golden.json`. The REAL scorer (uwrScore in [0,1], mean==uwrScore, golden
 * match, determinism) is exercised by the spawned-CLI suites, the same
 * resolution path as the CLI.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import type {
  InternalScoringResult,
  PipeheadContext,
} from "../../src/pipeheads/types.js";
import { createFrozenClock } from "../../src/pipeheads/clock.js";
import { computeCanonicalHashV1 } from "../../src/pipeheads/provenance/canonicalHashV1.js";
import {
  projectDecimalFieldsForHash,
  SCORE_DECIMAL_KEYS,
} from "../../src/pipeheads/provenance/hashProjection.js";
import type { AnalystInputEnvelopeV1 } from "../../src/pipeheads/provenance/types.js";
import {
  buildInternalScoringResult,
  createScoringPipehead,
  scoringPipehead,
  SCORING_PIPEHEAD_ID,
  type FroggyScorer,
} from "../../src/pipeheads/scoringPipehead.js";

type UwrAxes = InternalScoringResult["uwrAxes"];

const GOLDEN_AXES: UwrAxes = { structure: 0.25, execution: 0.2, risk: 0.2, insight: 0.85 };
const SIGNAL_ID = "btc-usdt-perp-4h-0001";

function mean(axes: UwrAxes): number {
  return (axes.structure + axes.execution + axes.risk + axes.insight) / 4;
}

/**
 * afi.hash.v1 digest of a scoring carrier: known score fields are projected to
 * canonical decimal strings first (field-specific number policy) and the
 * volatile `scoredAt` keys are excluded by the canonicalizer.
 */
function carrierDigest(carrier: InternalScoringResult): string {
  return computeCanonicalHashV1(
    projectDecimalFieldsForHash(carrier, SCORE_DECIMAL_KEYS),
    { domainTag: "afi.d2.test-domain" }
  ).value;
}

/**
 * A stub afi-core score result. Mirrors the real `FroggyTrendPullbackScore`
 * shape: an embedded `analystScore` carrying the four axes, the (equal-weight)
 * uwrScore, the froggy/trend_pullback_v1 fingerprint, and a wall-clock
 * `scoredAt` (which must be excluded from every content hash).
 */
function fakeScoreResult(axes: UwrAxes = GOLDEN_AXES): FroggyTrendPullbackScore {
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
      scoredAt: "2024-06-01T12:34:56.789Z",
    },
    notes: ["structure note"],
  } as unknown as FroggyTrendPullbackScore;
}

function stubScorer(axes: UwrAxes = GOLDEN_AXES): FroggyScorer {
  return () => fakeScoreResult(axes);
}

function loadGolden(): {
  uwrScore: number;
  uwrAxes: UwrAxes;
} {
  return JSON.parse(
    readFileSync(join(process.cwd(), "test/pipeheads/fixtures/golden.json"), "utf-8")
  ) as { uwrScore: number; uwrAxes: UwrAxes };
}

function makeEnvelope(
  enrichedView: Partial<FroggyEnrichedView> = {}
): AnalystInputEnvelopeV1 {
  const view: FroggyEnrichedView = {
    signalId: SIGNAL_ID,
    symbol: "BTC/USDT",
    market: "perp",
    timeframe: "4h",
    ...enrichedView,
  };
  return {
    schema: "afi.analyst-input-envelope.v1",
    signalId: SIGNAL_ID,
    analystId: "froggy",
    strategyId: "trend_pullback_v1",
    strategyViewType: "froggy-enriched-view",
    strategyLocalView: view as unknown as Record<string, unknown>,
  };
}

function ctx(iso?: string): PipeheadContext {
  return {
    signalId: SIGNAL_ID,
    rawUss: {},
    clock: createFrozenClock(iso),
  };
}

describe("scoring pipehead — internal carrier projection (VAL-SCORING-001..008)", () => {
  it("VAL-SCORING-001: uwrScore is a finite number in [0,1]", () => {
    const scored = buildInternalScoringResult(fakeScoreResult(), SIGNAL_ID, "2025-01-01T00:00:00.000Z");
    expect(typeof scored.uwrScore).toBe("number");
    expect(Number.isFinite(scored.uwrScore)).toBe(true);
    expect(scored.uwrScore).toBeGreaterThanOrEqual(0);
    expect(scored.uwrScore).toBeLessThanOrEqual(1);
  });

  it("VAL-SCORING-002: all four uwrAxes present and each in [0,1]", () => {
    const scored = buildInternalScoringResult(fakeScoreResult(), SIGNAL_ID, "2025-01-01T00:00:00.000Z");
    expect(Object.keys(scored.uwrAxes).sort()).toEqual(["execution", "insight", "risk", "structure"]);
    for (const axis of ["structure", "execution", "risk", "insight"] as const) {
      const v = scored.uwrAxes[axis];
      expect(typeof v).toBe("number");
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("VAL-SCORING-003: analystScore is carried verbatim and top-level score equals it", () => {
    const result = fakeScoreResult();
    const scored = buildInternalScoringResult(result, SIGNAL_ID, "2025-01-01T00:00:00.000Z");
    // verbatim: the embedded afi-core analystScore is the exact object the scorer returned
    expect(scored.analystScore).toBe(result.analystScore);
    const analyst = scored.analystScore as Record<string, unknown>;
    expect(analyst.analystId).toBe("froggy");
    expect(analyst.strategyId).toBe("trend_pullback_v1");
    expect(scored.uwrScore).toBe(analyst.uwrScore);
    expect(scored.uwrAxes).toEqual(analyst.uwrAxes);
  });

  it("the internal carrier is a plain runtime carrier — no demo/outward labeling fields", () => {
    const scored = buildInternalScoringResult(fakeScoreResult(), SIGNAL_ID, "2025-01-01T00:00:00.000Z");
    expect(Object.keys(scored).sort()).toEqual(
      ["analystScore", "scoredAt", "signalId", "uwrAxes", "uwrScore"].sort()
    );
    expect("demoOnly" in scored).toBe(false);
    expect("provisional" in scored).toBe(false);
  });

  it("scoredAt comes from the injected clock and is EXCLUDED from the content hash", () => {
    const result = fakeScoreResult();
    const a = buildInternalScoringResult(result, SIGNAL_ID, "2025-01-01T00:00:00.000Z");
    const b = buildInternalScoringResult(result, SIGNAL_ID, "2099-12-31T23:59:59.000Z");
    expect(a.scoredAt).toBe("2025-01-01T00:00:00.000Z");
    expect(b.scoredAt).toBe("2099-12-31T23:59:59.000Z");
    // human-facing timestamps differ; the afi.hash.v1 digest (which excludes
    // scoredAt, including the embedded afi-core analystScore.scoredAt) is unchanged.
    expect(carrierDigest(a)).toBe(carrierDigest(b));
  });

  it("VAL-SCORING-005/007: equal-weight identity holds — uwrScore == mean(axes) within 1e-12", () => {
    const axes: UwrAxes = { structure: 0.1, execution: 0.4, risk: 0.7, insight: 0.3 };
    const scored = buildInternalScoringResult(fakeScoreResult(axes), SIGNAL_ID, "2025-01-01T00:00:00.000Z");
    expect(Math.abs(scored.uwrScore - mean(scored.uwrAxes))).toBeLessThan(1e-12);
  });
});

describe("scoring pipehead — pipehead wrapper (VAL-SCORING-003/004/006)", () => {
  it("execute() returns an ok scoring result wrapping the internal carrier", async () => {
    const pipehead = createScoringPipehead(stubScorer());
    const res = await pipehead.execute(makeEnvelope(), ctx());
    expect(res.pipeheadId).toBe(SCORING_PIPEHEAD_ID);
    expect(res.kind).toBe("scoring");
    expect(res.status).toBe("ok");
    expect(res.output.signalId).toBe(SIGNAL_ID);
    expect(typeof res.output.uwrScore).toBe("number");
  });

  it("passes the envelope's opaque strategyLocalView to the injected scorer", async () => {
    let seen: FroggyEnrichedView | undefined;
    const spyScorer: FroggyScorer = (enriched) => {
      seen = enriched;
      return fakeScoreResult();
    };
    const envelope = makeEnvelope({ symbol: "BTC/USDT" });
    await createScoringPipehead(spyScorer).execute(envelope, ctx());
    expect(seen).toBe(envelope.strategyLocalView as unknown as FroggyEnrichedView);
    expect(seen?.symbol).toBe("BTC/USDT");
  });

  it("VAL-SCORING-004: identical envelope yields identical uwrScore and uwrAxes", async () => {
    const pipehead = createScoringPipehead(stubScorer());
    const a = await pipehead.execute(makeEnvelope(), ctx("2025-01-01T00:00:00.000Z"));
    const b = await pipehead.execute(makeEnvelope(), ctx("2099-12-31T23:59:59.000Z"));
    expect(a.output.uwrScore).toEqual(b.output.uwrScore);
    expect(a.output.uwrAxes).toEqual(b.output.uwrAxes);
    // carrier digest (timestamps excluded) is stable across clocks
    expect(carrierDigest(a.output)).toBe(carrierDigest(b.output));
  });

  it("the default scoringPipehead is a scoring pipehead bound to the real afi-core scorer", () => {
    expect(scoringPipehead.id).toBe(SCORING_PIPEHEAD_ID);
    expect(scoringPipehead.kind).toBe("scoring");
  });
});

describe("scoring pipehead — golden values (VAL-SCORING-008)", () => {
  it("golden.json pins uwrScore/uwrAxes with each value finite and in [0,1]", () => {
    const golden = loadGolden();
    expect(typeof golden.uwrScore).toBe("number");
    expect(golden.uwrScore).toBeGreaterThanOrEqual(0);
    expect(golden.uwrScore).toBeLessThanOrEqual(1);
    for (const axis of ["structure", "execution", "risk", "insight"] as const) {
      const v = golden.uwrAxes[axis];
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("golden values obey the default equal-weight identity (mean(axes) == uwrScore)", () => {
    const golden = loadGolden();
    expect(Math.abs(mean(golden.uwrAxes) - golden.uwrScore)).toBeLessThan(1e-12);
  });

  it("projecting a score-result carrying the golden values reproduces golden exactly", () => {
    const golden = loadGolden();
    const scored = buildInternalScoringResult(
      fakeScoreResult(golden.uwrAxes),
      SIGNAL_ID,
      "2025-01-01T00:00:00.000Z"
    );
    expect(scored.uwrScore).toBe(golden.uwrScore);
    expect(scored.uwrAxes).toEqual(golden.uwrAxes);
  });
});
