/**
 * Tiny Brains Client - AI/ML Microservice Integration
 *
 * Purpose: Call external Python microservice for ML predictions.
 * Fail-soft: If service is unavailable or errors, returns undefined.
 *
 * This client populates the `aiMl` field on FroggyEnrichedView with predictions
 * from Tiny Brains models. The field is optional and does not affect UWR scoring
 * or strategy logic (read-only context for now).
 */

import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";

/**
 * Type alias for the aiMl response from Tiny Brains.
 * This ensures we stay in sync with afi-core's FroggyAiMlV1 type.
 */
export type TinyBrainsAiMl = NonNullable<FroggyEnrichedView["aiMl"]>;

/**
 * Input payload for Tiny Brains service.
 * Lightweight snapshot of enriched context for ML model consumption.
 */
export interface TinyBrainsFroggyInput {
  signalId: string;
  symbol: string;
  timeframe: string;
  /** Optional trace ID for observability (defaults to signalId if not provided) */
  traceId?: string;
  // Lightweight snapshot of enrichment results
  technical?: {
    emaDistancePct?: number | null;
    isInValueSweetSpot?: boolean | null;
    brokeEmaWithBody?: boolean | null;
    indicators?: Record<string, number | null> | null;
  };
  pattern?: {
    patternName?: string | null;
    patternConfidence?: number | null;
    regime?: unknown;
  };
  sentiment?: {
    score?: number | null;
    tags?: string[] | null;
  };
  newsFeatures?: {
    hasNewsShock: boolean;
    headlineCount: number;
    mostRecentMinutesAgo: number | null;
    oldestMinutesAgo: number | null;
    hasExchangeEvent: boolean;
    hasRegulatoryEvent: boolean;
    hasMacroEvent: boolean;
  };
}

/**
 * Get Tiny Brains base URL from environment.
 * Returns null if not configured.
 */
function getTinyBrainsBaseUrl(): string | null {
  const url = process.env.TINY_BRAINS_URL?.trim();
  return url ? url : null;
}

/**
 * Fetch AI/ML predictions from Tiny Brains service.
 *
 * @param input - Enrichment context for ML model
 * @returns AI/ML prediction object, or undefined if service unavailable/errors
 *
 * Fail-soft behavior:
 * - If TINY_BRAINS_URL is not set, returns undefined immediately
 * - If HTTP request fails or times out, logs debug message and returns undefined
 * - If response is non-2xx, logs warning and returns undefined
 */
export async function fetchAiMlForFroggy(
  input: TinyBrainsFroggyInput,
): Promise<TinyBrainsAiMl | undefined> {
  const baseUrl = getTinyBrainsBaseUrl();
  if (!baseUrl) {
    // Service not configured - this is normal, not an error
    return undefined;
  }

  const debugAiMl = process.env.AFI_DEBUG_AIML === "1";

  try {
    const url = `${baseUrl}/predict/froggy`;

    if (debugAiMl) {
      console.log(`[TinyBrainsClient] DEBUG: Calling ${url}`);
      console.log(`[TinyBrainsClient] DEBUG: Input:`, JSON.stringify(input, null, 2));
    }

    // Use native fetch with timeout (1.5s - ML inference should be fast)
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AFI-Client": "afi-reactor-froggy-v1",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(1500), // 1.5s timeout
    });

    if (debugAiMl) {
      console.log(`[TinyBrainsClient] DEBUG: Response status=${response.status} ${response.statusText}`);
    }

    if (!response.ok) {
      console.warn(
        `[TinyBrainsClient] Service error: ${response.status} ${response.statusText}`
      );
      return undefined;
    }

    const data: TinyBrainsAiMl = await response.json();

    if (debugAiMl) {
      console.log(`[TinyBrainsClient] DEBUG: Response data:`, JSON.stringify(data, null, 2));
    }

    // Validate response has required fields
    if (
      typeof data.convictionScore !== "number" ||
      !["long", "short", "neutral"].includes(data.direction)
    ) {
      console.warn(
        `[TinyBrainsClient] Invalid response format: missing or invalid required fields`
      );
      return undefined;
    }

    return data;
  } catch (err) {
    // Network error, timeout, or JSON parse error
    if (debugAiMl) {
      console.log(`[TinyBrainsClient] DEBUG: Error fetching AI/ML prediction:`, err);
    } else {
      // Only log at debug level - this is expected when service is down
      console.debug(`[TinyBrainsClient] AI/ML service unavailable:`, err);
    }
    return undefined;
  }
}

