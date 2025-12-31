/**
 * ML Provider Types
 *
 * This module defines the core types and interfaces for the ML provider abstraction layer.
 * These types enable the AiMlNode to support multiple ML providers through a unified interface.
 *
 * @module providers/types
 */

/**
 * ML Provider Interface
 *
 * Defines the contract for all ML prediction providers.
 * All providers must implement this interface to be compatible with AiMlNode.
 */
export interface MLProvider {
  /**
   * Unique identifier for this provider
   */
  readonly providerId: string;

  /**
   * Human-readable name for this provider
   */
  readonly providerName: string;

  /**
   * Provider version
   */
  readonly version: string;

  /**
   * Provider capabilities
   */
  readonly capabilities: MLProviderCapabilities;

  /**
   * Initialize the provider with configuration
   *
   * @param config - Provider-specific configuration
   * @returns Promise that resolves when initialization is complete
   * @throws Error if initialization fails
   */
  initialize(config: unknown): Promise<void>;

  /**
   * Check if the provider is available and ready to serve requests
   *
   * @returns Promise that resolves to true if provider is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Generate ML predictions for the given input
   *
   * @param input - Standardized ML input containing enrichment features
   * @returns Promise that resolves to ML prediction or undefined if unavailable
   *
   * Fail-soft behavior:
   * - Returns undefined if provider is unavailable
   * - Returns undefined if prediction fails
   * - Never throws exceptions
   */
  predict(input: MLProviderInput): Promise<MLProviderOutput | undefined>;

  /**
   * Get provider health status
   *
   * @returns Promise that resolves to health status
   */
  getHealth(): Promise<MLProviderHealth>;

  /**
   * Cleanup provider resources
   *
   * @returns Promise that resolves when cleanup is complete
   */
  dispose(): Promise<void>;
}

/**
 * ML Provider Capabilities
 *
 * Defines what features and capabilities a provider supports
 */
export interface MLProviderCapabilities {
  /**
   * Supported asset classes
   */
  supportedAssets: string[];

  /**
   * Supported timeframes
   */
  supportedTimeframes: string[];

  /**
   * Whether provider supports batch predictions
   */
  supportsBatch: boolean;

  /**
   * Whether provider supports streaming predictions
   */
  supportsStreaming: boolean;

  /**
   * Maximum input size (in bytes)
   */
  maxInputSize?: number;

  /**
   * Maximum batch size
   */
  maxBatchSize?: number;

  /**
   * Provider-specific metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * ML Provider Input
 *
 * Standardized input format for all ML providers.
 * This format is provider-agnostic and contains all enrichment features.
 */
export interface MLProviderInput {
  /**
   * Signal identifier
   */
  signalId: string;

  /**
   * Trading symbol (e.g., "BTC", "ETH")
   */
  symbol: string;

  /**
   * Timeframe (e.g., "1h", "4h", "1d")
   */
  timeframe: string;

  /**
   * Optional trace ID for observability
   */
  traceId?: string;

  /**
   * Technical indicators features
   */
  technical: {
    emaDistancePct?: number | null;
    isInValueSweetSpot?: boolean | null;
    brokeEmaWithBody?: boolean | null;
    indicators?: Record<string, number | null> | null;
  };

  /**
   * Pattern recognition features
   */
  pattern: {
    patternName?: string | null;
    patternConfidence?: number | null;
    regime?: unknown;
  };

  /**
   * Sentiment analysis features
   */
  sentiment: {
    score?: number | null;
    tags?: string[] | null;
  };

  /**
   * News analysis features
   */
  newsFeatures: {
    hasNewsShock: boolean;
    headlineCount: number;
    mostRecentMinutesAgo: number | null;
    oldestMinutesAgo: number | null;
    hasExchangeEvent: boolean;
    hasRegulatoryEvent: boolean;
    hasMacroEvent: boolean;
  };

  /**
   * Provider-specific parameters
   */
  providerParams?: Record<string, unknown>;
}

/**
 * ML Provider Output
 *
 * Standardized output format for all ML providers.
 * This format is compatible with FroggyAiMlV1 from afi-core.
 */
export interface MLProviderOutput {
  /**
   * Confidence in the suggested direction (0-1 range)
   */
  convictionScore: number;

  /**
   * Suggested trade direction from ML model
   */
  direction: 'long' | 'short' | 'neutral';

  /**
   * Optional market regime detected by model
   */
  regime?: string;

  /**
   * True if model detects elevated risk conditions
   */
  riskFlag?: boolean;

  /**
   * Optional human-readable notes or explanation from model
   */
  notes?: string | null;

  /**
   * Provider that generated this prediction
   */
  providerId: string;

  /**
   * Timestamp when prediction was generated
   */
  timestamp: string;

  /**
   * Optional provider-specific metadata
   */
  providerMetadata?: Record<string, unknown>;
}

/**
 * ML Provider Health Status
 *
 * Health status information for a provider
 */
export interface MLProviderHealth {
  /**
   * Whether provider is healthy
   */
  healthy: boolean;

  /**
   * Health check timestamp
   */
  timestamp: string;

  /**
   * Optional health message
   */
  message?: string;

  /**
   * Optional error details if unhealthy
   */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };

  /**
   * Optional metrics
   */
  metrics?: {
    averageResponseTime?: number;
    successRate?: number;
    requestCount?: number;
    errorCount?: number;
  };
}

/**
 * ML Provider Configuration
 *
 * Configuration for a specific ML provider
 */
export interface MLProviderConfig {
  /**
   * Provider identifier
   */
  providerId: string;

  /**
   * Whether this provider is enabled
   */
  enabled: boolean;

  /**
   * Provider-specific configuration
   */
  config?: Record<string, unknown>;

  /**
   * Priority for provider selection (higher = preferred)
   */
  priority?: number;

  /**
   * Fallback provider if this provider fails
   */
  fallbackProviderId?: string;
}

/**
 * ML Provider Factory
 *
 * Factory interface for creating provider instances
 */
export interface MLProviderFactory {
  /**
   * Create a new provider instance
   *
   * @param providerId - Provider identifier
   * @param config - Provider configuration
   * @returns Provider instance
   */
  create(providerId: string, config: unknown): MLProvider;

  /**
   * Get supported provider IDs
   *
   * @returns Array of supported provider IDs
   */
  getSupportedProviders(): string[];
}

/**
 * ML Provider Status
 *
 * Status states for a provider
 */
export enum MLProviderStatus {
  /**
   * Provider is uninitialized
   */
  UNINITIALIZED = 'uninitialized',

  /**
   * Provider is initializing
   */
  INITIALIZING = 'initializing',

  /**
   * Provider is ready and available
   */
  READY = 'ready',

  /**
   * Provider is unavailable (e.g., service down, network issue)
   */
  UNAVAILABLE = 'unavailable',

  /**
   * Provider encountered an error
   */
  ERROR = 'error',

  /**
   * Provider is being disposed
   */
  DISPOSING = 'disposing',

  /**
   * Provider has been disposed
   */
  DISPOSED = 'disposed',
}

/**
 * ML Provider Registry Configuration
 *
 * Top-level configuration for the ML provider system
 */
export interface MLProviderRegistryConfig {
  /**
   * Default provider ID to use if not specified
   */
  defaultProvider: string;

  /**
   * Array of provider configurations
   */
  providers: MLProviderConfig[];

  /**
   * Fallback strategy when primary provider fails
   */
  fallbackStrategy?: 'none' | 'next-available' | 'specific';

  /**
   * Health check interval in milliseconds
   */
  healthCheckInterval?: number;

  /**
   * Whether to enable periodic health checks
   */
  enableHealthChecks?: boolean;
}

/**
 * ML Provider Configuration Schema
 *
 * JSON Schema for validating ML provider configurations
 */
export const MLProviderConfigSchema = {
  type: 'object',
  properties: {
    defaultProvider: {
      type: 'string',
      description: 'Default provider ID to use if not specified',
      enum: ['tiny-brains', 'big-brains', 'custom', 'third-party'],
    },
    providers: {
      type: 'array',
      description: 'Array of provider configurations',
      items: {
        type: 'object',
        properties: {
          providerId: {
            type: 'string',
            description: 'Unique provider identifier',
          },
          enabled: {
            type: 'boolean',
            description: 'Whether this provider is enabled',
            default: true,
          },
          priority: {
            type: 'number',
            description: 'Priority for provider selection (higher = preferred)',
            default: 0,
          },
          fallbackProviderId: {
            type: 'string',
            description: 'Fallback provider if this provider fails',
          },
          config: {
            type: 'object',
            description: 'Provider-specific configuration',
            properties: {
              // Tiny Brains specific
              tinyBrainsUrl: {
                type: 'string',
                description: 'Tiny Brains service URL',
              },
              tinyBrainsTimeout: {
                type: 'number',
                description: 'Request timeout in milliseconds',
                default: 1500,
              },
              // Big Brains specific
              bigBrainsModelPath: {
                type: 'string',
                description: 'Path to Big Brains model file',
              },
              bigBrainsDevice: {
                type: 'string',
                description: 'Device to run model on (cpu, cuda, mps)',
                enum: ['cpu', 'cuda', 'mps'],
                default: 'cpu',
              },
              // Custom provider specific
              customEndpoint: {
                type: 'string',
                description: 'Custom provider endpoint URL',
              },
              customApiKey: {
                type: 'string',
                description: 'API key for custom provider',
              },
              // Third-party provider specific
              thirdPartyService: {
                type: 'string',
                description: 'Third-party service name',
              },
              thirdPartyConfig: {
                type: 'object',
                description: 'Third-party service configuration',
              },
            },
          },
        },
        required: ['providerId', 'enabled'],
      },
    },
    fallbackStrategy: {
      type: 'string',
      description: 'Fallback strategy when primary provider fails',
      enum: ['none', 'next-available', 'specific'],
      default: 'next-available',
    },
    healthCheckInterval: {
      type: 'number',
      description: 'Health check interval in milliseconds',
      default: 60000,
    },
    enableHealthChecks: {
      type: 'boolean',
      description: 'Whether to enable periodic health checks',
      default: true,
    },
  },
  required: ['defaultProvider', 'providers'],
} as const;

/**
 * Tiny Brains Provider Configuration
 *
 * Configuration specific to the Tiny Brains provider
 */
export interface TinyBrainsConfig {
  /**
   * Tiny Brains service URL
   */
  tinyBrainsUrl?: string;

  /**
   * Request timeout in milliseconds
   */
  tinyBrainsTimeout?: number;
}

/**
 * Big Brains Provider Configuration
 *
 * Configuration specific to the Big Brains provider
 */
export interface BigBrainsConfig {
  /**
   * Path to Big Brains model file
   */
  bigBrainsModelPath?: string;

  /**
   * Device to run model on (cpu, cuda, mps)
   */
  bigBrainsDevice?: 'cpu' | 'cuda' | 'mps';
}

/**
 * Custom Provider Configuration
 *
 * Configuration specific to the custom provider
 */
export interface CustomProviderConfig {
  /**
   * Custom provider endpoint URL
   */
  customEndpoint?: string;

  /**
   * API key for custom provider
   */
  customApiKey?: string;

  /**
   * Request timeout in milliseconds
   */
  timeout?: number;
}

/**
 * Third Party Provider Configuration
 *
 * Configuration specific to third-party providers
 */
export interface ThirdPartyProviderConfig {
  /**
   * Third-party service name
   */
  thirdPartyService?: string;

  /**
   * Third-party service configuration
   */
  thirdPartyConfig?: Record<string, unknown>;
}
