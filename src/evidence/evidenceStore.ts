/**
 * MONGO-REACTOR-SUBMIT (Slot 3) — canonical evidence-store provider.
 *
 * Resolves the afi-infra canonical evidence-store interface the Reactor submits
 * through. The Reactor owns only the PORT; the concrete afi-infra
 * MongoScoredSignalEvidenceStore is bound purely at RUNTIME (a variable-specifier
 * dynamic import) so afi-infra's TypeScript source never enters the Reactor's
 * compile graph. Tests inject a fake via setEvidenceStore().
 *
 * If the store cannot be loaded or is not configured (no AFI_EVIDENCE_MONGODB_URI),
 * submissions fail with a first-class PERSISTENCE_FAILURE → honest 503, never a
 * masked success. (Binding the live store additionally requires afi-infra to ship
 * a consumable build — see the PR's cross-slot integration note.)
 */

import type { EvidenceStorePort } from "./submitScoredSignalEvidence.js";

let injected: EvidenceStorePort | null = null;
let cached: EvidenceStorePort | null = null;

/** Default afi-infra store module (overridable via env for packaging changes). */
const DEFAULT_STORE_MODULE =
  process.env.AFI_EVIDENCE_STORE_MODULE ??
  "afi-infra/src/evidence/MongoScoredSignalEvidenceStore.js";

/** Inject a store (tests / composition root). Pass null to clear. */
export function setEvidenceStore(store: EvidenceStorePort | null): void {
  injected = store;
  cached = null;
}

/** A port that fails honestly when no canonical store is available. */
function unavailableStore(reason: string): EvidenceStorePort {
  return {
    async submit() {
      const err = new Error(
        `Canonical evidence store unavailable: ${reason}`
      ) as Error & { code: string };
      err.code = "PERSISTENCE_FAILURE";
      throw err;
    },
  };
}

/** Resolve the evidence store: injected override, else the lazily-bound afi-infra
 *  Mongo store, else an honest-failing port. */
export async function getEvidenceStore(): Promise<EvidenceStorePort> {
  if (injected) return injected;
  if (cached) return cached;
  try {
    const spec = DEFAULT_STORE_MODULE;
    const mod = (await import(spec)) as {
      MongoScoredSignalEvidenceStore: new () => EvidenceStorePort;
    };
    cached = new mod.MongoScoredSignalEvidenceStore();
    return cached;
  } catch (err) {
    return unavailableStore(`afi-infra store module could not be loaded (${(err as Error)?.message ?? String(err)})`);
  }
}

/** Reset provider state (tests). */
export function resetEvidenceStore(): void {
  injected = null;
  cached = null;
}
