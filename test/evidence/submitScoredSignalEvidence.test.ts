/**
 * Canonical evidence submission tests — afi.scored-signal-evidence.v2
 * (MONGO-REACTOR-SUBMIT evolved by FCP-GOV D-FCP-7: v2 = v1 + REQUIRED
 * composition provenance; the projection/provenance preimages are UNCHANGED).
 *
 * Focused behaviors: success, idempotent duplicate, conflicting duplicate,
 * store unavailable, schema rejection (invalid record never submitted),
 * persistence-failure propagation (never a silent success), the registry-
 * backed UWR stamp recognition, and the all-or-nothing composition rule.
 * Uses a fake store (the Reactor is a submitter; it never touches MongoDB).
 */

import type { ReactorScoredSignalV1 } from "../../src/types/ReactorScoredSignalV1.js";
import {
  validateProvenanceRecordV1,
  validateScoredSignalV1,
} from "../../src/pipeheads/provenance/schemaValidation.js";
import { validateEvidenceRecordV2 } from "../../src/evidence/evidenceV2Schema.js";
import {
  buildReactorEvidenceRecord,
  ReactorEvidenceConstructionError,
  type EvidenceCompositionContext,
  type ReactorEvidenceRecord,
} from "../../src/evidence/reactorEvidenceRecord.js";
import {
  submitScoredSignalEvidence,
  ReactorEvidencePersistenceError,
  type EvidenceStorePort,
  type EvidenceSubmitResult,
} from "../../src/evidence/submitScoredSignalEvidence.js";
import { canonicalHashOf, DOMAIN_TAGS } from "../../src/pipeline/hashing.js";
import type { CompositionRefV1 } from "../../src/pipeline/manifestTypes.js";

const SILENT = { info: () => {}, error: () => {} };

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
    decayParams: null,
    meta: { symbol: "BTCUSDT", timeframe: "1h", strategy: "trend_pullback_v1", direction: "long", source: "test" },
  } as unknown as ReactorScoredSignalV1;
}

/** A complete, schema-valid composition context (real CanonicalHash refs). */
function makeContext(
  overrides: Partial<EvidenceCompositionContext> = {}
): EvidenceCompositionContext {
  const composition: CompositionRefV1 = {
    schema: "afi.composition-ref.v1",
    pipelineId: "froggy-trend-pullback",
    pipelineVersion: "v1.0.0",
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

describe("buildReactorEvidenceRecord (v2)", () => {
  it("produces a governed, schema-valid, identifier-continuous SCORED v2 record", () => {
    const record = buildReactorEvidenceRecord(makeScored(), makeContext());

    expect(record.schema).toBe("afi.scored-signal-evidence.v2");
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
    // v2's one addition: the REQUIRED composition provenance
    expect(record.composition.schema).toBe("afi.composition-ref.v1");
    expect(record.composition.executionSummaryHash.domainTag).toBe("afi.d2.execution-summary");
    expect(record.composition.enrichmentHash.domainTag).toBe("afi.d2.enrichment-bundle");

    // the FULL record valid against the VENDORED v2 schema
    const v2 = validateEvidenceRecordV2(record);
    expect(v2.errors).toEqual([]);
    expect(v2.ok).toBe(true);
    // sub-artifacts valid against their governed afi-config D2 schemas
    expect(validateScoredSignalV1(record.scoredSignal).ok).toBe(true);
    expect(validateProvenanceRecordV1(record.provenanceRecord).ok).toBe(true);
    // identifier continuity holds across record / projection / provenance
    expect(record.scoredSignal.signalId).toBe(record.signalId);
    expect(record.provenanceRecord.signalId).toBe(record.signalId);
    expect(record.scoredSignal.strategyVersion).toBe(record.strategyVersion);
    expect(record.provenanceRecord.canonicalizationVersion).toBe(record.canonicalizationVersion);
  });

  it("the v1→v2 evolution left the projection/provenance PREIMAGES unchanged (hashes are composition-independent)", () => {
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
  });

  it("rejects a score missing the strategyVersion triple member", () => {
    const scored = makeScored({ analystScore: { strategyVersion: undefined } });
    expect(() => buildReactorEvidenceRecord(scored, makeContext())).toThrow(
      ReactorEvidenceConstructionError
    );
  });

  it("FAILS CLOSED without composition provenance (all-or-nothing; no v1 emission path remains)", () => {
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

  // Governed scoring-profile stamp (PR-UWR-STAMP / RC-6), now REGISTRY-BACKED
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

describe("submitScoredSignalEvidence (v2)", () => {
  it("submits and reports an inserted outcome (persistence succeeded)", async () => {
    const store = new FakeStore("inserted");
    const out = await submitScoredSignalEvidence(makeScored(), store, makeContext(), SILENT);
    expect(out.outcome).toBe("inserted");
    expect(out.lifecycleState).toBe("SCORED");
    expect(store.submissions).toHaveLength(1);
    expect(store.submissions[0].signalId).toBe("sig-reactor-unit-1");
    expect(store.submissions[0].schema).toBe("afi.scored-signal-evidence.v2");
    expect(store.submissions[0].composition.schema).toBe("afi.composition-ref.v1");
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

  it("rejects a record whose composition violates the vendored v2 schema BEFORE submission", async () => {
    const store = new FakeStore("inserted");
    const context = makeContext();
    // A malformed hash value survives construction shape checks but violates
    // the canonical-hash schema $ref'd by the vendored v2 schema.
    (context.composition.manifestHash as { value: string }).value = "not-a-sha256";
    await expect(
      submitScoredSignalEvidence(makeScored(), store, context, SILENT)
    ).rejects.toMatchObject({ category: "validation", httpStatus: 500 });
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
