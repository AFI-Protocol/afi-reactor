// Legacy ambient typings shim for older tests/missing module declarations.
// Prefer real @types packages; this is a fallback only.

// Optional: global placeholders for test frameworks
declare var describe: any;
declare var it: any;
declare var test: any;

/**
 * Type declarations for afi-core modules
 *
 * These provide type definitions when afi-core is not available (e.g., in CI).
 * When afi-core IS available (local dev), the real types from node_modules/afi-core take precedence.
 */

declare module "afi-core/analysts/froggy.enrichment_adapter.js" {
  export interface EnrichmentProfile {
    technical?: {
      enabled: boolean;
      preset?: string;
      params?: Record<string, unknown>;
    };
    pattern?: {
      enabled: boolean;
      preset?: string;
      params?: Record<string, unknown>;
    };
    sentiment?: {
      enabled: boolean;
      preset?: string;
      params?: Record<string, unknown>;
    };
    news?: {
      enabled: boolean;
      preset?: string;
      params?: Record<string, unknown>;
    };
    aiMl?: {
      enabled: boolean;
      preset?: string;
      params?: Record<string, unknown>;
    };
  }

  export interface FroggyEnrichedView {
    signalId: string;
    symbol: string;
    market: string;
    timeframe: string;
    technical?: {
      emaDistancePct?: number | null;
      isInValueSweetSpot?: boolean | null;
      brokeEmaWithBody?: boolean | null;
      indicators?: Record<string, number | null> | null;
    };
    pattern?: {
      patternName?: string | null;
      patternConfidence?: number | null;
      [key: string]: unknown;
    };
    sentiment?: {
      [key: string]: unknown;
    };
    news?: {
      [key: string]: unknown;
    };
    aiMl?: {
      convictionScore?: number;
      direction?: "long" | "short" | "neutral";
      [key: string]: unknown;
    };
    enrichmentMeta?: {
      enrichedBy?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  export interface FroggyAiMlV1 {
    convictionScore: number;
    direction: "long" | "short" | "neutral";
  }
}

declare module "afi-core/src/analyst/AnalystScoreTemplate.js" {
  export interface AnalystScoreTemplate {
    analystId: string;
    uwrScore: number;
    uwrAxes: {
      structure: number;
      execution: number;
      risk: number;
      insight: number;
    };
  }
}

declare module "afi-core/analysts/froggy.trend_pullback_v1.js" {
  export interface FroggyTrendPullbackInput {
    [key: string]: unknown;
  }

  export interface FroggyTrendPullbackScore {
    analystScore: {
      analystId: string;
      uwrScore: number;
      uwrAxes: {
        structure: number;
        execution: number;
        risk: number;
        insight: number;
      };
    };
    [key: string]: unknown;
  }

  export function scoreFroggyTrendPullback(input: FroggyTrendPullbackInput): FroggyTrendPullbackScore;
  export function scoreFroggyTrendPullbackFromEnriched(enriched: any): FroggyTrendPullbackScore;
}
