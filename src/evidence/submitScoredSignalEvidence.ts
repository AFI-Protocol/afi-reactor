/**
 * MONGO-REACTOR-SUBMIT (Slot 3) — submit a scored signal's canonical evidence
 * record through the afi-infra canonical evidence-store interface.
 *
 * The Reactor is a SUBMITTER, never a writer (MONGO-GOV D-MONGO-3): it never
 * touches MongoDB directly. Canonical persistence is a REQUIRED step of the
 * scoring run — any failure (construction, governed-schema invalidity, identifier
 * discontinuity, conflict, or store/persistence failure) is a FIRST-CLASS failure
 * (MONGO-GOV D-MONGO-8), surfaced as a typed error the HTTP layer maps to an
 * honest non-2xx status. It is never swallowed into a success.
 *
 * Governed-schema validity (the canonical scored-signal projection and the
 * provenance record) and identifier continuity are PROVEN before submission,
 * using the Reactor's own governed validators (the same afi-config D2 schemas the
 * store's evidence schema $refs). The afi-infra store re-validates the FULL
 * `afi.scored-signal-evidence.v1` record authoritatively on submit.
 */

import type { ReactorScoredSignalV1 } from "../types/ReactorScoredSignalV1.js";
import {
  validateProvenanceRecordV1,
  validateScoredSignalV1,
} from "../pipeheads/provenance/schemaValidation.js";
import {
  buildReactorEvidenceRecord,
  EVIDENCE_SCHEMA,
  REACTOR_LIFECYCLE_STATE,
  ReactorEvidenceConstructionError,
  type ReactorEvidenceRecord,
} from "./reactorEvidenceRecord.js";

/** Result of a submission through the canonical evidence-store interface. */
export interface EvidenceSubmitResult {
  outcome: "inserted" | "idempotent-duplicate";
  signalId: string;
  recordVersion: number;
}

/** The single afi-infra mutation surface the Reactor submits through (D-MONGO-3).
 *  Structurally compatible with afi-infra's IScoredSignalEvidenceStore.submit. */
export interface EvidenceStorePort {
  submit(record: ReactorEvidenceRecord): Promise<EvidenceSubmitResult>;
}

export type EvidencePersistenceCategory =
  | "construction"
  | "validation"
  | "continuity"
  | "conflict"
  | "persistence";

/**
 * A canonical-persistence failure carried as a first-class scoring-run failure
 * with an HONEST HTTP status. Never implies persistence succeeded.
 */
export class ReactorEvidencePersistenceError extends Error {
  readonly category: EvidencePersistenceCategory;
  readonly httpStatus: number;
  readonly signalId?: string;
  readonly cause?: unknown;
  constructor(
    category: EvidencePersistenceCategory,
    message: string,
    httpStatus: number,
    signalId?: string,
    cause?: unknown
  ) {
    super(message);
    this.name = "ReactorEvidencePersistenceError";
    this.category = category;
    this.httpStatus = httpStatus;
    this.signalId = signalId;
    this.cause = cause;
  }
}

export interface EvidencePersistenceOutcome {
  outcome: "inserted" | "idempotent-duplicate";
  signalId: string;
  recordVersion: number;
  lifecycleState: typeof REACTOR_LIFECYCLE_STATE;
}

type Logger = { info?: (...a: unknown[]) => void; error?: (...a: unknown[]) => void };

const HASH_VERSION = /^afi\.hash\.v[0-9]+$/;

/** The governed RC-6 source discriminators — the ONLY fixed vocabulary on the
 *  otherwise analyst-neutral scoring-profile stamp. */
const GOVERNED_STAMP_SOURCES = ["builtin-value-identity", "registry-consumed"] as const;

/** Structural validity of the evidence wrapper (schema-id, lifecycle/finality,
 *  the complete strategy triple, version). Sub-artifacts are validated separately
 *  against their governed schemas. */
function evidenceWrapperViolations(r: ReactorEvidenceRecord): string[] {
  const v: string[] = [];
  if (r.schema !== EVIDENCE_SCHEMA) v.push("schema is not afi.scored-signal-evidence.v1");
  if (r.lifecycleState !== REACTOR_LIFECYCLE_STATE) v.push("lifecycleState is not SCORED");
  if (r.finalized !== false) v.push("finalized must be false for a SCORED record");
  if (!r.analystId) v.push("analystId missing");
  if (!r.strategyId) v.push("strategyId missing");
  if (!r.strategyVersion) v.push("strategyVersion missing (complete triple required)");
  if (!HASH_VERSION.test(r.canonicalizationVersion)) v.push("canonicalizationVersion malformed");
  // Governed scoring-profile stamp: REQUIRED on every canonical evidence record,
  // with the RC-6 source discriminator (the only governed vocabulary). Proven
  // here before submission; the afi-infra store re-validates authoritatively.
  const stamp = r.uwrProfile;
  if (!stamp) {
    v.push("uwrProfile stamp missing (required on every canonical evidence record)");
  } else {
    if (!stamp.profileId) v.push("uwrProfile.profileId missing");
    if (!stamp.status) v.push("uwrProfile.status missing");
    if (!stamp.decisionRef) v.push("uwrProfile.decisionRef missing");
    if (!GOVERNED_STAMP_SOURCES.includes(stamp.source as never)) {
      v.push(`uwrProfile.source '${String(stamp.source)}' is not a governed RC-6 discriminator`);
    }
  }
  return v;
}

/** Identifier continuity across the evidence record, projection, and provenance
 *  record (OBJ-GOV D-OBJ-1/D-OBJ-3/D-OBJ-6, LIFE-GOV D-LIFE-5). */
function continuityViolations(r: ReactorEvidenceRecord): string[] {
  const v: string[] = [];
  if (r.scoredSignal.signalId !== r.signalId) v.push("signalId != scoredSignal.signalId");
  if (r.provenanceRecord.signalId !== r.signalId) v.push("signalId != provenanceRecord.signalId");
  if (r.scoredSignal.analystId !== r.analystId) v.push("analystId != scoredSignal.analystId");
  if (r.scoredSignal.strategyId !== r.strategyId) v.push("strategyId != scoredSignal.strategyId");
  if (r.scoredSignal.strategyVersion !== r.strategyVersion) {
    v.push("strategyVersion != scoredSignal.strategyVersion");
  }
  if (r.provenanceRecord.canonicalizationVersion !== r.canonicalizationVersion) {
    v.push("canonicalizationVersion != provenanceRecord.canonicalizationVersion");
  }
  return v;
}

/**
 * Build → prove (governed schema + continuity) → submit. Returns the outcome on
 * success (insert or idempotent duplicate); throws ReactorEvidencePersistenceError
 * on any failure. Logs carry only the signalId and outcome/category — never the
 * full record, rawUss, or any payload.
 */
export async function submitScoredSignalEvidence(
  scored: ReactorScoredSignalV1,
  store: EvidenceStorePort,
  logger: Logger = console
): Promise<EvidencePersistenceOutcome> {
  const signalId = scored.signalId;

  // 1. Construct the governed evidence record.
  let record: ReactorEvidenceRecord;
  try {
    record = buildReactorEvidenceRecord(scored);
  } catch (err) {
    const msg =
      err instanceof ReactorEvidenceConstructionError
        ? err.message
        : `unexpected evidence construction error for signalId '${signalId}': ${(err as Error)?.message ?? String(err)}`;
    throw new ReactorEvidencePersistenceError("construction", msg, 500, signalId, err);
  }

  // 2. PROVE governed-schema validity BEFORE submission (projection + provenance
  //    against their afi-config D2 schemas; the evidence wrapper structurally).
  const wrapper = evidenceWrapperViolations(record);
  const ss = validateScoredSignalV1(record.scoredSignal);
  const pr = validateProvenanceRecordV1(record.provenanceRecord);
  if (wrapper.length > 0 || !ss.ok || !pr.ok) {
    logger.error?.("[evidence] governed-schema validation failed", {
      signalId,
      wrapper: wrapper.length,
      scoredSignal: ss.ok ? 0 : ss.errors.length,
      provenanceRecord: pr.ok ? 0 : pr.errors.length,
    });
    throw new ReactorEvidencePersistenceError(
      "validation",
      `Evidence record for signalId '${signalId}' failed governed-schema validation before submission.`,
      500,
      signalId
    );
  }

  // 3. PROVE identifier continuity BEFORE submission.
  const continuity = continuityViolations(record);
  if (continuity.length > 0) {
    throw new ReactorEvidencePersistenceError(
      "continuity",
      `Identifier continuity violated for signalId '${signalId}': ${continuity.join("; ")}.`,
      500,
      signalId
    );
  }

  // 4. Submit through the afi-infra canonical evidence-store interface.
  try {
    const res = await store.submit(record);
    logger.info?.("[evidence] canonical persistence ok", {
      signalId,
      outcome: res.outcome,
      recordVersion: res.recordVersion,
      lifecycleState: REACTOR_LIFECYCLE_STATE,
    });
    return {
      outcome: res.outcome,
      signalId: res.signalId,
      recordVersion: res.recordVersion,
      lifecycleState: REACTOR_LIFECYCLE_STATE,
    };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    logger.error?.("[evidence] canonical persistence failed", { signalId, code: code ?? "unknown" });
    if (code === "IDEMPOTENCY_CONFLICT") {
      throw new ReactorEvidencePersistenceError(
        "conflict",
        `A different canonical record already exists for signalId '${signalId}'.`,
        409,
        signalId,
        err
      );
    }
    if (code === "SCHEMA_VALIDATION" || code === "IDENTIFIER_CONTINUITY") {
      throw new ReactorEvidencePersistenceError(
        "validation",
        `Canonical store rejected the record for signalId '${signalId}' (${code}).`,
        500,
        signalId,
        err
      );
    }
    // PERSISTENCE_FAILURE, store unavailable/unconfigured, or any other store
    // error → canonical persistence did NOT succeed. First-class, never a 200.
    throw new ReactorEvidencePersistenceError(
      "persistence",
      `Canonical evidence persistence failed for signalId '${signalId}': ${(err as Error)?.message ?? String(err)}`,
      503,
      signalId,
      err
    );
  }
}
