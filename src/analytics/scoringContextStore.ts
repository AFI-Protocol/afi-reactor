/**
 * OPERATIONAL analytics capture — the "why" behind each score.
 *
 * Writes one scoring-context document per scored signal into the
 * `afi_signal_analytics` database (same Atlas cluster as evidence, DIFFERENT
 * database): the lane payloads, meta, analyst score, and submission that
 * explain a score, keyed by signalId (the canonical join key, OBJ-GOV D-OBJ-1).
 *
 * PLANE RULES (afi-docs AFI_PORTABLE_PROTOCOL_SURFACE "Do not collapse
 * commitment, evidence, and analytics into one store"; MONGO-GOV D-MONGO-4:
 * operational stores are ordinary implementation, never canonical evidence):
 *  - NON-NORMATIVE: nothing here is protocol truth. The canonical record's
 *    per-lane hashes (categoryResultHash etc.) are what make these documents
 *    VERIFIABLE against the sealed evidence — never the other way round.
 *  - FAIL-OPEN: capture must never affect scoring, the HTTP response, or
 *    canonical persistence. Every failure is logged and swallowed.
 *  - This module must never import from src/evidence/ and no evidence code
 *    may depend on it.
 *
 * LIFECYCLE: a SHORT-LIVED MongoClient per capture (connect → upsert → close
 * in finally). A persistent client here once kept the event loop alive after
 * in-process harnesses (the CI compiled-build Mongo integration imports the
 * server and never signals shutdown), hanging the process at exit. Capture is
 * off the hot path and alert-rate-bounded, so per-write connections are the
 * correct trade: zero lifecycle coupling beats pooling.
 */
import { MongoClient, type Collection, type Document } from "mongodb";
import type { ReactorScoredSignalV1 } from "../types/ReactorScoredSignalV1.js";

const ANALYTICS_DB_ENV = "AFI_ANALYTICS_DB_NAME";
const ANALYTICS_ENABLED_ENV = "AFI_ANALYTICS_CAPTURE";
const URI_ENV = "AFI_EVIDENCE_MONGODB_URI";

const DEFAULT_DB = "afi_signal_analytics";
export const SCORING_CONTEXT_COLLECTION = "scoring_context";
export const SIGNAL_OUTCOMES_COLLECTION = "signal_outcomes";

// Index bootstrap happens at most once per process; per-write clients make
// this a flag, not a client-lifetime concern.
let indexEnsured = false;

/** Test seam: replace the collection factory (never used in production). */
let collectionFactory: (() => Promise<Collection<Document>>) | null = null;
export function __setAnalyticsCollectionForTests(
  factory: (() => Promise<Collection<Document>>) | null
): void {
  collectionFactory = factory;
  indexEnsured = factory !== null; // fakes need no index bootstrap
}

function enabled(): boolean {
  if (process.env[ANALYTICS_ENABLED_ENV] === "false") return false;
  return collectionFactory !== null || Boolean(process.env[URI_ENV]);
}

async function withContextCollection<T>(
  fn: (col: Collection<Document>) => Promise<T>
): Promise<T> {
  if (collectionFactory) return fn(await collectionFactory());
  const client = new MongoClient(process.env[URI_ENV] as string);
  try {
    await client.connect();
    const col = client
      .db(process.env[ANALYTICS_DB_ENV] || DEFAULT_DB)
      .collection(SCORING_CONTEXT_COLLECTION);
    if (!indexEnsured) {
      await col.createIndex({ signalId: 1 }, { unique: true, name: "signalId_unique" });
      indexEnsured = true;
    }
    return await fn(col);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Fire-and-forget capture of the full scoring context. Returns a promise only
 * so tests can await it; production call sites intentionally do not await.
 */
export function captureScoringContext(
  scored: ReactorScoredSignalV1,
  persistenceOutcome: unknown,
  route: string
): Promise<void> {
  if (!enabled()) return Promise.resolve();
  return withContextCollection(async (col) => {
    const s = scored as ReactorScoredSignalV1 & {
      lenses?: unknown;
      rawUss?: unknown;
      _priceFeedMetadata?: unknown;
      uwrResolvedSource?: unknown;
      decayParams?: unknown;
    };
    await col.updateOne(
      { signalId: scored.signalId },
      {
        $setOnInsert: {
          schema: "afi.operational.scoring-context.v0",
          plane: "operational",
          signalId: scored.signalId,
          capturedAt: new Date().toISOString(),
          route,
          persistenceOutcome,
          scoredAt: scored.scoredAt,
          meta: scored.meta,
          analystScore: scored.analystScore,
          uwrResolvedSource: s.uwrResolvedSource,
          decayParams: s.decayParams,
          rawUss: s.rawUss,
          lenses: s.lenses,
          priceFeedMetadata: s._priceFeedMetadata,
        },
      },
      { upsert: true }
    );
  }).then(
    () => undefined,
    (err: unknown) => {
      // FAIL-OPEN: analytics loss is acceptable; scoring impact is not.
      console.warn("[analytics] scoring-context capture failed (ignored)", {
        signalId: scored.signalId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  );
}
