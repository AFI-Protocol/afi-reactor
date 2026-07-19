/**
 * Canonical evidence submission tests — afi.scored-signal-evidence.v3
 * (MONGO-REACTOR-SUBMIT evolved by EV3-GOV D-EV3-1: v3 = the v2 core carried
 * forward unchanged + REQUIRED providerInvocations/recordHash/replayHash;
 * the projection/provenance preimages are UNCHANGED).
 *
 * Focused behaviors: success, idempotent duplicate, conflicting duplicate,
 * store unavailable, schema rejection (invalid record never submitted),
 * persistence-failure propagation (never a silent success), the registry-
 * backed UWR stamp recognition, the all-or-nothing composition rule, and the
 * baseline five-proof construction path (the exhaustive D-EV3-5(3)
 * contract/mutation suites live in the §15 proof-layer tests). Uses a fake
 * store (the Reactor is a submitter; it never touches MongoDB).
 */

import type { ReactorScoredSignalV1 } from "../../src/types/ReactorScoredSignalV1.js";
import {
  validateProvenanceRecordV1,
  validateScoredSignalV1,
} from "../../src/evidence/provenance/schemaValidation.js";
import { validateEvidenceRecordV3 } from "../../src/evidence/evidenceV3Schema.js";
import {
  buildReactorEvidenceRecord,
  EvidenceProofViolationError,
  ReactorEvidenceConstructionError,
  type EvidenceCompositionContext,
  type EvidenceInvocationCapture,
  type LaneBindingExpectation,
  type ReactorEvidenceRecord,
} from "../../src/evidence/reactorEvidenceRecord.js";
import {
  submitScoredSignalEvidence,
  ReactorEvidencePersistenceError,
  type EvidenceStorePort,
  type EvidenceSubmitResult,
} from "../../src/evidence/submitScoredSignalEvidence.js";
import {
  categoryResultHash,
  evidenceRecordHash,
  evidenceReplayHash,
  invocationInputHash,
  providerInstanceRecordFingerprint,
  providerRecordFingerprint,
  providerResultHash,
  buildInvocationInputProjection,
} from "../../src/evidence/provenance/invocationProofHashes.js";
import {
  PROOF_CATEGORY_ORDER,
  RESULT_SCHEMA_BY_CATEGORY,
  type ProviderInvocationProofV1,
} from "../../src/providers/invocationProof.js";
import type { AnalysisCategory } from "../../src/providers/types.js";
import { canonicalHashOf, DOMAIN_TAGS } from "../../src/pipeline/hashing.js";
import type { CompositionRefV1 } from "../../src/pipeline/manifestTypes.js";

const SILENT = { info: () => {}, error: () => {} };

const DECAY = { halfLifeMinutes: 240, greeksTemplateId: "decay-swing-v1" };

function makeScored(overrides: Record<string, unknown> = {}): ReactorScoredSignalV1 {
  const signalId = (overrides.signalId as string) ?? "sig-reactor-unit-1";
  const analystScore = {
    analystId: "froggy",
    strategyId: "trend_pullback_v1",
    strategyVersion: "1.0.0",
    direction: "long",
    riskBucket: "medium",
    conviction: 0.72,
    uwrScore: 0.81,
    uwrAxes: { structure: 0.8, execution: 0.7, risk: 0.85, insight: 0.9 },
    ...((overrides.analystScore as Record<string, unknown>) ?? {}),
  };
  return {
    signalId,
    rawUss: {
      schema: "afi.usignal.v1.1",
      provenance: { signalId, providerId: "prov-test", source: "test" },
      facts: { symbol: "BTCUSDT", timeframe: "1h", direction: "long", strategy: "trend_pullback_v1" },
    },
    analystScore,
    // RC-6 source PROPAGATED from the composition path (default: builtin).
    // `in` (not ??) so a test can force an explicitly-absent source.
    uwrResolvedSource:
      "uwrResolvedSource" in overrides ? overrides.uwrResolvedSource : "builtin",
    scoredAt: "2026-01-15T12:00:00Z",
    decayParams: "decayParams" in overrides ? overrides.decayParams : { ...DECAY },
    meta: { symbol: "BTCUSDT", timeframe: "1h", strategy: "trend_pullback_v1", direction: "long", source: "test" },
  } as unknown as ReactorScoredSignalV1;
}

// --------------------------------------------------------------------------
// Five-lane invocation fixture world (schema-valid ids; keyless reference).
// --------------------------------------------------------------------------
const HEX64 = "cd".repeat(32);

const LANE_RESULTS: Record<AnalysisCategory, Record<string, unknown>> = {
  technical: { category: "technical", candles: [{ timestamp: 1, close: 100.5 }], priceSource: "demo" },
  pattern: { category: "pattern", series: { seriesId: "s", length: 1, indexBasis: "position" }, motifs: [] },
  sentiment: { category: "sentiment", axes: [{ axis: "positioning", score: 0.5 }] },
  news: { category: "news", news: { hasShockEvent: false, headlines: [] } },
  aiMl: { category: "aiMl", forecast: { direction: "long", conviction: 0.85 } },
};

function makeBinding(category: AnalysisCategory): LaneBindingExpectation {
  const slug = category.toLowerCase();
  const binding: LaneBindingExpectation = {
    category,
    nodeId: slug,
    providerInstanceId: `pi-${slug}-unit`,
    instanceRecordVersion: "1.0.0",
    providerId: `provider-${slug}-unit`,
    providerRecordVersion: "1.0.0",
    adapterId: `adapter-${slug}-unit`,
    adapterVersion: "1.0.0",
  };
  if (category === "aiMl") binding.model = "froggy-reference-v1";
  return binding;
}

function makeProof(
  category: AnalysisCategory,
  binding: LaneBindingExpectation,
  laneResult: { category: string }
): ProviderInvocationProofV1 {
  const providerRecord = { providerId: binding.providerId, recordVersion: binding.providerRecordVersion };
  const instanceRecord = {
    providerInstanceId: binding.providerInstanceId,
    recordVersion: binding.instanceRecordVersion,
    model: binding.model,
  };
  const proof: ProviderInvocationProofV1 = {
    schema: "afi.provider-invocation-proof.v1",
    category,
    resultSchema: RESULT_SCHEMA_BY_CATEGORY[category],
    provider: {
      providerId: binding.providerId,
      recordVersion: binding.providerRecordVersion,
      recordFingerprint: providerRecordFingerprint(providerRecord),
      executionClass: category === "technical" || category === "pattern" ? "local" : "remote",
      deterministic: category === "technical" || category === "pattern",
    },
    providerInstance: {
      providerInstanceId: binding.providerInstanceId,
      recordVersion: binding.instanceRecordVersion,
      recordFingerprint: providerInstanceRecordFingerprint(instanceRecord),
      ...(binding.model !== undefined ? { model: binding.model } : {}),
    },
    adapter: {
      adapterId: binding.adapterId,
      adapterVersion: binding.adapterVersion,
      transportKind: category === "technical" || category === "pattern" ? "in-process" : "http",
    },
    credential: { mode: "keyless" },
    invocationInputHash: invocationInputHash(
      buildInvocationInputProjection({
        category,
        adapterId: binding.adapterId,
        adapterVersion: binding.adapterVersion,
        model: binding.model,
        params: {},
        signal: { schema: "afi.usignal.v1.1" },
      })
    ),
    providerResultHash: providerResultHash(laneResult),
    categoryResultHash: categoryResultHash(laneResult),
    status: "succeeded",
  };
  if (category === "technical") {
    proof.priceSource = (laneResult as { priceSource?: string }).priceSource;
  }
  if (category === "aiMl") {
    proof.aimlInvocation = {
      schema: "afi.aiml-invocation-proof.v1",
      profileId: "froggy-reference-v1",
      profileVersion: "1.0.0",
      resolverId: "froggy-agreement",
      resolverVersion: "1.0.0",
      codeConfigFingerprint: HEX64,
      hashLaw: "tiny-brains.hash.v1",
      inputHash: HEX64,
      outputHash: HEX64,
      status: "succeeded",
      experts: [
        {
          expertId: "chronos-bolt-forecaster",
          expertVersion: "1.0.0",
          posture: "probabilistic",
          status: "succeeded",
          outputHash: HEX64,
        },
        {
          expertId: "trend-baseline",
          expertVersion: "1.0.0",
          posture: "deterministic",
          status: "succeeded",
          outputHash: HEX64,
        },
      ],
    };
  }
  return proof;
}

function makeInvocations(): EvidenceInvocationCapture {
  const laneBindings = PROOF_CATEGORY_ORDER.map((c) => makeBinding(c));
  const proofs = PROOF_CATEGORY_ORDER.map((c) =>
    makeProof(c, laneBindings.find((b) => b.category === c)!, LANE_RESULTS[c] as { category: string })
  );
  return {
    proofs,
    laneResults: { ...LANE_RESULTS },
    laneBindings,
    decay: { ...DECAY },
  };
}

/** A complete, schema-valid composition context (real CanonicalHash refs). */
function makeContext(
  overrides: Partial<EvidenceCompositionContext> = {}
): EvidenceCompositionContext {
  const composition: CompositionRefV1 = {
    schema: "afi.composition-ref.v1",
    pipelineId: "froggy-trend-pullback",
    pipelineVersion: "v1.3.0",
    manifestHash: canonicalHashOf({ fixture: "manifest" }, DOMAIN_TAGS.compositionManifest),
    analystConfigHash: canonicalHashOf({ fixture: "config" }, DOMAIN_TAGS.analystConfig),
    scorerPluginId: "afi-scorer-froggy-trend-pullback",
    scorerPluginVersion: "1.0.0",
    pluginSetHash: canonicalHashOf({ fixture: "plugins" }, DOMAIN_TAGS.pluginSet),
    executionSummaryHash: canonicalHashOf({ fixture: "summary" }, DOMAIN_TAGS.executionSummary),
    enrichmentHash: canonicalHashOf({ fixture: "enrichment" }, DOMAIN_TAGS.enrichmentBundle),
  };
  return {
    composition: (overrides.composition as CompositionRefV1) ?? composition,
    registration:
      overrides.registration ??
      ({
        analystId: "froggy",
        strategyId: "trend_pullback_v1",
        strategyVersion: "1.0.0",
        uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
      } as EvidenceCompositionContext["registration"]),
    invocations: overrides.invocations ?? makeInvocations(),
  };
}

/** Fake afi-infra evidence store. Records submissions; drives outcomes/errors. */
class FakeStore implements EvidenceStorePort {
  submissions: ReactorEvidenceRecord[] = [];
  constructor(private behavior: "inserted" | "idempotent" | "conflict" | "persistence" | "schema") {}
  async submit(record: ReactorEvidenceRecord): Promise<EvidenceSubmitResult> {
    this.submissions.push(record);
    const base = { signalId: record.signalId, recordVersion: 1 };
    if (this.behavior === "inserted") return { outcome: "inserted", ...base };
    if (this.behavior === "idempotent") return { outcome: "idempotent-duplicate", ...base };
    const err = new Error(this.behavior) as Error & { code: string };
    err.code =
      this.behavior === "conflict"
        ? "IDEMPOTENCY_CONFLICT"
        : this.behavior === "schema"
          ? "SCHEMA_VALIDATION"
          : "PERSISTENCE_FAILURE";
    throw err;
  }
}

describe("buildReactorEvidenceRecord (v3)", () => {
  it("produces a governed, schema-valid, identifier-continuous SCORED v3 record", () => {
    const record = buildReactorEvidenceRecord(makeScored(), makeContext());

    expect(record.schema).toBe("afi.scored-signal-evidence.v3");
    expect(record.lifecycleState).toBe("SCORED");
    expect(record.finalized).toBe(false);
    // complete strategy triple carried at top level
    expect(record.analystId).toBe("froggy");
    expect(record.strategyId).toBe("trend_pullback_v1");
    expect(record.strategyVersion).toBe("1.0.0");
    // carries the canonical projection + provenance record (preimages UNCHANGED)
    expect(record.scoredSignal.schema).toBe("afi.scored-signal.v1");
    expect(record.provenanceRecord.schema).toBe("afi.provenance-record.v1");
    expect(record.provenanceRecord.inputHash).toBeTruthy();
    expect(record.provenanceRecord.outputHash).toBeTruthy();
    // the REQUIRED composition provenance (carried forward from v2)
    expect(record.composition.schema).toBe("afi.composition-ref.v1");
    expect(record.composition.executionSummaryHash.domainTag).toBe("afi.d2.execution-summary");
    expect(record.composition.enrichmentHash.domainTag).toBe("afi.d2.enrichment-bundle");
    // v3's three additions: five ordered proofs + the two record commitments
    expect(record.providerInvocations.map((p) => p.category)).toEqual([
      "aiMl",
      "news",
      "pattern",
      "sentiment",
      "technical",
    ]);
    expect(record.providerInvocations[0].aimlInvocation?.schema).toBe(
      "afi.aiml-invocation-proof.v1"
    );
    expect(record.recordHash.domainTag).toBe("afi.d2.evidence-record");
    expect(record.replayHash.domainTag).toBe("afi.d2.evidence-replay");
    // recordHash/replayHash recompute over the assembled record (D-EV3-4(6))
    expect(evidenceRecordHash(record)).toEqual(record.recordHash);
    expect(evidenceReplayHash(record)).toEqual(record.replayHash);

    // the FULL record valid against the VENDORED v3 closure
    const v3 = validateEvidenceRecordV3(record);
    expect(v3.errors).toEqual([]);
    expect(v3.ok).toBe(true);
    // sub-artifacts valid against their governed afi-config D2 schemas
    expect(validateScoredSignalV1(record.scoredSignal).ok).toBe(true);
    expect(validateProvenanceRecordV1(record.provenanceRecord).ok).toBe(true);
    // identifier continuity holds across record / projection / provenance
    expect(record.scoredSignal.signalId).toBe(record.signalId);
    expect(record.provenanceRecord.signalId).toBe(record.signalId);
    expect(record.scoredSignal.strategyVersion).toBe(record.strategyVersion);
    expect(record.provenanceRecord.canonicalizationVersion).toBe(record.canonicalizationVersion);
  });

  it("the v2→v3 evolution left the projection/provenance PREIMAGES unchanged; replayHash excludes lifecycle custody", () => {
    const a = buildReactorEvidenceRecord(makeScored(), makeContext());
    const b = buildReactorEvidenceRecord(makeScored(), {
      ...makeContext(),
      composition: {
        ...makeContext().composition,
        executionSummaryHash: canonicalHashOf({ other: true }, DOMAIN_TAGS.executionSummary),
      },
    });
    expect(a.provenanceRecord.inputHash).toEqual(b.provenanceRecord.inputHash);
    expect(a.provenanceRecord.outputHash).toEqual(b.provenanceRecord.outputHash);
    expect(a.scoredSignal).toEqual(b.scoredSignal);
    // a composition change MOVES both record-level commitments
    expect(a.recordHash.value).not.toBe(b.recordHash.value);
    expect(a.replayHash.value).not.toBe(b.replayHash.value);
    // identical canonical inputs → identical replay projections (D-EV3-4(7))
    const c = buildReactorEvidenceRecord(makeScored(), makeContext());
    expect(c.replayHash).toEqual(a.replayHash);
    expect(c.recordHash).toEqual(a.recordHash);
  });

  it("rejects a score missing the strategyVersion triple member", () => {
    const scored = makeScored({ analystScore: { strategyVersion: undefined } });
    expect(() => buildReactorEvidenceRecord(scored, makeContext())).toThrow(
      ReactorEvidenceConstructionError
    );
  });

  it("FAILS CLOSED without composition provenance (all-or-nothing)", () => {
    expect(() => buildReactorEvidenceRecord(makeScored(), undefined)).toThrow(
      ReactorEvidenceConstructionError
    );
    expect(() => buildReactorEvidenceRecord(makeScored(), null)).toThrow(
      ReactorEvidenceConstructionError
    );
  });

  it("FAILS CLOSED on PARTIAL composition provenance (a missing pin refuses to submit)", () => {
    const context = makeContext();
    delete (context.composition as unknown as Record<string, unknown>).enrichmentHash;
    expect(() => buildReactorEvidenceRecord(makeScored(), context)).toThrow(
      /Partial composition provenance/
    );
  });

  it("FAILS CLOSED without the invocation capture (no v3 record without its five proofs)", () => {
    const context = makeContext();
    (context as unknown as Record<string, unknown>).invocations = undefined;
    let caught: unknown;
    try {
      buildReactorEvidenceRecord(makeScored(), context);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EvidenceProofViolationError);
    expect((caught as EvidenceProofViolationError).reason).toBe("invocation-capture-missing");
  });

  it("FAILS CLOSED on a missing lane proof (all five lanes required, D-EV3-5(1))", () => {
    const invocations = makeInvocations();
    invocations.proofs = invocations.proofs.filter((p) => p.category !== "sentiment");
    let caught: unknown;
    try {
      buildReactorEvidenceRecord(makeScored(), makeContext({ invocations }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EvidenceProofViolationError);
    expect((caught as EvidenceProofViolationError).reason).toBe("proof-count");
  });

  it("FAILS CLOSED on a category-result hash that does not recompute from the consumed result", () => {
    const invocations = makeInvocations();
    (invocations.laneResults.news as Record<string, unknown>).news = {
      hasShockEvent: true,
      headlines: ["tampered"],
    };
    let caught: unknown;
    try {
      buildReactorEvidenceRecord(makeScored(), makeContext({ invocations }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EvidenceProofViolationError);
    expect((caught as EvidenceProofViolationError).reason).toBe("category-result-hash-mismatch");
  });

  it("FAILS CLOSED on a proof identity that differs from the boot-verified registry resolution", () => {
    const invocations = makeInvocations();
    const technical = invocations.proofs.find((p) => p.category === "technical")!;
    technical.adapter = { ...technical.adapter, adapterVersion: "9.9.9" };
    let caught: unknown;
    try {
      buildReactorEvidenceRecord(makeScored(), makeContext({ invocations }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EvidenceProofViolationError);
    expect((caught as EvidenceProofViolationError).reason).toBe("registry-identity-mismatch");
  });

  it("FAILS CLOSED on a decay identity that differs from the registration-resolved values", () => {
    const scored = makeScored({ decayParams: { halfLifeMinutes: 999, greeksTemplateId: "decay-swing-v1" } });
    let caught: unknown;
    try {
      buildReactorEvidenceRecord(scored, makeContext());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EvidenceProofViolationError);
    expect((caught as EvidenceProofViolationError).reason).toBe("decay-identity-mismatch");
  });

  // Governed scoring-profile stamp (PR-UWR-STAMP / RC-6), REGISTRY-BACKED
  // (FCP-GOV D-FCP-9 item 5): recognition flows from the resolved registration.
  it("stamps the governed profile, discriminating builtin as builtin-value-identity", () => {
    const record = buildReactorEvidenceRecord(
      makeScored({ uwrResolvedSource: "builtin" }),
      makeContext()
    );
    expect(record.uwrProfile).toBeDefined();
    expect(record.uwrProfile.source).toBe("builtin-value-identity");
    expect(record.uwrProfile.profileId).toBeTruthy();
    expect(record.uwrProfile.status).toBeTruthy();
    expect(record.uwrProfile.decisionRef).toBeTruthy();
  });

  it("discriminates a registry-resolved score as registry-consumed", () => {
    const record = buildReactorEvidenceRecord(
      makeScored({ uwrResolvedSource: "registry" }),
      makeContext()
    );
    expect(record.uwrProfile.source).toBe("registry-consumed");
    // Only `source` differs — profile identity metadata is byte-identical.
    const builtin = buildReactorEvidenceRecord(
      makeScored({ uwrResolvedSource: "builtin" }),
      makeContext()
    );
    expect(record.uwrProfile.profileId).toBe(builtin.uwrProfile.profileId);
    expect(record.uwrProfile.status).toBe(builtin.uwrProfile.status);
    expect(record.uwrProfile.decisionRef).toBe(builtin.uwrProfile.decisionRef);
  });

  it("FAILS CLOSED when the source was not propagated (never stamps unknown provenance)", () => {
    // An unpropagated/unknown source must never be silently omitted or guessed:
    // omission would masquerade as a pre-program record (RC-6).
    expect(() =>
      buildReactorEvidenceRecord(makeScored({ uwrResolvedSource: undefined }), makeContext())
    ).toThrow(ReactorEvidenceConstructionError);
    expect(() =>
      buildReactorEvidenceRecord(makeScored({ uwrResolvedSource: "fallback" }), makeContext())
    ).toThrow(ReactorEvidenceConstructionError);
  });

  it("stamps ANY registered identity through the generic registry-backed mechanism (no froggy conditional)", () => {
    const scored = makeScored({
      analystScore: {
        analystId: "atlas-probe",
        strategyId: "multi_branch_v1",
        strategyVersion: "1.0.0",
      },
    });
    const record = buildReactorEvidenceRecord(
      scored,
      makeContext({
        registration: {
          analystId: "atlas-probe",
          strategyId: "multi_branch_v1",
          strategyVersion: "1.0.0",
          uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
        },
      })
    );
    expect(record.uwrProfile.profileId).toBe("uwr-weighted-lifts-v0.1");
    expect(record.uwrProfile.source).toBe("builtin-value-identity");
  });

  it("FAILS CLOSED when the scorer identity does not match the resolved registration", () => {
    // The registration resolved froggy; a score claiming another identity
    // must not be stamped (recognition governance never granted it).
    const other = makeScored({ analystScore: { analystId: "kestrel" } });
    expect(() => buildReactorEvidenceRecord(other, makeContext())).toThrow(
      ReactorEvidenceConstructionError
    );
  });

  it("FAILS CLOSED when the registration references an unregistered UWR profile", () => {
    const context = makeContext({
      registration: {
        analystId: "froggy",
        strategyId: "trend_pullback_v1",
        strategyVersion: "1.0.0",
        uwrProfileRef: { profileId: "uwr-unregistered-v9" },
      },
    });
    expect(() => buildReactorEvidenceRecord(makeScored(), context)).toThrow(
      ReactorEvidenceConstructionError
    );
  });
});

describe("submitScoredSignalEvidence (v3)", () => {
  it("submits and reports an inserted outcome (persistence succeeded)", async () => {
    const store = new FakeStore("inserted");
    const out = await submitScoredSignalEvidence(makeScored(), store, makeContext(), SILENT);
    expect(out.outcome).toBe("inserted");
    expect(out.lifecycleState).toBe("SCORED");
    expect(store.submissions).toHaveLength(1);
    expect(store.submissions[0].signalId).toBe("sig-reactor-unit-1");
    expect(store.submissions[0].schema).toBe("afi.scored-signal-evidence.v3");
    expect(store.submissions[0].composition.schema).toBe("afi.composition-ref.v1");
    expect(store.submissions[0].providerInvocations).toHaveLength(5);
    expect(store.submissions[0].recordHash.value).toMatch(/^[a-f0-9]{64}$/);
    expect(store.submissions[0].replayHash.value).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports an idempotent duplicate as a (still successful) persisted state", async () => {
    const out = await submitScoredSignalEvidence(
      makeScored(),
      new FakeStore("idempotent"),
      makeContext(),
      SILENT
    );
    expect(out.outcome).toBe("idempotent-duplicate");
  });

  it("maps a conflicting duplicate to a first-class 409 conflict", async () => {
    await expect(
      submitScoredSignalEvidence(makeScored(), new FakeStore("conflict"), makeContext(), SILENT)
    ).rejects.toMatchObject({
      name: "ReactorEvidencePersistenceError",
      category: "conflict",
      httpStatus: 409,
    });
  });

  it("maps an unavailable store to a first-class 503 (persistence did not succeed)", async () => {
    await expect(
      submitScoredSignalEvidence(makeScored(), new FakeStore("persistence"), makeContext(), SILENT)
    ).rejects.toMatchObject({
      category: "persistence",
      httpStatus: 503,
    });
  });

  it("rejects a schema-invalid record BEFORE submission (never submits it)", async () => {
    // conviction 1.5 survives projection but violates the governed schema (max 1).
    const store = new FakeStore("inserted");
    const scored = makeScored({ analystScore: { conviction: 1.5 } });
    await expect(
      submitScoredSignalEvidence(scored, store, makeContext(), SILENT)
    ).rejects.toMatchObject({
      category: "validation",
      httpStatus: 500,
    });
    expect(store.submissions).toHaveLength(0); // invalid record never reached the store
  });

  it("rejects a record whose composition violates the vendored v3 closure BEFORE submission", async () => {
    const store = new FakeStore("inserted");
    const context = makeContext();
    // A malformed hash value survives construction shape checks but violates
    // the canonical-hash schema $ref'd by the vendored v3 closure.
    (context.composition.manifestHash as { value: string }).value = "not-a-sha256";
    await expect(
      submitScoredSignalEvidence(makeScored(), store, context, SILENT)
    ).rejects.toMatchObject({ category: "validation", httpStatus: 500 });
    expect(store.submissions).toHaveLength(0);
  });

  it("maps a D-EV3-5(3) proof violation to a first-class construction failure (no submit)", async () => {
    const store = new FakeStore("inserted");
    const invocations = makeInvocations();
    invocations.proofs = [...invocations.proofs, invocations.proofs[0]];
    await expect(
      submitScoredSignalEvidence(makeScored(), store, makeContext({ invocations }), SILENT)
    ).rejects.toMatchObject({ category: "construction", httpStatus: 500 });
    expect(store.submissions).toHaveLength(0);
  });

  it("propagates a persistence failure as a thrown error — never a silent success", async () => {
    const promise = submitScoredSignalEvidence(
      makeScored(),
      new FakeStore("persistence"),
      makeContext(),
      SILENT
    );
    await expect(promise).rejects.toBeInstanceOf(ReactorEvidencePersistenceError);
    // and does NOT resolve to an outcome
    await expect(promise).rejects.toBeDefined();
  });
});
