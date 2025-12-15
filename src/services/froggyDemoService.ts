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
 * Pipeline sequence (canonical USS v1.1 flow):
 * 1. USS Telemetry Deriver (internal) → extracts routing/debug fields from context.rawUss
 * 2. Froggy Enrichment (Tech+Pattern) → adds technical indicators and pattern recognition
 * 3. Froggy Enrichment (Sentiment+News) → adds sentiment and news enrichment (parallel)
 * 4. Froggy Enrichment Adapter → merges enrichment legos + adds AI/ML
 * 5. Froggy Analyst → runs trend_pullback_v1 strategy from afi-core
 * 6. Validator Decision Evaluator (Val Dook) → approve/reject/abstain (uses UWR score)
 * 7. Execution Agent Sim → simulates trade execution
 * 8. TSSD Vault Write (internal) → persists canonical USS + results to MongoDB
 *
 * @module froggyDemoService
 */

import { getTssdVaultService } from "./tssdVaultService.js";
import type { TssdSignalDocument } from "../types/TssdSignalDocument.js";
import { FROGGY_TREND_PULLBACK_PIPELINE } from "../config/froggyPipeline.js";
import { runPipelineDag, type PipelineContext } from "./pipelineRunner.js";
import { pickDecayParamsForAnalystScore } from "afi-core/decay";

// Import plugins directly (for now - will be replaced by dynamic loading in future DAG engine)
// NOTE: alpha-scout-ingest and signal-structurer removed (replaced by uss-telemetry-deriver internal stage)
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
 * Run the Froggy trend-pullback pipeline from canonical USS v1.1.
 *
 * This is the NEW canonical entrypoint that accepts USS v1.1 directly.
 * The canonical USS is passed through the pipeline context as rawUss.
 *
 * The pipeline now starts with uss-telemetry-deriver (internal stage) which
 * extracts routing/debug fields from context.rawUss into a minimal structured signal.
 *
 * @param canonicalUss - Canonical USS v1.1 payload (already validated)
 * @param options - Optional configuration (e.g., includeStageSummaries for AFI Eliza Demo)
 * @returns Pipeline result with validator decision and execution status
 */
export async function runFroggyTrendPullbackFromCanonicalUss(
  canonicalUss: any, // CanonicalUss from pipelineRunner
  options?: { includeStageSummaries?: boolean; isDemo?: boolean }
): Promise<FroggyPipelineResult> {
  // Build pipeline context WITH canonical USS
  const context: PipelineContext = {
    rawUss: canonicalUss, // ✅ CANONICAL USS v1.1 in context
    logger: (message: string) => console.log(message),
    isDemo: options?.isDemo,
    includeStageSummaries: options?.includeStageSummaries,
  };

  // Initial payload is empty - uss-telemetry-deriver will extract fields from context.rawUss
  const initialPayload = {};

  // Delegate to shared DAG execution logic
  return runFroggyTrendPullbackDagInternal(initialPayload, context, options);
}

/**
 * Run the Froggy trend-pullback pipeline from a TradingView alert payload.
 *
 * DEPRECATED: Use runFroggyTrendPullbackFromCanonicalUss instead.
 * This is kept for backward compatibility during migration.
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
 * DEPRECATED: Use runFroggyTrendPullbackFromCanonicalUss instead.
 * This is kept for backward compatibility during migration.
 *
 * @param payload - TradingView alert payload
 * @param options - Optional configuration (e.g., includeStageSummaries for AFI Eliza Demo)
 * @returns Pipeline result with validator decision and execution status
 */
export async function runFroggyTrendPullbackDagFromTradingView(
  payload: TradingViewAlertPayload,
  options?: { includeStageSummaries?: boolean; isDemo?: boolean }
): Promise<FroggyPipelineResult> {
  // Build initial payload for pipeline (old envelope format)
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

  // Build pipeline context (no rawUss for backward compat)
  const context: PipelineContext = {
    logger: (message: string) => console.log(message),
    isDemo: options?.isDemo,
    includeStageSummaries: options?.includeStageSummaries,
  };

  // Delegate to shared DAG execution logic
  return runFroggyTrendPullbackDagInternal(alphaDraft, context, options);
}

/**
 * Shared internal DAG execution logic.
 * Used by both canonical USS and legacy TradingView entrypoints.
 *
 * @param initialPayload - Initial payload for pipeline (empty for canonical USS, alphaDraft for legacy)
 * @param context - Pipeline context (with or without rawUss)
 * @param options - Optional configuration
 * @returns Pipeline result with validator decision and execution status
 */
async function runFroggyTrendPullbackDagInternal(
  initialPayload: any,
  context: PipelineContext,
  options?: { includeStageSummaries?: boolean; isDemo?: boolean }
): Promise<FroggyPipelineResult> {
  const stageSummaries: PipelineStageSummary[] = [];

  // Build plugin registry (maps stage ID to plugin instance)
  // This avoids dynamic imports and works in both Jest and production
  // NOTE: alpha-scout-ingest and signal-structurer removed (replaced by uss-telemetry-deriver)
  const pluginRegistry = new Map<string, any>();
  pluginRegistry.set("froggy-enrichment-tech-pattern", froggyEnrichmentTechPattern);
  pluginRegistry.set("froggy-enrichment-sentiment-news", froggyEnrichmentSentimentNews);
  pluginRegistry.set("froggy-enrichment-adapter", froggyEnrichmentAdapter);
  pluginRegistry.set("froggy-analyst", froggyAnalyst);
  pluginRegistry.set("validator-decision", validatorDecisionEvaluator);
  pluginRegistry.set("execution-sim", executionAgentSim);

  // Register internal stage handlers
  const internalHandlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();

  // USS Telemetry Deriver (internal stage)
  // Extracts routing/debug fields from context.rawUss into a minimal structured signal
  // This does NOT mutate rawUss - it creates a derived payload for downstream stages
  internalHandlers.set("uss-telemetry-deriver", async (payload: any, ctx: PipelineContext) => {
    const rawUss = ctx.rawUss;
    if (!rawUss) {
      throw new Error("uss-telemetry-deriver: context.rawUss is missing");
    }

    // Extract fields from canonical USS provenance
    // For now, we derive TradingView-like fields from provenance
    // TODO Phase 3: Update enrichment plugins to read directly from context.rawUss
    const derivedSignal = {
      signalId: rawUss.provenance.signalId,
      score: 0, // Initial score; will be computed downstream
      confidence: 0.5, // Default confidence; will be refined by Froggy
      timestamp: rawUss.provenance.ingestedAt || new Date().toISOString(),
      meta: {
        symbol: rawUss.provenance.providerRef || "UNKNOWN", // TODO: extract from USS core when available
        market: "spot", // TODO: extract from USS core when available
        timeframe: "1h", // TODO: extract from USS core when available
        strategy: rawUss.provenance.providerRef || "unknown", // TODO: extract from USS core when available
        direction: "neutral" as const, // TODO: extract from USS core when available
        source: rawUss.provenance.source,
      },
    };

    // Store derived telemetry in context for debugging/logging
    ctx.telemetry = derivedSignal;

    // Attach context to payload for downstream plugins (e.g., validator novelty scoring)
    // This allows plugins to access rawUss and other context fields
    (derivedSignal as any)._context = ctx;

    return derivedSignal;
  });

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
    initialPayload,
    context,
    internalHandlers,
    pluginRegistry
  );

  // Extract final execution result from pipeline
  const executionResult = pipelineResult.payload;

  // Extract intermediate payloads for stage summaries
  const intermediates = pipelineResult.intermediatePayloads || new Map();
  const derivedTelemetry = intermediates.get("uss-telemetry-deriver");
  const techPatternSignal = intermediates.get("froggy-enrichment-tech-pattern");
  const sentimentNewsSignal = intermediates.get("froggy-enrichment-sentiment-news");
  const enrichedSignal = intermediates.get("froggy-enrichment-adapter");
  const analyzedSignal = intermediates.get("froggy-analyst");
  const validatorDecision = intermediates.get("validator-decision");

  // Build stage summaries if requested
  if (options?.includeStageSummaries) {
    // USS Telemetry Deriver stage (replaces scout + structurer)
    if (derivedTelemetry && context.rawUss) {
      stageSummaries.push({
        stage: "structurer",
        persona: "Pixel Rick",
        status: "complete",
        summary: `Derived telemetry from canonical USS v1.1 (signalId: ${context.rawUss.provenance.signalId})`,
      });
    }

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

  // Extract metadata from canonical USS or derived telemetry
  const signalId = context.rawUss?.provenance?.signalId || derivedTelemetry?.signalId || executionResult.signalId;
  const symbol = derivedTelemetry?.meta?.symbol || context.rawUss?.provenance?.providerRef || "UNKNOWN";
  const timeframe = derivedTelemetry?.meta?.timeframe || "1h";
  const strategy = derivedTelemetry?.meta?.strategy || context.rawUss?.provenance?.providerRef || "unknown";
  const direction = derivedTelemetry?.meta?.direction || "neutral";
  const source = context.rawUss?.provenance?.source || "tradingview-webhook";

  // Build final result
  // Note: executionResult contains the full chain of data from all stages
  const result: FroggyPipelineResult = {
    signalId,
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
      symbol,
      timeframe,
      strategy,
      direction,
      source,
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
      signalId,
      createdAt: new Date(),
      source: options?.isDemo ? "afi-eliza-demo" : source,
      market: {
        symbol,
        timeframe,
        market: marketType || "spot",  // Use normalized marketType from enrichment
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
          // Audit/replay metadata (Phase: Validator v0 → Holy)
          validatorConfigId: executionResult.validatorDecision.validatorConfigId,
          validatorVersion: executionResult.validatorDecision.validatorVersion,
          // Novelty evaluation (Phase: Real Novelty + Replay Canonical)
          novelty: executionResult.validatorDecision.novelty,
          canonicalNovelty: executionResult.validatorDecision.canonicalNovelty,
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
        name: strategy,
        direction,
      },
      // Novelty metadata for baseline queries (Phase: Real Novelty + Replay Canonical)
      noveltyMeta: executionResult.validatorDecision.canonicalNovelty
        ? {
            cohortId: executionResult.validatorDecision.canonicalNovelty.cohortId,
          }
        : undefined,
      // Phase 3: Persist canonical USS v1.1 as dedicated queryable field
      rawUss: context.rawUss,
      // Legacy field (kept for backward compatibility)
      rawPayload: context.rawUss || derivedTelemetry,
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
