/**
 * Local type stubs for afi-core types
 * Used in CI where afi-core (file:../afi-core) is not available
 * 
 * These types MUST match the actual afi-core types exactly.
 * DO NOT modify these without updating afi-core.
 */

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
  // Add fields as needed
  [key: string]: unknown;
}

export interface FroggyTrendPullbackInput {
  [key: string]: unknown;
}

export interface FroggyTrendPullbackScore {
  analystScore: {
    analystId: string;
    strategyId: string;
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

export function scoreFroggyTrendPullback(input: FroggyTrendPullbackInput): FroggyTrendPullbackScore {
  // Stub implementation for CI - returns minimal valid score
  return {
    analystScore: {
      analystId: "froggy",
      strategyId: "trend_pullback_v1",
      uwrScore: 0.5,
      uwrAxes: {
        structure: 0.5,
        execution: 0.5,
        risk: 0.5,
        insight: 0.5,
      },
    },
  };
}

export function scoreFroggyTrendPullbackFromEnriched(enriched: any): FroggyTrendPullbackScore {
  // Stub implementation for CI - returns minimal valid score
  return scoreFroggyTrendPullback({});
}
