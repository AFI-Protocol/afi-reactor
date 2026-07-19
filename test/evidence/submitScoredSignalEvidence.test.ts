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

import {
  validateProvenanceRecordV1,
  validateScoredSignalV1,
} from "../../src/evidence/provenance/schemaValidation.js";
import { validateEvidenceRecordV3 } from "../../src/evidence/evidenceV3Schema.js";
import {
  buildReactorEvidenceRecord,
  EvidenceProofViolationError,
  ReactorEvidenceConstructionError,
  type ReactorEvidenceRecord,
} from "../../src/evidence/reactorEvidenceRecord.js";
import {
  submitScoredSignalEvidence,
  ReactorEvidencePersistenceError,
  type EvidenceStorePort,
  type EvidenceSubmitResult,
} from "../../src/evidence/submitScoredSignalEvidence.js";
import {
  evidenceRecordHash,
  evidenceReplayHash,
} from "../../src/evidence/provenance/invocationProofHashes.js";
import { canonicalHashOf, DOMAIN_TAGS } from "../../src/pipeline/hashing.js";
// The shared five-lane Evidence V3 fixture world (EV3-GOV §15): scored
// signal, lane results, bindings, self-consistent proofs, composition context.
import { makeScored, makeInvocations, makeContext } from "./support/evidenceV3World.js";

const SILENT = { info: () => {}, error: () => {} };

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
