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

