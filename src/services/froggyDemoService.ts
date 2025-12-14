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

import { getTssdVaultService } from "./tssdVaultService.js";
import type { TssdSignalDocument } from "../types/TssdSignalDocument.js";
import { FROGGY_TREND_PULLBACK_PIPELINE } from "../config/froggyPipeline.js";
import { runPipelineDag, type PipelineContext } from "./pipelineRunner.js";
import { pickDecayParamsForAnalystScore } from "afi-core/decay";

// Import plugins directly (for now - will be replaced by dynamic loading in future DAG engine)
import alphaScoutIngest from "../../plugins/alpha-scout-ingest.plugin.js";
import signalStructurer from "../../plugins/signal-structurer.plugin.js";
import froggyEnrichmentTechPattern from "../../plugins/froggy-enrichment-tech-pattern.plugin.js";
import froggyEnrichmentSentimentNews from "../../plugins/froggy-enrichment-sentiment-news.plugin.js";
import froggyEnrichmentAdapter from "../../plugins/froggy-enrichment-adapter.plugin.js";
import froggyAnalyst from "../../plugins/froggy.trend_pullback_v1.plugin.js";
import validatorDecisionEvaluator from "../../plugins/validator-decision-evaluator.plugin.js";
import executionAgentSim from "../../plugins/execution-agent-sim.plugin.js";

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
  stage: "scout" | "structurer" | "tech-pattern" | "sentiment-news" | "enrichment" | "analyst" | "validator" | "execution";
  /** Persona/agent name for this stage */
  persona: "Alpha" | "Pixel Rick" | "Froggy" | "Val Dook" | "Execution Sim";
  /** Stage status */
  status: "complete" | "skipped" | "error";
  /** Key outputs from this stage (demo-friendly) */
  summary: string;
  /** Optional: enrichment categories applied (for Pixel Rick stage) */
  enrichmentCategories?: string[];
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
  /** Canonical analyst score (if available) */
  analystScore?: any;
  /** ISO timestamp when scoring was completed */
  scoredAt?: string;
  /** Decay parameters (if available) */
  decayParams?: {
    halfLifeMinutes: number;
    greeksTemplateId: string;
  } | null;
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
 * This is now a thin wrapper around runFroggyTrendPullbackDagFromTradingView.
 * All Froggy execution uses DAG-aware orchestration (runPipelineDag).
 *
 * @param payload - TradingView alert payload
 * @param options - Optional configuration (e.g., includeStageSummaries for AFI Eliza Demo)
 * @returns Pipeline result with validator decision and execution status
 */
export async function runFroggyTrendPullbackFromTradingView(
  payload: TradingViewAlertPayload,
  options?: { includeStageSummaries?: boolean; isDemo?: boolean }
): Promise<FroggyPipelineResult> {
  // Delegate to DAG implementation - all Froggy runs now use DAG orchestration
  return runFroggyTrendPullbackDagFromTradingView(payload, options);
}

/**
 * Run the Froggy trend-pullback pipeline using DAG-aware execution.
 *
 * This function is identical to runFroggyTrendPullbackFromTradingView but uses
 * runPipelineDag instead of runPipeline, enabling parallel execution of stages
 * based on their dependsOn metadata.
 *
 * Currently, FROGGY_TREND_PULLBACK_PIPELINE is still linear (each stage depends
 * on the previous one), so this function produces identical results to the linear
 * version. However, it validates the DAG execution path and prepares for future
 * parallel enrichment or multi-branch strategies.
 *
 * @param payload - TradingView alert payload
 * @param options - Optional configuration (e.g., includeStageSummaries for AFI Eliza Demo)
 * @returns Pipeline result with validator decision and execution status
 */
export async function runFroggyTrendPullbackDagFromTradingView(
  payload: TradingViewAlertPayload,
  options?: { includeStageSummaries?: boolean; isDemo?: boolean }
): Promise<FroggyPipelineResult> {
  const stageSummaries: PipelineStageSummary[] = [];

  // Build initial payload for pipeline
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

  // Build pipeline context
  const context: PipelineContext = {
    logger: (message: string) => console.log(message),
    isDemo: options?.isDemo,
    includeStageSummaries: options?.includeStageSummaries,
  };

  // Build plugin registry (maps stage ID to plugin instance)
  // This avoids dynamic imports and works in both Jest and production
  const pluginRegistry = new Map<string, any>();
  pluginRegistry.set("alpha-scout-ingest", alphaScoutIngest);
  pluginRegistry.set("signal-structurer", signalStructurer);
  pluginRegistry.set("froggy-enrichment-tech-pattern", froggyEnrichmentTechPattern);
  pluginRegistry.set("froggy-enrichment-sentiment-news", froggyEnrichmentSentimentNews);
  pluginRegistry.set("froggy-enrichment-adapter", froggyEnrichmentAdapter);
  pluginRegistry.set("froggy-analyst", froggyAnalyst);
  pluginRegistry.set("validator-decision", validatorDecisionEvaluator);
  pluginRegistry.set("execution-sim", executionAgentSim);

  // Register internal stage handlers
  const internalHandlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();

  // TSSD vault write handler (internal stage)
  internalHandlers.set("tssd-vault-write", async (payload: any, ctx: PipelineContext) => {
    // This handler is called after execution-sim stage
    // Payload at this point is the executionResult
    // We need to extract all intermediate results for vault persistence

    // For now, just return the payload unchanged
    // The actual vault write logic will be handled after pipeline execution
    return payload;
  });

  // Execute pipeline through all stages using DAG runner
  const pipelineResult = await runPipelineDag(
    FROGGY_TREND_PULLBACK_PIPELINE,
    alphaDraft,
    context,
    internalHandlers,
    pluginRegistry
  );

  // Extract final execution result from pipeline
  const executionResult = pipelineResult.payload;

  // Extract intermediate payloads for stage summaries
  const intermediates = pipelineResult.intermediatePayloads || new Map();
  const rawSignal = intermediates.get("alpha-scout-ingest");
  const structuredSignal = intermediates.get("signal-structurer");
  const techPatternSignal = intermediates.get("froggy-enrichment-tech-pattern");
  const sentimentNewsSignal = intermediates.get("froggy-enrichment-sentiment-news");
  const enrichedSignal = intermediates.get("froggy-enrichment-adapter");
  const analyzedSignal = intermediates.get("froggy-analyst");
  const validatorDecision = intermediates.get("validator-decision");

  // Build stage summaries if requested
  if (options?.includeStageSummaries) {
    stageSummaries.push({
      stage: "scout",
      persona: "Alpha",
      status: "complete",
      summary: `Ingested ${payload.symbol} ${payload.direction} signal on ${payload.timeframe} timeframe`,
    });

    stageSummaries.push({
      stage: "structurer",
      persona: "Pixel Rick",
      status: "complete",
      summary: `Normalized signal to USS (Universal Signal Schema) format`,
    });

    // Tech+Pattern enrichment stage (Pass A)
    if (techPatternSignal) {
      const techPattern = (techPatternSignal as any)._techPatternEnrichment;
      let techPatternSummary = "Computed technical indicators and pattern recognition";
      if (techPattern?.technical) {
        techPatternSummary += ` (Trend: ${techPattern.technical.trendBias}, RSI: ${techPattern.technical.rsi14.toFixed(0)})`;
      }
      if (techPattern?.pattern?.patternName) {
        techPatternSummary += `, Pattern: ${techPattern.pattern.patternName}`;
      }
      stageSummaries.push({
        stage: "tech-pattern",
        persona: "Pixel Rick",
        status: "complete",
        summary: techPatternSummary,
      });
    }

    // Sentiment+News enrichment stage (Pass B)
    if (sentimentNewsSignal) {
      const sentimentNews = (sentimentNewsSignal as any)._sentimentNewsEnrichment;
      let sentimentNewsSummary = "Computed sentiment and news enrichment";

      if (sentimentNews?.sentiment) {
        const sentimentScore = sentimentNews.sentiment.score || sentimentNews.sentiment.perpSentimentScore;
        const bias = sentimentNews.sentiment.positioningBias || sentimentNews.sentiment.tags?.[0] || "unknown";
        sentimentNewsSummary += ` (Sentiment: ${bias}`;
        if (typeof sentimentScore === "number") {
          sentimentNewsSummary += `, Score: ${sentimentScore.toFixed(2)}`;
        }
        sentimentNewsSummary += `)`;
      }

      if (sentimentNews?.news?.hasShockEvent) {
        sentimentNewsSummary += `, News shock: ${sentimentNews.news.shockDirection}`;
      }

      stageSummaries.push({
        stage: "sentiment-news",
        persona: "Pixel Rick",
        status: "complete",
        summary: sentimentNewsSummary,
      });
    }

    if (enrichedSignal) {
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

    if (analyzedSignal) {
      stageSummaries.push({
        stage: "analyst",
        persona: "Froggy",
        status: "complete",
        summary: `Analyzed trend-pullback setup, UWR score: ${analyzedSignal.analysis.analystScore.uwrScore.toFixed(2)}`,
      });
    }

    if (validatorDecision) {
      stageSummaries.push({
        stage: "validator",
        persona: "Val Dook",
        status: "complete",
        summary: `Decision: ${validatorDecision.decision}, Confidence: ${validatorDecision.uwrConfidence.toFixed(2)}`,
        decision: validatorDecision.decision,
      });
    }

    stageSummaries.push({
      stage: "execution",
      persona: "Execution Sim",
      status: "complete",
      summary: `Simulated ${executionResult.execution.type || "action"}: ${executionResult.execution.status}`,
    });
  }

  // Compute decay parameters once (reused in result and TSSD doc)
  const decayParams = analyzedSignal?.analysis?.analystScore
    ? pickDecayParamsForAnalystScore(analyzedSignal.analysis.analystScore)
    : null;

  // Compute scoredAt once (canonical timestamp when analystScore was produced)
  const scoredAt = analyzedSignal?.analysis?.analystScore ? new Date().toISOString() : undefined;

  // Build final result
  // Note: executionResult contains the full chain of data from all stages
  const result: FroggyPipelineResult = {
    signalId: rawSignal?.signalId || executionResult.signalId,
    analystScore: analyzedSignal?.analysis?.analystScore,
    scoredAt,
    decayParams: decayParams
      ? {
          halfLifeMinutes: decayParams.halfLifeMinutes,
          greeksTemplateId: decayParams.greeksTemplateId,
        }
      : null,
    validatorDecision: {
      decision: executionResult.validatorDecision.decision,
      uwrConfidence: executionResult.validatorDecision.uwrConfidence,
      reasonCodes: executionResult.validatorDecision.reasonCodes,
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
      const signalId = rawSignal?.signalId || executionResult.signalId;
      const errorMsg = `❌ TSSD Vault Write BLOCKED: Missing provenance metadata for signal ${signalId}. ` +
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
      signalId: rawSignal?.signalId || executionResult.signalId,
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
        // Canonical analyst score (Phase 3+)
        analystScore: analyzedSignal?.analysis?.analystScore,
        // Timestamp when scoring was completed (canonical: when analystScore was produced)
        scoredAt,
        // Decay parameters (Greeks-style time decay, computed once above)
        decayParams: decayParams
          ? {
              halfLifeMinutes: decayParams.halfLifeMinutes,
              greeksTemplateId: decayParams.greeksTemplateId,
            }
          : null,
        validatorDecision: {
          decision: executionResult.validatorDecision.decision,
          uwrConfidence: executionResult.validatorDecision.uwrConfidence,
          reasonCodes: executionResult.validatorDecision.reasonCodes,
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

/**
 * Alias for runFroggyTrendPullbackFromTradingView.
 * Used by smoke scripts and other utilities.
 *
 * All Froggy execution now uses DAG-aware orchestration (runPipelineDag).
 *
 * @param payload - TradingView alert payload
 * @param options - Pipeline options
 * @returns Pipeline result
 */
export async function runFroggyPipeline(
  payload: TradingViewAlertPayload,
  options?: { includeStageSummaries?: boolean; isDemo?: boolean }
): Promise<FroggyPipelineResult> {
  return runFroggyTrendPullbackFromTradingView(payload, options);
}
