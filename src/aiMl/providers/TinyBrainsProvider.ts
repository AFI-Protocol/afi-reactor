/**
 * Tiny Brains Provider
 *
 * ML provider implementation that wraps the existing Tiny Brains microservice.
 * This provider maintains backward compatibility with the existing Tiny Brains
 * integration while conforming to the MLProvider interface.
 *
 * @module providers/TinyBrainsProvider
 */

import type {
  MLProvider,
  MLProviderInput,
  MLProviderOutput,
  MLProviderHealth,
  MLProviderCapabilities,
  TinyBrainsConfig,
} from './types';
import { fetchAiMlForFroggy, type TinyBrainsFroggyInput, type TinyBrainsAiMl } from '../tinyBrainsClient';

/**
 * Tiny Brains Provider
 *
 * Implements the MLProvider interface for the Tiny Brains microservice.
 * Wraps the existing fetchAiMlForFroggy() function to provide a standardized
 * interface for ML predictions.
 *
 * Fail-soft behavior:
 * - Returns undefined on all errors
 * - Never throws exceptions
 * - Logs warnings/errors for debugging
 *
 * @example
 * ```typescript
 * const provider = new TinyBrainsProvider();
 * await provider.initialize({ tinyBrainsUrl: 'http://localhost:8000' });
 *
 * if (await provider.isAvailable()) {
 *   const prediction = await provider.predict({
 *     signalId: 'signal-123',
 *     symbol: 'BTC',
 *     timeframe: '1h',
 *     technical: { emaDistancePct: 0.5 },
 *     pattern: { patternName: 'bullish-engulfing' },
 *     sentiment: { score: 0.7 },
 *     newsFeatures: {
 *       hasNewsShock: false,
 *       headlineCount: 0,
 *       mostRecentMinutesAgo: null,
 *       oldestMinutesAgo: null,
 *       hasExchangeEvent: false,
 *       hasRegulatoryEvent: false,
 *       hasMacroEvent: false,
 *     },
 *   });
 *
 *   if (prediction) {
 *     console.log(`Direction: ${prediction.direction}, Conviction: ${prediction.convictionScore}`);
 *   }
 * }
 * ```
 */
export class TinyBrainsProvider implements MLProvider {
  /**
   * Unique identifier for this provider
   */
  readonly providerId: string = 'tiny-brains';

  /**
   * Human-readable name for this provider
   */
  readonly providerName: string = 'Tiny Brains';

  /**
   * Provider version
   */
  readonly version: string = '1.0.0';

  /**
   * Provider capabilities
   */
  readonly capabilities: MLProviderCapabilities = {
    supportedAssets: ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI'],
    supportedTimeframes: ['1m', '5m', '15m', '1h', '4h', '1d'],
    supportsBatch: false,
    supportsStreaming: false,
    maxInputSize: 10240,
    maxBatchSize: 1,
    metadata: {
      serviceType: 'microservice',
      protocol: 'http',
      description: 'Tiny Brains ML prediction service',
    },
  };

  /**
   * Provider configuration
   */
  private config: TinyBrainsConfig | null = null;

  /**
   * Provider status
   */
  private status: 'uninitialized' | 'ready' | 'disposed' = 'uninitialized';

  /**
   * Initialize the provider with configuration
   *
   * Checks if TINY_BRAINS_URL is configured and stores the configuration.
   * This method is fail-soft - it will not throw exceptions.
   *
   * @param config - Provider-specific configuration (TinyBrainsConfig)
   * @returns Promise that resolves when initialization is complete
   *
   * @example
   * ```typescript
   * await provider.initialize({
   *   tinyBrainsUrl: 'http://localhost:8000',
   *   tinyBrainsTimeout: 1500,
   * });
   * ```
   */
  async initialize(config: unknown): Promise<void> {
    try {
      this.config = config as TinyBrainsConfig;

      // Validate configuration
      const tinyBrainsUrl = this.config?.tinyBrainsUrl || process.env.TINY_BRAINS_URL;
      if (!tinyBrainsUrl) {
        console.warn('[TinyBrainsProvider] TINY_BRAINS_URL not configured');
        this.status = 'ready'; // Still ready, just won't be available
        return;
      }

      this.status = 'ready';
    } catch (error) {
      console.error('[TinyBrainsProvider] Initialization error:', error);
      this.status = 'ready'; // Fail-soft: still mark as ready
    }
  }

  /**
   * Check if the provider is available and ready to serve requests
   *
   * Returns true if TINY_BRAINS_URL is configured and the provider is not disposed.
   *
   * @returns Promise that resolves to true if provider is available
   *
   * @example
   * ```typescript
   * if (await provider.isAvailable()) {
   *   const prediction = await provider.predict(input);
   * }
   * ```
   */
  async isAvailable(): Promise<boolean> {
    if (this.status === 'disposed') {
      return false;
    }

    const tinyBrainsUrl = this.config?.tinyBrainsUrl || process.env.TINY_BRAINS_URL;
    return !!tinyBrainsUrl;
  }

  /**
   * Generate ML predictions for the given input
   *
   * Converts MLProviderInput to TinyBrainsFroggyInput, calls the existing
   * fetchAiMlForFroggy() function, and converts the result to MLProviderOutput.
   *
   * Fail-soft behavior:
   * - Returns undefined if provider is unavailable
   * - Returns undefined if prediction fails
   * - Never throws exceptions
   *
   * @param input - Standardized ML input containing enrichment features
   * @returns Promise that resolves to ML prediction or undefined if unavailable
   *
   * @example
   * ```typescript
   * const prediction = await provider.predict({
   *   signalId: 'signal-123',
   *   symbol: 'BTC',
   *   timeframe: '1h',
   *   technical: { emaDistancePct: 0.5 },
   *   pattern: { patternName: 'bullish-engulfing' },
   *   sentiment: { score: 0.7 },
   *   newsFeatures: {
   *     hasNewsShock: false,
   *     headlineCount: 0,
   *     mostRecentMinutesAgo: null,
   *     oldestMinutesAgo: null,
   *     hasExchangeEvent: false,
   *     hasRegulatoryEvent: false,
   *     hasMacroEvent: false,
   *   },
   * });
   *
   * if (prediction) {
   *   console.log(`Direction: ${prediction.direction}, Conviction: ${prediction.convictionScore}`);
   * }
   * ```
   */
  async predict(input: MLProviderInput): Promise<MLProviderOutput | undefined> {
    try {
      // Convert MLProviderInput to TinyBrainsFroggyInput
      const tinyBrainsInput: TinyBrainsFroggyInput = {
        signalId: input.signalId,
        symbol: input.symbol,
        timeframe: input.timeframe,
        traceId: input.traceId,
        technical: input.technical,
        pattern: input.pattern,
        sentiment: input.sentiment,
        newsFeatures: input.newsFeatures,
      };

      // Call the existing fetchAiMlForFroggy function
      const result = await fetchAiMlForFroggy(tinyBrainsInput);

      if (!result) {
        return undefined;
      }

      // Convert TinyBrainsAiMl to MLProviderOutput
      const output: MLProviderOutput = {
        convictionScore: result.convictionScore,
        direction: result.direction,
        regime: result.regime,
        riskFlag: result.riskFlag,
        notes: result.notes,
        providerId: this.providerId,
        timestamp: new Date().toISOString(),
        providerMetadata: {
          source: 'tiny-brains',
        },
      };

      return output;
    } catch (error) {
      console.error('[TinyBrainsProvider] Prediction error:', error);
      return undefined;
    }
  }

  /**
   * Get provider health status
   *
   * Makes a simple request to the Tiny Brains service endpoint to check
   * if it's reachable and responding correctly.
   *
   * @returns Promise that resolves to health status
   *
   * @example
   * ```typescript
   * const health = await provider.getHealth();
   * if (health.healthy) {
   *   console.log('Provider is healthy');
   * } else {
   *   console.error('Provider is unhealthy:', health.error);
   * }
   * ```
   */
  async getHealth(): Promise<MLProviderHealth> {
    const startTime = Date.now();
    const tinyBrainsUrl = this.config?.tinyBrainsUrl || process.env.TINY_BRAINS_URL;

    if (!tinyBrainsUrl) {
      return {
        healthy: false,
        timestamp: new Date().toISOString(),
        message: 'TINY_BRAINS_URL not configured',
        error: {
          code: 'NOT_CONFIGURED',
          message: 'Tiny Brains service URL is not configured',
        },
      };
    }

    try {
      // Make a simple health check request
      const url = `${tinyBrainsUrl}/health`;
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        return {
          healthy: true,
          timestamp: new Date().toISOString(),
          message: 'Service is healthy',
          metrics: {
            averageResponseTime: responseTime,
          },
        };
      } else {
        return {
          healthy: false,
          timestamp: new Date().toISOString(),
          message: 'Service returned non-OK status',
          error: {
            code: 'SERVICE_ERROR',
            message: `Service returned ${response.status} ${response.statusText}`,
          },
          metrics: {
            averageResponseTime: responseTime,
          },
        };
      }
    } catch (error) {
      return {
        healthy: false,
        timestamp: new Date().toISOString(),
        message: 'Service is unreachable',
        error: {
          code: 'UNREACHABLE',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        metrics: {
          averageResponseTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Cleanup provider resources
   *
   * Disposes of the provider and releases any held resources.
   * After disposal, the provider will no longer be available.
   *
   * @returns Promise that resolves when cleanup is complete
   *
   * @example
   * ```typescript
   * await provider.dispose();
   * // Provider is now disposed and cannot be used
   * ```
   */
  async dispose(): Promise<void> {
    this.status = 'disposed';
    this.config = null;
  }
}
