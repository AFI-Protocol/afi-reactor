/**
 * Alpha Scout Ingest Plugin (Dev/Demo Only)
 * 
 * Purpose: Convert Alpha-style signal drafts into reactor signal envelopes.
 * 
 * This is a DEV/DEMO plugin for the Froggy pipeline. It does NOT:
 * - Connect to real exchanges or data sources
 * - Perform real-time market analysis
 * - Execute actual trades
 * 
 * It DOES:
 * - Accept Alpha-style draft signals (partial objects)
 * - Generate synthetic signalId if missing
 * - Wrap into ReactorSignalEnvelope shape
 * - Preserve meta fields (symbol, market, timeframe, strategy)
 * 
 * Part of: froggy-trend-pullback-v1 pipeline (Alpha → Pixel Rick → Froggy → Val Dook → Execution Sim)
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import type { EnrichmentProfile } from "afi-core/analysts/froggy.enrichment_adapter.js";

/**
 * Alpha-style draft signal input schema.
 * Minimal shape expected from Alpha Scout agent.
 *
 * Now includes optional enrichmentProfile that Pixel Rick (or other personas) can attach
 * to specify which enrichment categories should be enabled.
 */
const alphaDraftSchema = z.object({
  signalId: z.string().optional(),
  symbol: z.string(),
  market: z.string().optional(),
  timeframe: z.string().optional(),
  strategy: z.string().optional(),
  direction: z.enum(["long", "short", "neutral"]).optional(),
  setupSummary: z.string().optional(),
  notes: z.string().optional(),
  enrichmentProfile: z.any().optional(), // EnrichmentProfile from afi-core
});

/**
 * Reactor signal envelope output schema.
 * This is the shape expected by downstream nodes in the DAG.
 *
 * Now includes enrichmentProfile in meta to carry enrichment configuration
 * through the pipeline.
 */
const reactorSignalEnvelopeSchema = z.object({
  signalId: z.string(),
  score: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  timestamp: z.string(),
  meta: z.object({
    symbol: z.string(),
    market: z.string(),
    timeframe: z.string(),
    strategy: z.string(),
    direction: z.enum(["long", "short", "neutral"]).optional(),
    setupSummary: z.string().optional(),
    notes: z.string().optional(),
    source: z.string(),
    enrichmentProfile: z.any().optional(), // EnrichmentProfile from afi-core
  }),
});

type AlphaDraft = z.infer<typeof alphaDraftSchema>;
type ReactorSignalEnvelope = z.infer<typeof reactorSignalEnvelopeSchema>;

/**
 * Convert Alpha-style draft into reactor signal envelope.
 *
 * @param draft - Alpha-style signal draft (may be missing signalId)
 * @returns ReactorSignalEnvelope with guaranteed signalId and timestamp
 */
async function run(draft: AlphaDraft): Promise<ReactorSignalEnvelope> {
  // Validate input
  const validatedDraft = alphaDraftSchema.parse(draft);

  // Generate signalId if missing
  const signalId = validatedDraft.signalId || `alpha-${randomUUID()}`;

  // Build reactor signal envelope
  const envelope: ReactorSignalEnvelope = {
    signalId,
    score: 0, // Initial score; will be computed downstream
    confidence: 0.5, // Default confidence; will be refined by Froggy
    timestamp: new Date().toISOString(),
    meta: {
      symbol: validatedDraft.symbol,
      market: validatedDraft.market || "spot",
      timeframe: validatedDraft.timeframe || "1h",
      strategy: validatedDraft.strategy || "froggy_trend_pullback_v1",
      direction: validatedDraft.direction,
      setupSummary: validatedDraft.setupSummary,
      notes: validatedDraft.notes,
      source: "alpha-scout",
      // Attach enrichmentProfile if provided (typically from Pixel Rick or other personas)
      enrichmentProfile: validatedDraft.enrichmentProfile,
    },
  };

  // Validate output
  return reactorSignalEnvelopeSchema.parse(envelope);
}

export default {
  run,
  inputSchema: alphaDraftSchema,
  outputSchema: reactorSignalEnvelopeSchema,
};

