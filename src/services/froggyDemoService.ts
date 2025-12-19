// @ts-nocheck
/**
 * AFI Reactor - Froggy Scoring Service
 *
 * Reactor's responsibility: ingest → enrich → score → persist.
 *
 * Pipeline sequence (canonical USS v1.1 flow):
 * 1. USS Telemetry Deriver (internal) → extracts routing/debug fields from context.rawUss
 * 2. Froggy Enrichment (Tech+Pattern) → adds technical indicators and pattern recognition
 * 3. Froggy Enrichment (Sentiment+News) → adds sentiment and news enrichment (parallel)
 * 4. Froggy Enrichment Adapter → merges enrichment legos + adds AI/ML (Tiny Brains optional)
 * 5. Froggy Analyst → runs trend_pullback_v1 strategy from afi-core, computes UWR score
 * 6. Reactor Vault Write (internal) → persists scored signal to MongoDB
 *
 * NOT Reactor's responsibility:
 * - Validator certification (moved to external certification layer)
 * - Execution (moved to consumer/adapter layer)
 * - Minting/emissions (moved to afi-mint)
 *
 * @module froggyDemoService
 */

import { getTssdVaultService } from "./tssdVaultService.js";
import type { ReactorScoredSignalV1, ReactorScoredSignalDocument } from "../types/ReactorScoredSignalV1.js";
import { FROGGY_TREND_PULLBACK_PIPELINE } from "../config/froggyPipeline.js";
import { runPipelineDag, type PipelineContext } from "./pipelineRunner.js";
import { pickDecayParamsForAnalystScore } from "afi-core/decay";
import { mapTradingViewToUssV11 } from "../uss/tradingViewMapper.js";

// Import plugins directly (for now - will be replaced by dynamic loading in future DAG engine)
import froggyEnrichmentTechPattern from "../../plugins/froggy-enrichment-tech-pattern.plugin.js";
import froggyEnrichmentSentimentNews from "../../plugins/froggy-enrichment-sentiment-news.plugin.js";
import froggyEnrichmentAdapter from "../../plugins/froggy-enrichment-adapter.plugin.js";
import froggyAnalyst from "../../plugins/froggy.trend_pullback_v1.plugin.js";

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
  /** Optional external signal ID */
  signalId?: string;
  /** Optional shared secret for webhook authentication */
  secret?: string;
  /** Allow additional fields */
  [key: string]: unknown;
}

/**
 * Run the Froggy trend-pullback scoring pipeline from canonical USS v1.1.
 *
 * This is the canonical entrypoint that accepts USS v1.1 directly.
 * The canonical USS is passed through the pipeline context as rawUss.
 *
 * The pipeline starts with uss-telemetry-deriver (internal stage) which
 * extracts routing/debug fields from context.rawUss into a minimal structured signal.
 *
 * @param canonicalUss - Canonical USS v1.1 payload (already validated)
 * @returns Reactor scored signal V1
 */
export async function runFroggyTrendPullbackFromCanonicalUss(
  canonicalUss: any
): Promise<ReactorScoredSignalV1> {
  // Build pipeline context WITH canonical USS
  const context: PipelineContext = {
    rawUss: canonicalUss, // ✅ CANONICAL USS v1.1 in context
    logger: (message: string) => console.log(message),
  };

  // Initial payload is empty - uss-telemetry-deriver will extract fields from context.rawUss
  const initialPayload = {};

  // Delegate to shared DAG execution logic
  return runFroggyTrendPullbackDagInternal(initialPayload, context);
}

/**
 * Run the Froggy trend-pullback scoring pipeline from a TradingView alert payload.
 *
 * DEPRECATED: Use runFroggyTrendPullbackFromCanonicalUss instead.
 * This is kept for backward compatibility during migration.
 *
 * @param payload - TradingView alert payload
 * @returns Reactor scored signal V1
 */
export async function runFroggyTrendPullbackFromTradingView(
  payload: TradingViewAlertPayload
): Promise<ReactorScoredSignalV1> {
  // Map TradingView payload to canonical USS v1.1
  const canonicalUss = mapTradingViewToUssV11(payload);

  // Build pipeline context WITH canonical USS and original TradingView payload
  // The original payload is stored in context for telemetry derivation
  const context: PipelineContext = {
    rawUss: canonicalUss,
    tradingViewPayload: payload, // Store original payload for telemetry derivation
    logger: (message: string) => console.log(message),
  };

  // Initial payload is empty - uss-telemetry-deriver will extract fields from context
  const initialPayload = {};

  // Delegate to shared DAG execution logic
  return runFroggyTrendPullbackDagInternal(initialPayload, context);
}

/**
 * Shared internal DAG execution logic.
 * Used by both canonical USS and legacy TradingView entrypoints.
 *
 * Reactor's responsibility: ingest → enrich → score → persist.
 *
 * @param initialPayload - Initial payload for pipeline (empty for canonical USS)
 * @param context - Pipeline context (with rawUss)
 * @returns Reactor scored signal V1
 */
async function runFroggyTrendPullbackDagInternal(
  initialPayload: any,
  context: PipelineContext
): Promise<ReactorScoredSignalV1> {
  // Build plugin registry (maps stage ID to plugin instance)
  const pluginRegistry = new Map<string, any>();
  pluginRegistry.set("froggy-enrichment-tech-pattern", froggyEnrichmentTechPattern);
  pluginRegistry.set("froggy-enrichment-sentiment-news", froggyEnrichmentSentimentNews);
  pluginRegistry.set("froggy-enrichment-adapter", froggyEnrichmentAdapter);
  pluginRegistry.set("froggy-analyst", froggyAnalyst);

  // Register internal stage handlers
  const internalHandlers = new Map<string, (payload: any, ctx: PipelineContext) => Promise<any>>();

  // USS Telemetry Deriver (internal stage)
  // Extracts routing/debug fields from context.rawUss into a minimal structured signal
  // This does NOT mutate rawUss - it creates a derived payload for downstream stages
  internalHandlers.set("uss-telemetry-deriver", async (payload: any, ctx: PipelineContext) => {
    const rawUss = ctx.rawUss;

    // Hard requirement: rawUss must be present (canonical USS v1.1 flow)
    if (!rawUss) {
      throw new Error("uss-telemetry-deriver: context.rawUss is missing (canonical USS v1.1 flow required)");
    }

    // Extract fields from canonical USS facts block (replay-canonical)
    // Facts block exists and is persisted in rawUss; telemetry reads it first
    // Fallback to context.tradingViewPayload for demo convenience (if facts not populated)
    const tvPayload = (ctx as any).tradingViewPayload;

    const derivedSignal = {
      signalId: rawUss.provenance.signalId,
      score: 0, // Initial score; will be computed downstream
      confidence: 0.5, // Default confidence; will be refined by Froggy
      timestamp: rawUss.provenance.ingestedAt || new Date().toISOString(),
      meta: {
        symbol: rawUss.facts?.symbol ?? tvPayload?.symbol ?? "UNKNOWN",
        market: rawUss.facts?.market ?? tvPayload?.market ?? "spot",
        timeframe: rawUss.facts?.timeframe ?? tvPayload?.timeframe ?? "1h",
        strategy: rawUss.facts?.strategy ?? tvPayload?.strategy ?? rawUss.provenance.providerRef ?? "unknown",
        direction: rawUss.facts?.direction ?? tvPayload?.direction ?? ("neutral" as const),
        source: rawUss.provenance.source,
      },
      setupSummary: tvPayload?.setupSummary,
      notes: tvPayload?.notes,
    };

    // Store derived telemetry in context for debugging/logging
    ctx.telemetry = derivedSignal;

    // Attach context to payload for downstream plugins
    (derivedSignal as any)._context = ctx;

    return derivedSignal;
  });

  // Reactor vault write handler (internal stage)
  internalHandlers.set("tssd-vault-write", async (payload: any, ctx: PipelineContext) => {
    // This handler is called after froggy-analyst stage
    // Payload at this point is the analyzed signal
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

  // Extract intermediate payloads
  const intermediates = pipelineResult.intermediatePayloads || new Map();
  const derivedTelemetry = intermediates.get("uss-telemetry-deriver");
  const enrichedSignal = intermediates.get("froggy-enrichment-adapter");
  const analyzedSignal = intermediates.get("froggy-analyst");

  // Validate that we have the required analyst score
  if (!analyzedSignal?.analysis?.analystScore) {
    throw new Error("Froggy analyst stage did not produce analystScore");
  }

  // Compute decay parameters (reused in result and vault doc)
  const decayParams = pickDecayParamsForAnalystScore(analyzedSignal.analysis.analystScore);

  // Compute scoredAt (canonical timestamp when analystScore was produced)
  const scoredAt = new Date().toISOString();

  // Extract metadata from canonical USS or derived telemetry
  const signalId = context.rawUss?.provenance?.signalId || derivedTelemetry?.signalId;
  const symbol = derivedTelemetry?.meta?.symbol || context.rawUss?.provenance?.providerRef || "UNKNOWN";
  const timeframe = derivedTelemetry?.meta?.timeframe || "1h";
  const strategy = derivedTelemetry?.meta?.strategy || context.rawUss?.provenance?.providerRef || "unknown";
  const direction = derivedTelemetry?.meta?.direction || "neutral";
  const source = context.rawUss?.provenance?.source || "tradingview-webhook";

  // Extract price source metadata and lenses from enriched signal
  const priceSource = (enrichedSignal as any)._priceFeedMetadata?.priceSource;
  const venueType = (enrichedSignal as any)._priceFeedMetadata?.venueType;
  const marketType = (enrichedSignal as any)._priceFeedMetadata?.marketType;
  const lenses = (enrichedSignal as any).lenses || [];
  const technicalIndicators = (enrichedSignal as any)._priceFeedMetadata?.technicalIndicators;
  const patternSignals = (enrichedSignal as any)._priceFeedMetadata?.patternSignals;

  // Build ReactorScoredSignalV1 result
  const result: ReactorScoredSignalV1 = {
    signalId,
    rawUss: context.rawUss,
    lenses: lenses.length > 0 ? lenses : undefined,
    _priceFeedMetadata: {
      priceSource,
      venueType,
      marketType,
      technicalIndicators,
      patternSignals,
    },
    analystScore: analyzedSignal.analysis.analystScore,
    scoredAt,
    decayParams: decayParams
      ? {
          halfLifeMinutes: decayParams.halfLifeMinutes,
          greeksTemplateId: decayParams.greeksTemplateId,
        }
      : null,
    meta: {
      symbol,
      timeframe,
      strategy,
      direction,
      source,
    },
  };

  // Reactor Vault Integration
  // Persist the scored signal to MongoDB (if enabled)
  const vaultService = getTssdVaultService();
  if (vaultService) {
    // PROVENANCE GUARDRAIL: Enforce priceSource and venueType for all vault writes
    // These fields are required for audit trail and data provenance tracking
    if (!priceSource || !venueType) {
      const errorMsg = `❌ Reactor Vault Write BLOCKED: Missing provenance metadata for signal ${signalId}. ` +
        `priceSource=${priceSource}, venueType=${venueType}. ` +
        `All price-based pipelines MUST attach _priceFeedMetadata in enrichment stage.`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    const reactorDoc: ReactorScoredSignalDocument = {
      signalId,
      createdAt: new Date(),
      source,
      market: {
        symbol,
        timeframe,
        market: marketType || "spot",
        priceSource,
        venueType,
      },
      lenses: lenses.length > 0 ? lenses : undefined,
      _priceFeedMetadata: {
        technicalIndicators,
        patternSignals,
      },
      pipeline: {
        analystScore: analyzedSignal.analysis.analystScore,
        scoredAt,
        decayParams: decayParams
          ? {
              halfLifeMinutes: decayParams.halfLifeMinutes,
              greeksTemplateId: decayParams.greeksTemplateId,
            }
          : null,
      },
      strategy: {
        name: strategy,
        direction,
      },
      rawUss: context.rawUss,
      rawPayload: context.rawUss || derivedTelemetry,
      version: "v1.0",
    };

    await vaultService.insertSignalDocument(reactorDoc);
  }

  return result;
}
// @ts-nocheck
