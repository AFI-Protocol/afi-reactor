/**
 * 🐸 FROGGY DEMO SERVICE
 * 
 * This service runs the Froggy trend-pullback pipeline in a reusable, testable way.
 * It is designed for dev/demo purposes and is NOT part of the canonical orchestrator
 * or production emissions logic.
 * 
 * ⚠️ DEV/DEMO ONLY:
 * - Execution is simulated (no real trades)
 * - No AFI token minting or emissions occur here
 * - No real exchange API calls
 * - Uses demo enrichment data
 * 
 * Pipeline sequence (matches test/froggyPipeline.test.ts):
 * 1. Alpha Scout Ingest → converts TradingView payload to reactor signal envelope
 * 2. Signal Structurer (Pixel Rick) → normalizes and validates signal
 * 3. Froggy Enrichment Adapter → adds technical/pattern/sentiment enrichment
 * 4. Froggy Analyst → runs trend_pullback_v1 strategy from afi-core
 * 5. Validator Decision Evaluator (Val Dook) → approve/reject/abstain (uses UWR score)
 * 6. Execution Agent Sim → simulates trade execution
 * 
 * @module froggyDemoService
 */

import alphaScoutIngest from "../../plugins/alpha-scout-ingest.plugin.js";
import signalStructurer from "../../plugins/signal-structurer.plugin.js";
import froggyEnrichmentAdapter from "../../plugins/froggy-enrichment-adapter.plugin.js";
import froggyAnalyst from "../../plugins/froggy.trend_pullback_v1.plugin.js";
import validatorDecisionEvaluator from "../../plugins/validator-decision-evaluator.plugin.js";
import executionAgentSim from "../../plugins/execution-agent-sim.plugin.js";
import { getTssdVaultService } from "./tssdVaultService.js";
import type { TssdSignalDocument } from "../types/TssdSignalDocument.js";

// Import EnrichmentProfile type (type-only import to avoid rootDir issues)
type EnrichmentProfile = any;

/**
 * TradingView alert payload shape.
 * This is what we expect from TradingView webhook alerts.
 */
export interface TradingViewAlertPayload {
  /** Trading symbol (e.g., "BTCUSDT", "BTC/USDT") */
  symbol: string;
  /** Market type (e.g., "spot", "perp", "futures") */
  market?: string;
  /** Timeframe (e.g., "1m", "5m", "15m", "1h", "4h", "1d") */
  timeframe: string;
  /** Strategy identifier (e.g., "froggy_trend_pullback_v1") */
  strategy: string;
  /** Trade direction */
  direction: "long" | "short" | "neutral";
  /** Brief setup summary */
  setupSummary?: string;
  /** Additional notes */
  notes?: string;
  /** Enrichment profile (optional, designed by Pixel Rick or similar personas) */
  enrichmentProfile?: EnrichmentProfile;
  /** Optional external signal ID */
  signalId?: string;
  /** Optional shared secret for webhook authentication */
  secret?: string;
  /** Allow additional fields */
  [key: string]: unknown;
}

/**
 * Stage summary for AFI Eliza Demo.
 * Each stage in the pipeline gets a summary entry.
 */
export interface PipelineStageSummary {
  /** Stage name */
  stage: "scout" | "structurer" | "enrichment" | "analyst" | "validator" | "execution";
  /** Persona/agent name for this stage */
  persona: "Alpha" | "Pixel Rick" | "Froggy" | "Val Dook" | "Execution Sim";
  /** Stage status */
  status: "complete" | "skipped" | "error";
  /** Key outputs from this stage (demo-friendly) */
  summary: string;
  /** Optional: enrichment categories applied (for Pixel Rick stage) */
  enrichmentCategories?: string[];
  /** Optional: UWR score (for Froggy stage) */
  uwrScore?: number;
  /** Optional: decision (for Val Dook stage) */
  decision?: "approve" | "reject" | "flag" | "abstain";
}

/**
 * Froggy pipeline result.
 * This is what we return to the webhook caller.
 */
export interface FroggyPipelineResult {
  /** Signal ID (generated or provided) */
  signalId: string;
  /** Validator decision */
  validatorDecision: {
    decision: "approve" | "reject" | "flag" | "abstain";
    uwrConfidence: number;
    reasonCodes?: string[];
  };
  /** Execution result (simulated) */
  execution: {
    status: "simulated" | "skipped";
    type?: "buy" | "sell" | "hold";
    asset?: string;
    amount?: number;
    simulatedPrice?: number;
    timestamp: string;
    notes?: string;
  };
  /** Full pipeline metadata */
  meta: {
    symbol: string;
    timeframe: string;
    strategy: string;
    direction: string;
    source: string;
  };
  /** UWR score from Froggy analyst */
  uwrScore: number;
  /** DEMO-ONLY: Stage-by-stage summaries for AFI Eliza Demo */
  stageSummaries?: PipelineStageSummary[];
  /** DEMO-ONLY: Marker to indicate this is a demo run */
  isDemo?: boolean;
  /** Vault write status (Phase 1: TSSD vault integration) */
  vaultWrite?: "success" | "failed" | "skipped" | "failed-missing-provenance";
  /** Vault error message (if vaultWrite === "failed-missing-provenance") */
  vaultError?: string;
}

/**
 * Run the Froggy trend-pullback pipeline from a TradingView alert payload.
 *
 * This function orchestrates the complete Froggy pipeline in the same sequence
 * as test/froggyPipeline.test.ts, making it easy to test and maintain.
 *
 * @param payload - TradingView alert payload
 * @param options - Optional configuration (e.g., includeStageSummaries for AFI Eliza Demo)
 * @returns Pipeline result with validator decision and execution status
 */
export async function runFroggyTrendPullbackFromTradingView(
  payload: TradingViewAlertPayload,
  options?: { includeStageSummaries?: boolean; isDemo?: boolean }
): Promise<FroggyPipelineResult> {
  const stageSummaries: PipelineStageSummary[] = [];

  // Step 1: Alpha Scout Ingest - convert TradingView payload to reactor signal envelope
  const alphaDraft = {
    symbol: payload.symbol,
    market: payload.market || "spot",
    timeframe: payload.timeframe,
    strategy: payload.strategy,
    direction: payload.direction,
    setupSummary: payload.setupSummary,
    notes: payload.notes,
    enrichmentProfile: payload.enrichmentProfile,
    signalId: payload.signalId,
  };

  const rawSignal = await alphaScoutIngest.run(alphaDraft);

  if (options?.includeStageSummaries) {
    stageSummaries.push({
      stage: "scout",
      persona: "Alpha",
      status: "complete",
      summary: `Ingested ${payload.symbol} ${payload.direction} signal on ${payload.timeframe} timeframe`,
    });
  }

  // Step 2: Signal Structurer (Pixel Rick) - normalize and validate
  const structuredSignal = await signalStructurer.run(rawSignal);

  if (options?.includeStageSummaries) {
    stageSummaries.push({
      stage: "structurer",
      persona: "Pixel Rick",
      status: "complete",
      summary: `Normalized signal to USS (Universal Signal Schema) format`,
    });
  }

  // Step 3: Froggy Enrichment Adapter - add technical/pattern/sentiment enrichment
  const enrichedSignal = await froggyEnrichmentAdapter.run(structuredSignal);

  if (options?.includeStageSummaries) {
    const enrichmentCategories = enrichedSignal.enrichmentMeta?.categories || [];
    const enrichmentSummary = (enrichedSignal as any)._enrichmentSummary || `Applied enrichment legos: ${enrichmentCategories.join(", ")}`;
    stageSummaries.push({
      stage: "enrichment",
      persona: "Pixel Rick",
      status: "complete",
      summary: enrichmentSummary,
      enrichmentCategories,
    });
  }

  // Step 4: Froggy Analyst - run trend_pullback_v1 strategy from afi-core
  const analyzedSignal = await froggyAnalyst.run(enrichedSignal);

  if (options?.includeStageSummaries) {
    stageSummaries.push({
      stage: "analyst",
      persona: "Froggy",
      status: "complete",
      summary: `Analyzed trend-pullback setup, UWR score: ${analyzedSignal.analysis.uwrScore.toFixed(2)}`,
      uwrScore: analyzedSignal.analysis.uwrScore,
    });
  }

  // Step 5: Validator Decision Evaluator (Val Dook) - approve/reject/abstain
  // Pass the analyzed signal with UWR score to validator
  const validatorDecision = await validatorDecisionEvaluator.run({
    signalId: enrichedSignal.signalId,
    analysis: analyzedSignal.analysis,
  });

  if (options?.includeStageSummaries) {
    stageSummaries.push({
      stage: "validator",
      persona: "Val Dook",
      status: "complete",
      summary: `Decision: ${validatorDecision.decision}, Confidence: ${validatorDecision.uwrConfidence.toFixed(2)}`,
      decision: validatorDecision.decision,
    });
  }

  // Step 6: Execution Agent Sim - simulate trade execution
  const executionResult = await executionAgentSim.run(validatorDecision);

  if (options?.includeStageSummaries) {
    stageSummaries.push({
      stage: "execution",
      persona: "Execution Sim",
      status: "complete",
      summary: `Simulated ${executionResult.execution.type || "action"}: ${executionResult.execution.status}`,
    });
  }

  // Build final result
  const result: FroggyPipelineResult = {
    signalId: rawSignal.signalId,
    validatorDecision: {
      decision: validatorDecision.decision,
      uwrConfidence: validatorDecision.uwrConfidence,
      reasonCodes: validatorDecision.reasonCodes,
    },
    execution: {
      status: executionResult.execution.status,
      type: executionResult.execution.type,
      asset: executionResult.execution.asset,
      amount: executionResult.execution.amount,
      simulatedPrice: executionResult.execution.simulatedPrice,
      timestamp: executionResult.execution.timestamp,
      notes: executionResult.execution.notes,
    },
    meta: {
      symbol: payload.symbol,
      timeframe: payload.timeframe,
      strategy: payload.strategy,
      direction: payload.direction,
      source: "tradingview-webhook",
    },
    uwrScore: analyzedSignal.analysis.uwrScore,
    stageSummaries: options?.includeStageSummaries ? stageSummaries : undefined,
    isDemo: options?.isDemo,
  };

  // Phase 1: TSSD Vault Integration
  // Persist the final scored + validated signal to MongoDB (if enabled)
  const vaultService = getTssdVaultService();
  if (vaultService) {
    // Extract price source metadata from enriched signal
    const priceSource = (enrichedSignal as any)._priceFeedMetadata?.priceSource;
    const venueType = (enrichedSignal as any)._priceFeedMetadata?.venueType;
    const marketType = (enrichedSignal as any)._priceFeedMetadata?.marketType;

    // Extract USS lenses from enriched signal
    const lenses = (enrichedSignal as any).lenses || [];

    // Extract mirrored metadata for debugging
    const technicalIndicators = (enrichedSignal as any)._priceFeedMetadata?.technicalIndicators;
    const patternSignals = (enrichedSignal as any)._priceFeedMetadata?.patternSignals;

    // PROVENANCE GUARDRAIL: Enforce priceSource and venueType for all TSSD writes
    // These fields are required for audit trail and data provenance tracking
    if (!priceSource || !venueType) {
      const errorMsg = `❌ TSSD Vault Write BLOCKED: Missing provenance metadata for signal ${rawSignal.signalId}. ` +
        `priceSource=${priceSource}, venueType=${venueType}. ` +
        `All price-based pipelines MUST attach _priceFeedMetadata in enrichment stage.`;
      console.error(errorMsg);

      // Mark vault write as failed and include error in result
      result.vaultWrite = "failed-missing-provenance";
      (result as any).vaultError = errorMsg;

      // Return early - do NOT write incomplete provenance to vault
      return result;
    }

    const tssdDoc: TssdSignalDocument = {
      signalId: rawSignal.signalId,
      createdAt: new Date(),
      source: options?.isDemo ? "afi-eliza-demo" : "tradingview-webhook",
      market: {
        symbol: payload.symbol,
        timeframe: payload.timeframe,
        market: marketType || payload.market,  // Use normalized marketType from enrichment
        priceSource,  // Now guaranteed to be non-empty
        venueType,    // Now guaranteed to be non-empty
      },
      lenses: lenses.length > 0 ? lenses : undefined,  // USS lenses (Phase 2)
      _priceFeedMetadata: {  // Mirrored metadata for debugging (DEPRECATED)
        technicalIndicators,
        patternSignals,
      },
      pipeline: {
        uwrScore: analyzedSignal.analysis.uwrScore,
        validatorDecision: {
          decision: validatorDecision.decision,
          uwrConfidence: validatorDecision.uwrConfidence,
          reasonCodes: validatorDecision.reasonCodes,
        },
        execution: {
          status: executionResult.execution.status,
          type: executionResult.execution.type,
          asset: executionResult.execution.asset,
          amount: executionResult.execution.amount,
          simulatedPrice: executionResult.execution.simulatedPrice,
          timestamp: executionResult.execution.timestamp,
          notes: executionResult.execution.notes,
        },
        stageSummaries: options?.includeStageSummaries ? stageSummaries : undefined,
      },
      strategy: {
        name: payload.strategy,
        direction: payload.direction,
      },
      rawPayload: payload,
      version: "v0.1",
    };

    result.vaultWrite = await vaultService.insertSignalDocument(tssdDoc);
  } else {
    result.vaultWrite = "skipped";
  }

  return result;
}

