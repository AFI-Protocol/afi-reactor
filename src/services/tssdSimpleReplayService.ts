/**
 * TSSD Simple Replay Service
 * 
 * Provides read-only access to TSSD vault signals for quick lookup and audit.
 * 
 * This is a "simple replay" service - it fetches stored signals and presents
 * them in a clean, UI-friendly format WITHOUT re-running the pipeline.
 * 
 * For full deterministic replay (re-run pipeline + comparison), see vaultReplayService.ts
 * 
 * Features:
 * - Read-only (no writes, no mutations)
 * - Fast lookup by signalId
 * - Clean JSON view for UIs/dashboards
 * - Graceful error handling (404, 503, 500)
 * 
 * @module tssdSimpleReplayService
 */

import type { TssdSignalDocument } from "../types/TssdSignalDocument.js";
import type { SimpleReplayView } from "../types/SimpleReplayView.js";
import { getTssdCollection } from "./tssdVaultService.js";

/**
 * Get a simple replay view of a signal by ID
 * 
 * Fetches the TSSD document from MongoDB and maps it to a clean SimpleReplayView.
 * 
 * @param signalId - Unique signal identifier
 * @returns SimpleReplayView if found, null if not found
 * @throws Error if MongoDB is not configured or connection fails
 */
export async function getSimpleReplayViewBySignalId(
  signalId: string
): Promise<SimpleReplayView | null> {
  // Step 1: Get TSSD collection
  const collection = await getTssdCollection();
  
  if (!collection) {
    throw new Error("TSSD vault not configured (AFI_MONGO_URI not set)");
  }

  // Step 2: Query for the signal
  const doc = await collection.findOne({ signalId });

  if (!doc) {
    console.info(`ℹ️  Signal not found in TSSD vault: ${signalId}`);
    return null;
  }

  console.info(`✅ Signal found in TSSD vault: ${signalId}`);

  // Step 3: Map TSSD document to SimpleReplayView
  const view = mapTssdDocumentToSimpleView(doc);

  return view;
}

/**
 * Map a TSSD document to a SimpleReplayView
 * 
 * Transforms the raw MongoDB document into a clean, UI-friendly format.
 * 
 * @param doc - TSSD signal document from MongoDB
 * @returns SimpleReplayView
 */
function mapTssdDocumentToSimpleView(doc: TssdSignalDocument): SimpleReplayView {
  const view: SimpleReplayView = {
    signalId: doc.signalId,
    createdAt: doc.createdAt.toISOString(),
    source: doc.source,

    market: {
      symbol: doc.market.symbol,
      timeframe: doc.market.timeframe,
      marketType: doc.market.market,
      priceSource: doc.market.priceSource,
      venueType: doc.market.venueType,
    },

    strategy: {
      name: doc.strategy.name,
      direction: doc.strategy.direction,
    },

    pipeline: {
      uwrScore: doc.pipeline.uwrScore,
      decision: doc.pipeline.validatorDecision.decision,
      confidence: doc.pipeline.validatorDecision.uwrConfidence,
      validatorDecision: doc.pipeline.validatorDecision,
      execution: {
        status: doc.pipeline.execution.status,
        type: doc.pipeline.execution.type,
        timestamp: doc.pipeline.execution.timestamp,
        notes: doc.pipeline.execution.notes,
      },
      stageSummaries: doc.pipeline.stageSummaries,
    },

    // Include receipt provenance if present
    receiptProvenance: doc.receiptProvenance
      ? {
          mintStatus: doc.receiptProvenance.mintStatus,
          epochId: doc.receiptProvenance.epochId,
          receiptId: doc.receiptProvenance.receiptId,
          mintTxHash: doc.receiptProvenance.mintTxHash,
          beneficiary: doc.receiptProvenance.beneficiary,
          tokenAmount: doc.receiptProvenance.tokenAmount,
        }
      : undefined,

    // Include full raw document for debugging
    raw: doc,
  };

  return view;
}

