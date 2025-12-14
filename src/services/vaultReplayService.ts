/**
 * Vault Replay Service (Phase 2)
 * 
 * Provides read-only replay functionality for signals stored in the TSSD vault.
 * 
 * This service:
 * - Fetches signals from MongoDB
 * - Reconstructs pipeline input from stored TSSD documents
 * - Re-runs the Froggy pipeline deterministically
 * - Compares stored vs recomputed values
 * - Returns structured replay results for auditors and regression testing
 * 
 * Phase 2 Scope:
 * - READ-ONLY (no MongoDB writes from replay)
 * - Supports Froggy trend-pullback pipeline only
 * - Replay by signalId (primary use case)
 * - Graceful degradation (no-op if MongoDB unavailable)
 * 
 * @module vaultReplayService
 */

import type { TssdSignalDocument, ReplayResult } from "../types/TssdSignalDocument.js";
import type { TradingViewAlertPayload } from "./froggyDemoService.js";
import { getTssdCollection } from "./tssdVaultService.js";
import { runFroggyTrendPullbackFromTradingView } from "./froggyDemoService.js";

/**
 * Replay a signal by ID
 * 
 * Fetches the signal from TSSD vault, reconstructs the pipeline input,
 * re-runs the Froggy pipeline, and compares stored vs recomputed values.
 * 
 * @param signalId - Unique signal identifier
 * @returns Replay result with stored vs recomputed comparison, or null if signal not found
 */
export async function replaySignalById(signalId: string): Promise<ReplayResult | null> {
  try {
    // Step 1: Fetch TSSD document from MongoDB
    const collection = await getTssdCollection();
    if (!collection) {
      throw new Error("TSSD vault not configured (AFI_MONGO_URI not set)");
    }

    const storedDoc = await collection.findOne({ signalId });
    if (!storedDoc) {
      console.warn(`⚠️  Signal not found in TSSD vault: ${signalId}`);
      return null;
    }

    console.info(`✅ Signal found in TSSD vault: ${signalId}`);

    // Step 2: Reconstruct pipeline input from stored document
    const pipelineInput = reconstructPipelineInput(storedDoc);

    console.info(`🔄 Replaying signal through Froggy pipeline: ${signalId}`);

    // Step 3: Re-run the Froggy pipeline (read-only, no vault writes)
    const recomputedResult = await runFroggyTrendPullbackFromTradingView(pipelineInput, {
      includeStageSummaries: false,
      isDemo: false,
    });

    console.info(`✅ Pipeline replay complete: ${signalId}`);

    // Step 4: Build replay result with comparison
    const replayResult = buildReplayResult(storedDoc, recomputedResult);

    return replayResult;
  } catch (error: any) {
    console.error(`❌ Failed to replay signal:`, {
      signalId,
      error: error.message || String(error),
    });
    throw error;
  }
}

/**
 * Reconstruct pipeline input from TSSD document
 * 
 * Maps a stored TSSD document back to the TradingView alert payload format
 * that the Froggy pipeline expects.
 * 
 * @param doc - TSSD signal document from vault
 * @returns TradingView alert payload for pipeline replay
 */
function reconstructPipelineInput(doc: TssdSignalDocument): TradingViewAlertPayload {
  // If rawPayload is available, use it directly (most accurate)
  if (doc.rawPayload && typeof doc.rawPayload === "object") {
    const raw = doc.rawPayload as any;
    return {
      symbol: raw.symbol || doc.market.symbol,
      market: raw.market || doc.market.market,
      timeframe: raw.timeframe || doc.market.timeframe,
      strategy: raw.strategy || doc.strategy.name,
      direction: raw.direction || doc.strategy.direction,
      setupSummary: raw.setupSummary,
      notes: raw.notes,
      enrichmentProfile: raw.enrichmentProfile,
      signalId: doc.signalId,
    };
  }

  // Otherwise, reconstruct from structured fields
  return {
    symbol: doc.market.symbol,
    market: doc.market.market,
    timeframe: doc.market.timeframe,
    strategy: doc.strategy.name,
    direction: doc.strategy.direction as "long" | "short" | "neutral",
    setupSummary: "Replay from TSSD vault (no original setupSummary available)",
    notes: `Replayed from TSSD vault at ${new Date().toISOString()}`,
    signalId: doc.signalId,
  };
}

/**
 * Build replay result with stored vs recomputed comparison
 * 
 * @param storedDoc - Original TSSD document from vault
 * @param recomputedResult - Fresh pipeline result from replay
 * @returns Structured replay result with comparison
 */
function buildReplayResult(
  storedDoc: TssdSignalDocument,
  recomputedResult: any
): ReplayResult {
  // Extract stored values
  const stored = {
    analystScore: storedDoc.pipeline.analystScore,
    scoredAt: storedDoc.pipeline.scoredAt,
    decayParams: storedDoc.pipeline.decayParams,
    validatorDecision: storedDoc.pipeline.validatorDecision,
    execution: {
      status: storedDoc.pipeline.execution.status,
      type: storedDoc.pipeline.execution.type,
      timestamp: storedDoc.pipeline.execution.timestamp,
    },
    meta: {
      symbol: storedDoc.market.symbol,
      timeframe: storedDoc.market.timeframe,
      strategy: storedDoc.strategy.name,
      direction: storedDoc.strategy.direction,
      source: storedDoc.source,
      createdAt: storedDoc.createdAt,
    },
    receiptProvenance: storedDoc.receiptProvenance
      ? {
          mintStatus: storedDoc.receiptProvenance.mintStatus,
          epochId: storedDoc.receiptProvenance.epochId,
          receiptId: storedDoc.receiptProvenance.receiptId,
          mintTxHash: storedDoc.receiptProvenance.mintTxHash,
        }
      : undefined,
  };

  // Extract recomputed values
  // NOTE: Use stored.scoredAt for apples-to-apples decay comparison
  // (recomputedResult.scoredAt would be a fresh timestamp from replay)
  const recomputed = {
    analystScore: recomputedResult.analystScore,
    scoredAt: stored.scoredAt,
    decayParams: recomputedResult.decayParams,
    validatorDecision: recomputedResult.validatorDecision,
    execution: {
      status: recomputedResult.execution.status,
      type: recomputedResult.execution.type,
      timestamp: recomputedResult.execution.timestamp,
    },
  };

  // Build comparison
  const storedUwrScore = stored.analystScore?.uwrScore ?? 0;
  const recomputedUwrScore = recomputed.analystScore?.uwrScore ?? 0;
  const uwrScoreDelta = recomputedUwrScore - storedUwrScore;
  const decisionChanged = recomputed.validatorDecision.decision !== stored.validatorDecision.decision;

  const changes: string[] = [];

  // UWR score change
  if (Math.abs(uwrScoreDelta) > 0.0001) {
    const sign = uwrScoreDelta > 0 ? "+" : "";
    changes.push(`uwrScore changed by ${sign}${uwrScoreDelta.toFixed(4)} (${storedUwrScore.toFixed(4)} → ${recomputedUwrScore.toFixed(4)})`);
  } else {
    changes.push(`uwrScore unchanged (${storedUwrScore.toFixed(4)})`);
  }

  // Decision change
  if (decisionChanged) {
    changes.push(`validatorDecision changed: ${stored.validatorDecision.decision} → ${recomputed.validatorDecision.decision}`);
  } else {
    changes.push(`validatorDecision unchanged: ${stored.validatorDecision.decision}`);
  }

  // Confidence change
  const confidenceDelta = recomputed.validatorDecision.uwrConfidence - stored.validatorDecision.uwrConfidence;
  if (Math.abs(confidenceDelta) > 0.0001) {
    const sign = confidenceDelta > 0 ? "+" : "";
    changes.push(`uwrConfidence changed by ${sign}${confidenceDelta.toFixed(4)}`);
  }

  // Reason codes change
  const storedReasons = stored.validatorDecision.reasonCodes || [];
  const recomputedReasons = recomputed.validatorDecision.reasonCodes || [];
  if (JSON.stringify(storedReasons.sort()) !== JSON.stringify(recomputedReasons.sort())) {
    changes.push(`reasonCodes changed: [${storedReasons.join(", ")}] → [${recomputedReasons.join(", ")}]`);
  }

  // Build final replay result
  const replayResult: ReplayResult = {
    signalId: storedDoc.signalId,
    stored,
    recomputed,
    comparison: {
      uwrScoreDelta,
      decisionChanged,
      changes,
    },
    replayMeta: {
      ranAt: new Date(),
      pipelineVersion: storedDoc.strategy.name,
      notes: "Read-only replay; no DB writes performed",
    },
  };

  return replayResult;
}


