/**
 * MONGO-REACTOR-SUBMIT (Slot 3) — canonical evidence-store provider.
 *
 * Resolves the afi-infra canonical evidence store the Reactor submits through.
 * The Reactor owns only the submit PORT (MONGO-GOV D-MONGO-3); the concrete
 * store is afi-infra's `MongoScoredSignalEvidenceStore`, consumed as a NORMAL
 * TYPED package dependency (afi-infra ships a consumable build with `.d.ts`).
 * Tests inject a fake via setEvidenceStore().
 *
 * Store-unavailable and persistence failures are NEVER masked. The afi-infra
 * store fails a submit with a typed PERSISTENCE_FAILURE when it is not
 * configured for MongoDB (no AFI_EVIDENCE_MONGODB_URI) or cannot reach the
 * server; submitScoredSignalEvidence surfaces that as an honest 503. Genuine
 * store-unavailability is therefore reported faithfully by the real store — no
 * placeholder/stub port is needed now that afi-infra is consumable.
 */

import { MongoScoredSignalEvidenceStore } from "afi-infra";
import type { ScoredSignalEvidenceRecord } from "afi-infra";
import type { EvidenceStorePort } from "./submitScoredSignalEvidence.js";

let injected: EvidenceStorePort | null = null;
let cached: EvidenceStorePort | null = null;
/** The concrete afi-infra store behind `cached`, kept so it can be closed on
 *  graceful shutdown (the submit-only port does not expose close()). */
let cachedStore: MongoScoredSignalEvidenceStore | null = null;

/** Inject a store (tests / composition root). Pass null to clear. */
export function setEvidenceStore(store: EvidenceStorePort | null): void {
  injected = store;
  cached = null;
  cachedStore = null;
}

/**
 * Resolve the evidence store: an injected override (tests / composition root),
 * else the afi-infra canonical Mongo store, configured from the environment
 * (AFI_EVIDENCE_MONGODB_URI + AFI_EVIDENCE_* db/collection overrides). The store
 * fails submissions honestly when it is unconfigured or MongoDB is unreachable.
 */
export function getEvidenceStore(): EvidenceStorePort {
  if (injected) return injected;
  if (!cached) {
    const store = new MongoScoredSignalEvidenceStore();
    cachedStore = store;
    // Anti-corruption bridge (the Reactor's single afi-infra submit boundary):
    // the Reactor's port carries its own STRICT governed-record mirror
    // (ReactorEvidenceRecord, keyed on the Reactor's District-2 provenance
    // types); afi-infra's store takes the equivalent `ScoredSignalEvidenceRecord`.
    // The two are the SAME governed afi.scored-signal-evidence.v1 record at
    // runtime and differ only by the open `[k: string]: unknown` index signature
    // afi-infra's ergonomic mirror types declare — a compile-time-only nominal
    // gap. The store re-validates the FULL record against the authoritative
    // governed afi-config JSON Schema on submit, so the runtime contract is
    // enforced by afi-infra, not this cast.
    cached = {
      submit: (record) => store.submit(record as unknown as ScoredSignalEvidenceRecord),
    };
  }
  return cached;
}

/** Reset provider state (tests). */
export function resetEvidenceStore(): void {
  injected = null;
  cached = null;
  cachedStore = null;
}

/**
 * Close the bound canonical evidence store's MongoDB connection for a clean
 * shutdown (releases the driver's sockets + monitoring timers so the process can
 * exit naturally — e.g. on SIGTERM under Cloud Run). No-op when no concrete store
 * is bound; an injected (test) store is left for the test to manage.
 */
export async function closeEvidenceStore(): Promise<void> {
  const store = cachedStore;
  cached = null;
  cachedStore = null;
  if (store) {
    await store.close();
  }
}
