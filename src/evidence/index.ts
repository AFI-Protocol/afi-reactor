/**
 * Canonical scored-signal evidence submission (MONGO-REACTOR-SUBMIT, evolved
 * to v2 by FCP-GOV D-FCP-7). The Reactor constructs the governed
 * afi.scored-signal-evidence.v2 record (v1 + REQUIRED composition provenance)
 * and submits it through the afi-infra canonical evidence-store interface. It
 * never writes MongoDB directly and never retains a parallel canonical store.
 */

export {
  buildReactorEvidenceRecord,
  ReactorEvidenceConstructionError,
  EVIDENCE_SCHEMA,
  REACTOR_LIFECYCLE_STATE,
  type EvidenceCompositionContext,
  type ReactorEvidenceRecord,
} from "./reactorEvidenceRecord.js";
export { validateEvidenceRecordV2 } from "./evidenceV2Schema.js";
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
