/**
 * Tests for the D2 artifact builders (District 2 M2): every builder output
 * validates against the merged afi-config schemas over the committed fixture
 * run, builds are deterministic, forbidden keys are absent, the opaque
 * strategy-local view is declared + hash-pinned (never canonized), scoring
 * values are read VERBATIM (byte-equal to the committed golden), and there is
 * NO ScoredSignal <-> ProvenanceRecord circular hash dependency.
 *
 * Jest cannot load the afi-core scorer value subpath, so the internal scoring
 * carrier is built from a deterministic stub (the REAL scorer path is proven
 * by the spawned-CLI suites).
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type {
  AnalysisBundle,
  InternalScoringResult,
  PipeheadContext,
} from "../../src/pipeheads/types.js";
import { createFrozenClock, FROZEN_CLOCK_ISO } from "../../src/pipeheads/clock.js";
import { fanOut } from "../../src/pipeheads/fanOut.js";
import { normalizeToBundle } from "../../src/pipeheads/normalizePipehead.js";
import {
  buildEvidenceRefs,
  buildSourceDisclosureProfiles,
  buildEnrichmentProvenance,
  buildScoredSignalProjection,
  buildReplayProfile,
  buildProvenanceRecord,
  computeInputHash,
  computeEnrichmentHash,
  computeScoredOutputHash,
  findForbiddenArtifactKeys,
  provenanceRecordRefFor,
  replayProfileRefFor,
  FORBIDDEN_ARTIFACT_KEYS,
  FIXTURE_SOURCE_IDS,
  LANE_VERSIONS,
  STRATEGY_VIEW_TYPE,
  REFERENCE_IMPLEMENTATION_NOTE,
} from "../../src/pipeheads/provenance/builders.js";
import {
  buildEnvelopeFromBundle,
  envelopePipehead,
} from "../../src/pipeheads/provenance/envelopePipehead.js";
import {
  buildD2Artifacts,
  deriveEvaluatedAt,
  provenancePipehead,
} from "../../src/pipeheads/provenance/provenancePipehead.js";
import {
  validateAnalystInputEnvelopeV1,
  validateEnrichmentProvenanceV1,
  validateEvidenceRefV1,
  validateProvenanceRecordV1,
  validateReplayProfileV1,
  validateScoredSignalV1,
  validateSourceDisclosureProfileV1,
} from "../../src/pipeheads/provenance/schemaValidation.js";
import { D2_DOMAIN_TAGS } from "../../src/pipeheads/provenance/canonicalHashV1.js";
import type { AnalystInputEnvelopeV1 } from "../../src/pipeheads/provenance/types.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const SIGNAL_ID = "btc-usdt-perp-4h-0001";

interface Golden {
  analystId: string;
  strategyId: string;
  direction: string;
  riskBucket: string;
  conviction: number;
  uwrScore: number;
  uwrAxes: { structure: number; execution: number; risk: number; insight: number };
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), rel), "utf-8")) as T;
}

const loadGolden = (): Golden => loadJson<Golden>("test/pipeheads/fixtures/golden.json");
const loadRawUss = (): Record<string, unknown> =>
  loadJson<Record<string, unknown>>("test/pipeheads/fixtures/signal.uss.json");
const loadOhlcv = (): AfiCandle[] => loadJson<AfiCandle[]>("test/pipeheads/fixtures/ohlcv.json");

function ctx(rawUss: unknown = loadRawUss()): PipeheadContext {
  return { signalId: SIGNAL_ID, rawUss, clock: createFrozenClock() };
}

async function buildBundle(): Promise<AnalysisBundle> {
  const rawUss = loadRawUss();
  const laneResults = await fanOut({ candles: loadOhlcv() }, ctx(rawUss));
  return normalizeToBundle(laneResults, rawUss);
}

/** Deterministic internal carrier mirroring the golden afi-core scorer output. */
function goldenScored(): InternalScoringResult {
  const golden = loadGolden();
  return {
    signalId: SIGNAL_ID,
    uwrScore: golden.uwrScore,
    uwrAxes: { ...golden.uwrAxes },
    analystScore: {
      analystId: golden.analystId,
      strategyId: golden.strategyId,
      strategyVersion: "1.0.0",
      direction: golden.direction,
      riskBucket: golden.riskBucket,
      conviction: golden.conviction,
      uwrAxes: { ...golden.uwrAxes },
      uwrScore: golden.uwrScore,
      scoredAt: "2024-06-01T12:34:56.789Z", // afi-core wall-clock; never emitted
    },
    scoredAt: FROZEN_CLOCK_ISO,
  };
}

async function buildAll() {
  const rawUss = loadRawUss();
  const candles = loadOhlcv();
  const bundle = await buildBundle();
  const envelope = buildEnvelopeFromBundle(bundle, candles, rawUss);
  const result = buildD2Artifacts({ bundle, envelope, scored: goldenScored() }, rawUss);
  if (result.ok === false) {
    throw new Error(`artifact validation failed: ${JSON.stringify(result.errors)}`);
  }
  return { rawUss, candles, bundle, envelope, ...result.artifacts };
}

describe("buildEvidenceRefs / buildSourceDisclosureProfiles / buildEnrichmentProvenance", () => {
  it("emits schema-valid evidence refs for the four committed fixture inputs", async () => {
    const bundle = await buildBundle();
    const refs = buildEvidenceRefs({
      signalId: bundle.signalId,
      candles: loadOhlcv(),
      lanes: bundle.lanes,
    });
    expect(refs.map((r) => r.sourceRef)).toEqual([
      FIXTURE_SOURCE_IDS.ohlcv,
      FIXTURE_SOURCE_IDS.news,
      FIXTURE_SOURCE_IDS.social,
      FIXTURE_SOURCE_IDS.aiml,
    ]);
    for (const ref of refs) {
      expect(validateEvidenceRefV1(ref)).toEqual({ ok: true, errors: [] });
      expect(ref.evidenceHash.value).toMatch(HEX_64);
      expect(ref.evidenceHash.domainTag).toBe(D2_DOMAIN_TAGS.evidence);
    }
  });

  it("derives evidence timestamps from evidence content, never runtime clock", async () => {
    const bundle = await buildBundle();
    const candles = loadOhlcv();
    const refs = buildEvidenceRefs({ signalId: bundle.signalId, candles, lanes: bundle.lanes });
    const ohlcv = refs.find((r) => r.sourceRef === FIXTURE_SOURCE_IDS.ohlcv);
    expect(ohlcv?.asOf).toBe(new Date(candles[candles.length - 1].timestamp).toISOString());
    const news = refs.find((r) => r.sourceRef === FIXTURE_SOURCE_IDS.news);
    expect(news?.postedAt).toBe("2024-12-31T12:00:00.000Z"); // newest publishedAt in the fixture
  });

  it("emits schema-valid disclosure profiles for the fixture sources", () => {
    const profiles = buildSourceDisclosureProfiles();
    expect(profiles).toHaveLength(4);
    for (const profile of profiles) {
      expect(validateSourceDisclosureProfileV1(profile)).toEqual({ ok: true, errors: [] });
      expect(profile.disclosureLevel).toBe("full");
      expect(profile.replayabilityLevel).toBe("deterministic");
    }
  });

  it("emits five schema-valid per-lane enrichment provenance records with lane output hashes", async () => {
    const bundle = await buildBundle();
    const refs = buildEvidenceRefs({
      signalId: bundle.signalId,
      candles: loadOhlcv(),
      lanes: bundle.lanes,
    });
    const records = buildEnrichmentProvenance(bundle, refs);
    expect(records.map((r) => r.laneId)).toEqual([
      "technical-indicators",
      "pattern-recognition",
      "news",
      "social",
      "ai-ml",
    ]);
    for (const record of records) {
      expect(validateEnrichmentProvenanceV1(record)).toEqual({ ok: true, errors: [] });
      expect(record.laneVersion).toBe(LANE_VERSIONS[record.laneId as keyof typeof LANE_VERSIONS]);
      expect(record.laneOutputHash?.value).toMatch(HEX_64);
      expect(record.laneOutputHash?.domainTag).toBe(D2_DOMAIN_TAGS.laneOutput);
    }
    const byLane = new Map(records.map((r) => [r.laneId, r]));
    expect(byLane.get("technical-indicators")?.status).toBe("complete");
    expect(byLane.get("pattern-recognition")?.provisional).toBe(false);
    for (const lane of ["news", "social", "ai-ml"]) {
      expect(byLane.get(lane)?.status).toBe("provisional");
      expect(byLane.get(lane)?.provisional).toBe(true);
    }
  });
});

describe("buildAnalystInputEnvelope — opaque, declared, hash-pinned strategy view", () => {
  it("emits a schema-valid envelope whose view is declared and pinned", async () => {
    const { envelope, bundle } = await buildAll();
    expect(validateAnalystInputEnvelopeV1(envelope)).toEqual({ ok: true, errors: [] });
    expect(envelope.signalId).toBe(SIGNAL_ID);
    expect(envelope.providerId).toBe("tradingview");
    expect(envelope.strategyViewType).toBe(STRATEGY_VIEW_TYPE);
    expect(typeof envelope.enrichedViewSchemaRef).toBe("string");
    // The opaque view is the bundle's strategy-local enriched view, carried
    // verbatim (never re-shaped / canonized).
    expect(envelope.strategyLocalView).toEqual(bundle.enrichedView);
    // The ONLY hash participation of the view is the explicit pin.
    expect(envelope.strategyLocalViewHash?.domainTag).toBe(D2_DOMAIN_TAGS.strategyLocalView);
    expect(envelope.strategyLocalViewHash?.value).toMatch(HEX_64);
    expect(envelope.replayProfileRef).toBe(replayProfileRefFor(SIGNAL_ID));
  });

  it("envelopePipehead is pure for identical (input, ctx)", async () => {
    const bundle = await buildBundle();
    const candles = loadOhlcv();
    const a = await envelopePipehead.execute({ bundle, candles }, ctx());
    const b = await envelopePipehead.execute({ bundle, candles }, ctx());
    expect(a.kind).toBe("envelope");
    expect(a.status).toBe("ok");
    expect(a.output).toEqual(b.output);
  });
});

describe("buildScoredSignalProjection — verbatim scoring values (golden)", () => {
  it("projects the golden scoring values byte-identically (no scoring math)", async () => {
    const { scoredSignal } = await buildAll();
    const golden = loadGolden();
    expect(validateScoredSignalV1(scoredSignal)).toEqual({ ok: true, errors: [] });
    expect(scoredSignal.uwrScore).toBe(golden.uwrScore);
    expect(scoredSignal.uwrAxes).toEqual(golden.uwrAxes);
    expect(scoredSignal.analystId).toBe(golden.analystId);
    expect(scoredSignal.strategyId).toBe(golden.strategyId);
    expect(scoredSignal.direction).toBe(golden.direction);
    expect(scoredSignal.riskBucket).toBe(golden.riskBucket);
    expect(scoredSignal.conviction).toBe(golden.conviction);
  });

  it("carries no volatile timestamps and no forbidden fields", async () => {
    const { scoredSignal } = await buildAll();
    const keys = Object.keys(scoredSignal);
    expect(keys).not.toContain("scoredAt");
    expect(findForbiddenArtifactKeys(scoredSignal)).toEqual([]);
    // evaluatedAt (when present) is domain evidence: the OHLCV candle close.
    const candles = loadOhlcv();
    expect(scoredSignal.evaluatedAt).toBe(
      new Date(candles[candles.length - 1].timestamp).toISOString()
    );
  });

  it("rejects an unsupported direction with a structured throw", () => {
    const broken = goldenScored();
    (broken.analystScore as Record<string, unknown>).direction = "sideways";
    expect(() =>
      buildScoredSignalProjection(broken, {
        provenanceRecordRef: provenanceRecordRefFor(SIGNAL_ID),
      })
    ).toThrow(/unsupported direction/);
  });
});

describe("buildReplayProfile / buildProvenanceRecord", () => {
  it("emits a schema-valid deterministic replay profile with lane + evidence pins", async () => {
    const { replayProfile, envelope } = await buildAll();
    expect(validateReplayProfileV1(replayProfile)).toEqual({ ok: true, errors: [] });
    expect(replayProfile.replayabilityLevel).toBe("deterministic");
    expect(replayProfile.factsRequired).toBe(true);
    expect(replayProfile.laneVersions).toEqual(LANE_VERSIONS);
    expect(replayProfile.evidenceRefs).toEqual(
      (envelope.evidenceRefs ?? []).map((r) => r.evidenceId)
    );
    expect(replayProfile.evidenceHashes).toEqual(
      (envelope.evidenceRefs ?? []).map((r) => r.evidenceHash)
    );
    // No wall-clock or per-commit variance is pinned by default.
    expect(replayProfile.codeCommit).toBeUndefined();
    expect(replayProfile.environmentNotes).toBeUndefined();
  });

  it("emits a schema-valid provenance record with recomputable linkage", async () => {
    const { provenanceRecord, rawUss, bundle, scoredSignal } = await buildAll();
    expect(validateProvenanceRecordV1(provenanceRecord)).toEqual({ ok: true, errors: [] });
    expect(provenanceRecord.canonicalizationVersion).toBe("afi.hash.v1");
    // Every digest is independently recomputable from its material.
    expect(provenanceRecord.inputHash).toEqual(computeInputHash(rawUss));
    expect(provenanceRecord.enrichmentHash).toEqual(computeEnrichmentHash(bundle));
    expect(provenanceRecord.outputHash).toEqual(computeScoredOutputHash(scoredSignal));
    // Bundle-internal provenance binding agrees with the record's input digest.
    expect(bundle.provenance?.inputHash).toBe(provenanceRecord.inputHash.value);
    // Domain tags mirror the contained hashes.
    expect(provenanceRecord.domainTags).toEqual([
      D2_DOMAIN_TAGS.signalInput,
      D2_DOMAIN_TAGS.enrichmentBundle,
      D2_DOMAIN_TAGS.scoredOutput,
      D2_DOMAIN_TAGS.evidence,
    ]);
    expect(provenanceRecord.schemaVersions).toEqual({
      input: "afi.usignal.v1.1",
      envelope: "afi.analyst-input-envelope.v1",
      output: "afi.scored-signal.v1",
      replay: "afi.replay-profile.v1",
    });
    // Reference-implementation self-label; no storage profile (nothing persisted).
    expect(provenanceRecord.notes).toBe(REFERENCE_IMPLEMENTATION_NOTE);
    expect(provenanceRecord.storageProfileRef).toBeUndefined();
  });

  it("NO ScoredSignal <-> ProvenanceRecord hash cycle", async () => {
    const { provenanceRecord, scoredSignal } = await buildAll();
    // (a) The ref on the ScoredSignal is deterministic and id-derived only —
    //     independent of any digest of the record.
    expect(scoredSignal.provenanceRecordRef).toBe(provenanceRecordRefFor(SIGNAL_ID));
    expect(scoredSignal.provenanceRecordRef).toBe(`provenance-record:${SIGNAL_ID}`);
    // (b) The ScoredSignal carries NO digest of the record (and no self-digest).
    expect(scoredSignal.provenanceRecordHash).toBeUndefined();
    expect(scoredSignal.outputHash).toBeUndefined();
    // (c) The record's outputHash commits to the FINISHED ScoredSignal —
    //     recomputable from the emitted projection alone (one-directional).
    expect(provenanceRecord.outputHash).toEqual(computeScoredOutputHash(scoredSignal));
  });
});

describe("determinism + forbidden-key guard across the artifact set", () => {
  it("two independent builds produce deeply-equal artifacts", async () => {
    const a = await buildAll();
    const b = await buildAll();
    expect(a.envelope).toEqual(b.envelope);
    expect(a.scoredSignal).toEqual(b.scoredSignal);
    expect(a.replayProfile).toEqual(b.replayProfile);
    expect(a.provenanceRecord).toEqual(b.provenanceRecord);
    expect(JSON.stringify([a.envelope, a.scoredSignal, a.replayProfile, a.provenanceRecord])).toBe(
      JSON.stringify([b.envelope, b.scoredSignal, b.replayProfile, b.provenanceRecord])
    );
  });

  it("no artifact carries any forbidden key (including inside the opaque view)", async () => {
    const { envelope, scoredSignal, replayProfile, provenanceRecord } = await buildAll();
    for (const artifact of [envelope, scoredSignal, replayProfile, provenanceRecord]) {
      expect(findForbiddenArtifactKeys(artifact)).toEqual([]);
    }
  });

  it("the guard detects every forbidden key (positive control)", () => {
    for (const key of FORBIDDEN_ARTIFACT_KEYS) {
      expect(findForbiddenArtifactKeys({ nested: [{ [key]: 1 }] })).toEqual([
        `$.nested[0].${key}`,
      ]);
    }
  });

  it("provenancePipehead surfaces artifact problems as a structured failed value (never a throw)", async () => {
    const bundle = await buildBundle();
    const candles = loadOhlcv();
    const rawUss = loadRawUss();
    const envelope = buildEnvelopeFromBundle(bundle, candles, rawUss);
    // Corrupt the envelope with a forbidden debug field.
    const corrupted = { ...envelope, demoOnly: true } as unknown as AnalystInputEnvelopeV1;
    const result = await provenancePipehead.execute(
      { bundle, envelope: corrupted, scored: goldenScored() },
      ctx(rawUss)
    );
    expect(result.status).toBe("failed");
    const failure = result.output as {
      ok: boolean;
      stage?: string;
      errors?: Array<{ artifact: string; field: string; message: string }>;
    };
    expect(failure.ok).toBe(false);
    expect(failure.stage).toBe("artifact-validation");
    expect(failure.errors?.length).toBeGreaterThan(0);
    expect(
      failure.errors?.some(
        (e) => e.artifact === "forbidden-keys" && /demoOnly/.test(e.field)
      )
    ).toBe(true);
  });

  it("deriveEvaluatedAt reads the OHLCV evidence asOf (domain evidence only)", async () => {
    const { envelope } = await buildAll();
    const candles = loadOhlcv();
    expect(deriveEvaluatedAt(envelope)).toBe(
      new Date(candles[candles.length - 1].timestamp).toISOString()
    );
    expect(deriveEvaluatedAt({ ...envelope, evidenceRefs: [] })).toBeUndefined();
  });
});
