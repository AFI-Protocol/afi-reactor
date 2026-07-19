/**
 * Canonical scored-signal evidence submission (MONGO-REACTOR-SUBMIT, evolved
 * to v3 by EV3-GOV). The Reactor constructs the governed
 * afi.scored-signal-evidence.v3 record (the v2 core carried forward
 * unchanged + the five provider invocation proofs + recordHash/replayHash)
 * and submits it through the afi-infra canonical evidence-store interface.
 * It never writes MongoDB directly and never retains a parallel canonical
 * store.
 */

export {
  buildReactorEvidenceRecord,
  ReactorEvidenceConstructionError,
  EvidenceProofViolationError,
  EVIDENCE_SCHEMA,
  REACTOR_LIFECYCLE_STATE,
  type EvidenceCompositionContext,
  type EvidenceInvocationCapture,
  type EvidenceProofViolationReason,
  type LaneBindingExpectation,
  type ReactorEvidenceRecord,
} from "./reactorEvidenceRecord.js";
export { validateEvidenceRecordV3 } from "./evidenceV3Schema.js";
export {
  submitScoredSignalEvidence,
  ReactorEvidencePersistenceError,
  type EvidenceStorePort,
  type EvidencePersistenceOutcome,
  type EvidencePersistenceCategory,
} from "./submitScoredSignalEvidence.js";
export {
  getEvidenceStore,
  setEvidenceStore,
  resetEvidenceStore,
  closeEvidenceStore,
} from "./evidenceStore.js";
