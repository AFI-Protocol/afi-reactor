/**
 * MONGO-REACTOR-SUBMIT (Slot 3) — canonical scored-signal evidence submission.
 * The Reactor constructs the governed afi.scored-signal-evidence.v1 record and
 * submits it through the afi-infra canonical evidence-store interface. It never
 * writes MongoDB directly and never retains a parallel canonical store.
 */

export {
  buildReactorEvidenceRecord,
  ReactorEvidenceConstructionError,
  EVIDENCE_SCHEMA,
  REACTOR_LIFECYCLE_STATE,
} from "./reactorEvidenceRecord.js";
export {
  submitScoredSignalEvidence,
  ReactorEvidencePersistenceError,
  type EvidenceStorePort,
  type EvidencePersistenceOutcome,
  type EvidencePersistenceCategory,
} from "./submitScoredSignalEvidence.js";
export { getEvidenceStore, setEvidenceStore, resetEvidenceStore } from "./evidenceStore.js";
