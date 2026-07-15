/**
 * MONGO-REACTOR-SUBMIT (Slot 3) — canonical evidence submission tests.
 *
 * Focused behaviors: success, idempotent duplicate, conflicting duplicate,
 * store unavailable, schema rejection (invalid record never submitted), and
 * persistence-failure propagation (never a silent success). Uses a fake store
 * (the Reactor is a submitter; it never touches MongoDB).
 */

import type { ReactorScoredSignalV1 } from "../../src/types/ReactorScoredSignalV1.js";
import {
  validateProvenanceRecordV1,
  validateScoredSignalV1,
} from "../../src/pipeheads/provenance/schemaValidation.js";
import {
  buildReactorEvidenceRecord,
  ReactorEvidenceConstructionError,
  type ReactorEvidenceRecord,
} from "../../src/evidence/reactorEvidenceRecord.js";
import {
  submitScoredSignalEvidence,
  ReactorEvidencePersistenceError,
  type EvidenceStorePort,
  type EvidenceSubmitResult,
} from "../../src/evidence/submitScoredSignalEvidence.js";

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
    scoredAt: "2026-01-15T12:00:00Z",
    decayParams: null,
    meta: { symbol: "BTCUSDT", timeframe: "1h", strategy: "trend_pullback_v1", direction: "long", source: "test" },
  } as unknown as ReactorScoredSignalV1;
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

describe("buildReactorEvidenceRecord", () => {
  it("produces a governed, schema-valid, identifier-continuous SCORED record", () => {
    const record = buildReactorEvidenceRecord(makeScored());

    expect(record.schema).toBe("afi.scored-signal-evidence.v1");
    expect(record.lifecycleState).toBe("SCORED");
    expect(record.finalized).toBe(false);
    // complete strategy triple carried at top level
    expect(record.analystId).toBe("froggy");
    expect(record.strategyId).toBe("trend_pullback_v1");
    expect(record.strategyVersion).toBe("1.0.0");
    // carries the canonical projection + provenance record
    expect(record.scoredSignal.schema).toBe("afi.scored-signal.v1");
    expect(record.provenanceRecord.schema).toBe("afi.provenance-record.v1");
    expect(record.provenanceRecord.inputHash).toBeTruthy();
    expect(record.provenanceRecord.outputHash).toBeTruthy();

    // sub-artifacts valid against their governed afi-config D2 schemas
    expect(validateScoredSignalV1(record.scoredSignal).ok).toBe(true);
    expect(validateProvenanceRecordV1(record.provenanceRecord).ok).toBe(true);
    // identifier continuity holds across record / projection / provenance
    expect(record.scoredSignal.signalId).toBe(record.signalId);
    expect(record.provenanceRecord.signalId).toBe(record.signalId);
    expect(record.scoredSignal.strategyVersion).toBe(record.strategyVersion);
    expect(record.provenanceRecord.canonicalizationVersion).toBe(record.canonicalizationVersion);
  });

  it("rejects a score missing the strategyVersion triple member", () => {
    const scored = makeScored({ analystScore: { strategyVersion: undefined } });
    expect(() => buildReactorEvidenceRecord(scored)).toThrow(ReactorEvidenceConstructionError);
  });
});

describe("submitScoredSignalEvidence", () => {
  it("submits and reports an inserted outcome (persistence succeeded)", async () => {
    const store = new FakeStore("inserted");
    const out = await submitScoredSignalEvidence(makeScored(), store, SILENT);
    expect(out.outcome).toBe("inserted");
    expect(out.lifecycleState).toBe("SCORED");
    expect(store.submissions).toHaveLength(1);
    expect(store.submissions[0].signalId).toBe("sig-reactor-unit-1");
  });

  it("reports an idempotent duplicate as a (still successful) persisted state", async () => {
    const out = await submitScoredSignalEvidence(makeScored(), new FakeStore("idempotent"), SILENT);
    expect(out.outcome).toBe("idempotent-duplicate");
  });

  it("maps a conflicting duplicate to a first-class 409 conflict", async () => {
    await expect(submitScoredSignalEvidence(makeScored(), new FakeStore("conflict"), SILENT)).rejects.toMatchObject({
      name: "ReactorEvidencePersistenceError",
      category: "conflict",
      httpStatus: 409,
    });
  });

  it("maps an unavailable store to a first-class 503 (persistence did not succeed)", async () => {
    await expect(submitScoredSignalEvidence(makeScored(), new FakeStore("persistence"), SILENT)).rejects.toMatchObject({
      category: "persistence",
      httpStatus: 503,
    });
  });

  it("rejects a schema-invalid record BEFORE submission (never submits it)", async () => {
    // conviction 1.5 survives projection but violates the governed schema (max 1).
    const store = new FakeStore("inserted");
    const scored = makeScored({ analystScore: { conviction: 1.5 } });
    await expect(submitScoredSignalEvidence(scored, store, SILENT)).rejects.toMatchObject({
      category: "validation",
      httpStatus: 500,
    });
    expect(store.submissions).toHaveLength(0); // invalid record never reached the store
  });

  it("propagates a persistence failure as a thrown error — never a silent success", async () => {
    const promise = submitScoredSignalEvidence(makeScored(), new FakeStore("persistence"), SILENT);
    await expect(promise).rejects.toBeInstanceOf(ReactorEvidencePersistenceError);
    // and does NOT resolve to an outcome
    await expect(promise).rejects.toBeDefined();
  });
});
