/**
 * ⚠️⚠️⚠️ DEPRECATED - DO NOT USE ⚠️⚠️⚠️
 * 
 * @deprecated This plugin is DEPRECATED and should NOT be used in any new code.
 * 
 * REASON FOR DEPRECATION:
 * This plugin was part of the legacy pre-USS v1.1 ingestion flow. The canonical
 * USS v1.1 pipeline now uses:
 * 
 *   Webhook → AJV validate → context.rawUss → uss-telemetry-deriver → enrichment → analyst → validator → vault
 * 
 * The webhook layer now validates USS v1.1 payloads directly using AJV schemas,
 * and uss-telemetry-deriver extracts routing/debug fields from context.rawUss.
 * There is no need for a separate "structurer" stage.
 * 
 * MIGRATION PATH:
 * - For webhook ingestion: Use POST /api/webhooks/uss with USS v1.1 schema
 * - For pipeline stages: Use uss-telemetry-deriver to extract telemetry from context.rawUss
 * - For enrichment: Consume context.rawUss directly, not custom structured shapes
 * 
 * DO NOT:
 * - Import this plugin in new code
 * - Add this plugin to pipeline configurations
 * - Reference this plugin in DAG definitions
 * 
 * This file is preserved only for historical reference and to support legacy tests
 * during migration. It will be removed in a future cleanup.
 * 
 * Last used: Phase 3 (pre-USS v1.1 migration)
 * Quarantined: Phase 4 (USS v1.1 canonical pipeline)
 * 
 * ⚠️⚠️⚠️ DEPRECATED - DO NOT USE ⚠️⚠️⚠️
 */

/**
 * Signal Structurer Plugin (Pixel Rick) - Dev/Demo Only
 * 
 * Purpose: Ensure signal meets afi-core's base/raw signal shape requirements.
 * 
 * This is a DEV/DEMO plugin for the Froggy pipeline. It acts as the "Pixel Rick"
 * engineering step, normalizing and validating signal structure before enrichment.
 * 
 * TODO: Once afi-core exports BaseSignalSchema or RawSignalSchema, import and use
 * those types directly. For now, we maintain a type-safe structurer that mirrors
 * the expected shape.
 * 
 * Part of: froggy-trend-pullback-v1 pipeline (Alpha → Pixel Rick → Froggy → Val Dook → Execution Sim)
 */

import { z } from "zod";

/**
 * Input schema: reactor signal envelope from alpha-scout-ingest.
 */
const inputSchema = z.object({
  signalId: z.string(),
  score: z.number().optional(),
  confidence: z.number().optional(),
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
    enrichmentProfile: z.any().optional(), // Preserve enrichmentProfile from upstream
  }),
});

/**
 * Output schema: structured signal ready for enrichment.
 * Adds normalized fields and ensures all required properties are present.
 */
const outputSchema = z.object({
  signalId: z.string(),
  score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  timestamp: z.string(),
  meta: z.object({
    symbol: z.string(),
    market: z.string(),
    timeframe: z.string(),
    strategy: z.string(),
    direction: z.enum(["long", "short", "neutral"]),
    setupSummary: z.string().optional(),
    notes: z.string().optional(),
    source: z.string(),
    enrichmentProfile: z.any().optional(), // Preserve enrichmentProfile
  }),
  structured: z.object({
    normalizedTimestamp: z.string(),
    hasValidMeta: z.boolean(),
    structuredBy: z.string(),
  }),
});

type InputSignal = z.infer<typeof inputSchema>;
type StructuredSignal = z.infer<typeof outputSchema>;

/**
 * Normalize and validate signal structure.
 * 
 * This is the "Pixel Rick" step: ensuring the signal is well-formed,
 * all required fields are present, and numeric values are in valid ranges.
 * 
 * @param signal - Raw signal from alpha-scout-ingest
 * @returns Structured signal ready for Froggy enrichment
 */
async function run(signal: InputSignal): Promise<StructuredSignal> {
  // Validate input
  const validatedInput = inputSchema.parse(signal);

  // Normalize score and confidence to [0, 1] range
  const normalizedScore = Math.min(1, Math.max(0, validatedInput.score ?? 0));
  const normalizedConfidence = Math.min(1, Math.max(0, validatedInput.confidence ?? 0.5));

  // Ensure direction is set (default to neutral if missing)
  const direction = validatedInput.meta.direction ?? "neutral";

  // Build structured signal
  const structured: StructuredSignal = {
    signalId: validatedInput.signalId,
    score: normalizedScore,
    confidence: normalizedConfidence,
    timestamp: validatedInput.timestamp,
    meta: {
      ...validatedInput.meta,
      direction,
      // Preserve enrichmentProfile from upstream (if present)
      enrichmentProfile: validatedInput.meta.enrichmentProfile,
    },
    structured: {
      normalizedTimestamp: new Date(validatedInput.timestamp).toISOString(),
      hasValidMeta: !!(
        validatedInput.meta.symbol &&
        validatedInput.meta.market &&
        validatedInput.meta.timeframe &&
        validatedInput.meta.strategy
      ),
      structuredBy: "pixelrick-structurer",
    },
  };

  // Validate output
  return outputSchema.parse(structured);
}

export default {
  run,
  inputSchema,
  outputSchema,
};

