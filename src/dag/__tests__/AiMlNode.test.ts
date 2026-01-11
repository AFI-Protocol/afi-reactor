/**
 * AFI Reactor - AI/ML Node Tests
 *
 * Comprehensive unit tests for the AiMlNode plugin with provider-based architecture.
 *
 * @module afi-reactor/src/langgraph/__tests__/AiMlNode.test
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { PipelineState } from '../../types/pipeline.js';
import { AiMlNode } from '../plugins/AiMlNode.js';
import { MLProviderRegistry } from '../../aiMl/providers/MLProviderRegistry.js';
import type {
  MLProvider,
  MLProviderInput,
  MLProviderOutput,
  MLProviderFactory,
  MLProviderHealth,
  MLProviderCapabilities,
} from '../../aiMl/providers/types.js';
import { TinyBrainsProvider } from '../../aiMl/providers/TinyBrainsProvider.js';
import { createTestSignal } from './test-utils.js';

// Mock the Tiny Brains client
jest.mock('../../aiMl/tinyBrainsClient.js', () => ({
  fetchAiMlForFroggy: jest.fn(),
}));

// ============================================================================
// Mock ML Provider for Testing
// ============================================================================

/**
 * Mock ML Provider for testing
 *
 * Implements the MLProvider interface with deterministic behavior for testing.
 * Returns predictable test data and supports all required methods.
 */
class MockMLProvider implements MLProvider {
  readonly providerId: string;
  readonly providerName: string;
  readonly version: string;
  readonly capabilities: MLProviderCapabilities;

  private available: boolean;
  private shouldFail: boolean;
  private predictionDelay: number;
  private predictionResult: MLProviderOutput | null;

  constructor(
    providerId: string = 'mock-provider',
    options: {
      available?: boolean;
      shouldFail?: boolean;
      predictionDelay?: number;
      predictionResult?: MLProviderOutput | null;
    } = {}
  ) {
    this.providerId = providerId;
    this.providerName = `Mock ${providerId}`;
    this.version = '1.0.0';
    this.capabilities = {
      supportedAssets: ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI'],
      supportedTimeframes: ['1m', '5m', '15m', '1h', '4h', '1d'],
      supportsBatch: false,
      supportsStreaming: false,
      maxInputSize: 10240,
      maxBatchSize: 1,
      metadata: {
        testProvider: true,
      },
    };

    this.available = options.available ?? true;
    this.shouldFail = options.shouldFail ?? false;
    this.predictionDelay = options.predictionDelay ?? 0;
    this.predictionResult = options.predictionResult ?? null;
  }

  async initialize(config: unknown): Promise<void> {
    // Mock initialization - always succeeds
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async predict(input: MLProviderInput): Promise<MLProviderOutput | undefined> {
    if (this.predictionDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.predictionDelay));
    }

    if (this.shouldFail) {
      return undefined;
    }

    if (this.predictionResult) {
      return this.predictionResult;
    }

    // Return deterministic prediction based on input
    return {
      convictionScore: 0.8,
      direction: 'long',
      regime: 'bull',
      riskFlag: false,
      notes: `Mock prediction for ${input.symbol}`,
      providerId: this.providerId,
      timestamp: new Date().toISOString(),
      providerMetadata: {
        testProvider: true,
        inputSignalId: input.signalId,
      },
    };
  }

  async getHealth(): Promise<MLProviderHealth> {
    if (this.available) {
      return {
        healthy: true,
        timestamp: new Date().toISOString(),
        message: 'Mock provider is healthy',
        metrics: {
          averageResponseTime: 10,
          successRate: 1.0,
          requestCount: 0,
          errorCount: 0,
        },
      };
    } else {
      return {
        healthy: false,
        timestamp: new Date().toISOString(),
        message: 'Mock provider is unavailable',
        error: {
          code: 'UNAVAILABLE',
          message: 'Provider is marked as unavailable',
        },
      };
    }
  }

  async dispose(): Promise<void> {
    // Mock disposal - always succeeds
  }

  // Test helper methods
  setAvailable(available: boolean): void {
    this.available = available;
  }

  setShouldFail(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  setPredictionResult(result: MLProviderOutput | null): void {
    this.predictionResult = result;
  }
}

// ============================================================================
// Test Setup
// ============================================================================

describe('AiMlNode', () => {
  let node: AiMlNode;
  let mockState: PipelineState;
  let mockRegistry: MLProviderRegistry;
  let mockProvider: MockMLProvider;

  beforeEach(() => {
    // Create mock provider
    mockProvider = new MockMLProvider('mock-provider', {
      available: true,
      shouldFail: false,
    });

    // Create mock factory
    const mockFactory: MLProviderFactory = {
      create: (providerId: string, config: unknown) => {
        return mockProvider;
      },
      getSupportedProviders: () => ['mock-provider'],
    };

    // Create registry and register mock provider
    mockRegistry = new MLProviderRegistry();
    mockRegistry.registerProvider('mock-provider', mockFactory);
    mockRegistry.loadConfigs([
      {
        providerId: 'mock-provider',
        enabled: true,
        priority: 100,
        config: {},
      },
    ]);

    // Create node with mock registry
    node = new AiMlNode(mockRegistry);

    // Create mock state
    mockState = createTestSignal({
      signalId: 'test-signal-123',
      rawSignal: {
        symbol: 'BTC',
        timeframe: '1h',
        price: 50000,
      },
      enrichmentResults: new Map([
        ['technical-indicators', {
          emaDistancePct: 0.05,
          isInValueSweetSpot: true,
          brokeEmaWithBody: false,
          indicators: { rsi: 65, macd: 0.5 },
        }],
        ['pattern-recognition', {
          patternName: 'bullish_flag',
          patternConfidence: 0.85,
          regime: 'bullish',
        }],
        ['sentiment', {
          score: 0.7,
          tags: ['positive', 'bullish'],
        }],
        ['news', {
          hasNewsShock: false,
          headlineCount: 3,
          mostRecentMinutesAgo: 30,
          oldestMinutesAgo: 120,
          hasExchangeEvent: false,
          hasRegulatoryEvent: true,
          hasMacroEvent: false,
        }],
      ]),
    });

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ============================================================================
  // Constructor and Properties
  // ============================================================================

  describe('Constructor and Properties', () => {
    it('should create an AiMlNode instance', () => {
      expect(node).toBeInstanceOf(AiMlNode);
    });

    it('should have correct node properties', () => {
      expect(node.id).toBe('ai-ml');
      expect(node.type).toBe('enrichment');
      expect(node.plugin).toBe('ai-ml');
      expect(node.parallel).toBe(true);
      expect(node.dependencies).toEqual([]);
    });

    it('should create default registry when none provided', () => {
      const defaultNode = new AiMlNode();
      expect(defaultNode).toBeInstanceOf(AiMlNode);
      expect(defaultNode.id).toBe('ai-ml');
    });
  });

  // ============================================================================
  // Execute Tests
  // ============================================================================

  describe('execute', () => {
    it('should execute successfully and store AI/ML prediction', async () => {
      const result = await node.execute(mockState);

      expect(result).toBe(mockState);
      expect(result.enrichmentResults.has('ai-ml')).toBe(true);

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult).toEqual({
        aiMl: {
          convictionScore: 0.8,
          direction: 'long',
          regime: 'bull',
          riskFlag: false,
          notes: 'Mock prediction for BTC',
        },
        serviceAvailable: true,
        timestamp: expect.any(String),
        providerId: 'mock-provider',
      });

      // Check trace entry
      expect(result.metadata.trace).toHaveLength(1);
      const traceEntry = result.metadata.trace[0];
      expect(traceEntry.nodeId).toBe('ai-ml');
      expect(traceEntry.nodeType).toBe('enrichment');
      expect(traceEntry.status).toBe('completed');
      expect(traceEntry.startTime).toBeDefined();
      expect(traceEntry.endTime).toBeDefined();
      expect(traceEntry.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle provider unavailable (no provider selected)', async () => {
      // Create registry with no enabled providers
      const emptyRegistry = new MLProviderRegistry();
      const emptyNode = new AiMlNode(emptyRegistry);

      const result = await emptyNode.execute(mockState);

      expect(result).toBe(mockState);
      expect(result.enrichmentResults.has('ai-ml')).toBe(true);

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult).toEqual({
        aiMl: undefined,
        serviceAvailable: false,
        timestamp: expect.any(String),
      });

      // Check trace entry
      expect(result.metadata.trace).toHaveLength(1);
      const traceEntry = result.metadata.trace[0];
      expect(traceEntry.status).toBe('completed');
    });

    it('should maintain fail-soft behavior on provider error', async () => {
      mockProvider.setShouldFail(true);

      const result = await node.execute(mockState);

      expect(result).toBe(mockState);
      expect(result.enrichmentResults.has('ai-ml')).toBe(true);

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult).toEqual({
        aiMl: undefined,
        serviceAvailable: false,
        timestamp: expect.any(String),
        providerId: 'mock-provider',
      });

      // Check trace entry for completion (not failure - fail-soft)
      expect(result.metadata.trace).toHaveLength(1);
      const traceEntry = result.metadata.trace[0];
      expect(traceEntry.status).toBe('completed');
    });

    it('should handle provider marked as unavailable', async () => {
      mockProvider.setAvailable(false);

      const result = await node.execute(mockState);

      expect(result).toBe(mockState);
      expect(result.enrichmentResults.has('ai-ml')).toBe(true);

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult).toEqual({
        aiMl: undefined,
        serviceAvailable: false,
        timestamp: expect.any(String),
      });
    });

    it('should store provider ID in enrichment results', async () => {
      const result = await node.execute(mockState);

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult.providerId).toBe('mock-provider');
    });

    it('should handle non-Error exceptions', async () => {
      // Create a provider that throws a non-Error
      class ErrorThrowingProvider implements MLProvider {
        readonly providerId = 'error-provider';
        readonly providerName = 'Error Throwing Provider';
        readonly version = '1.0.0';
        readonly capabilities: MLProviderCapabilities = {
          supportedAssets: ['BTC'],
          supportedTimeframes: ['1h'],
          supportsBatch: false,
          supportsStreaming: false,
        };

        async initialize(config: unknown): Promise<void> {
          // No-op
        }

        async isAvailable(): Promise<boolean> {
          return true;
        }

        async predict(input: MLProviderInput): Promise<MLProviderOutput | undefined> {
          // Throw a non-Error value
          throw 'String error';
        }

        async getHealth(): Promise<MLProviderHealth> {
          return {
            healthy: true,
            timestamp: new Date().toISOString(),
          };
        }

        async dispose(): Promise<void> {
          // No-op
        }
      }

      const errorFactory: MLProviderFactory = {
        create: (providerId: string, config: unknown) => new ErrorThrowingProvider(),
        getSupportedProviders: () => ['error-provider'],
      };

      const errorRegistry = new MLProviderRegistry();
      errorRegistry.registerProvider('error-provider', errorFactory);
      errorRegistry.loadConfigs([
        {
          providerId: 'error-provider',
          enabled: true,
          priority: 100,
          config: {},
        },
      ]);

      const errorNode = new AiMlNode(errorRegistry);
      const result = await errorNode.execute(mockState);

      expect(result.enrichmentResults.has('ai-ml')).toBe(false);

      // Check trace entry
      expect(result.metadata.trace).toHaveLength(1);
      const traceEntry = result.metadata.trace[0];
      expect(traceEntry.status).toBe('failed');
      expect(traceEntry.error).toBe('String error');
    });
  });

  describe('resolveDependencies', () => {
    it('returns enabled default deps only', () => {
      const deps = AiMlNode.resolveDependencies(['technical-indicators', 'sentiment']);
      expect(deps).toEqual(['technical-indicators', 'sentiment']);
    });

    it('returns empty when none enabled', () => {
      const deps = AiMlNode.resolveDependencies(['other-node']);
      expect(deps).toEqual([]);
    });
  });

  // ============================================================================
  // Provider Selection Tests
  // ============================================================================

  describe('Provider Selection', () => {
    it('should select provider based on priority', async () => {
      // Create multiple providers with different priorities
      const lowPriorityProvider = new MockMLProvider('low-priority', {
        predictionResult: {
          convictionScore: 0.5,
          direction: 'short',
          regime: 'bear',
          riskFlag: true,
          notes: 'Low priority prediction',
          providerId: 'low-priority',
          timestamp: new Date().toISOString(),
        },
      });

      const highPriorityProvider = new MockMLProvider('high-priority', {
        predictionResult: {
          convictionScore: 0.9,
          direction: 'long',
          regime: 'bull',
          riskFlag: false,
          notes: 'High priority prediction',
          providerId: 'high-priority',
          timestamp: new Date().toISOString(),
        },
      });

      const lowPriorityFactory: MLProviderFactory = {
        create: (providerId: string, config: unknown) => lowPriorityProvider,
        getSupportedProviders: () => ['low-priority'],
      };

      const highPriorityFactory: MLProviderFactory = {
        create: (providerId: string, config: unknown) => highPriorityProvider,
        getSupportedProviders: () => ['high-priority'],
      };

      const multiRegistry = new MLProviderRegistry();
      multiRegistry.registerProvider('low-priority', lowPriorityFactory);
      multiRegistry.registerProvider('high-priority', highPriorityFactory);
      multiRegistry.loadConfigs([
        {
          providerId: 'low-priority',
          enabled: true,
          priority: 50,
          config: {},
        },
        {
          providerId: 'high-priority',
          enabled: true,
          priority: 100,
          config: {},
        },
      ]);

      const multiNode = new AiMlNode(multiRegistry);
      const result = await multiNode.execute(mockState);

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult.providerId).toBe('high-priority');
      expect(aiMlResult.aiMl.notes).toBe('High priority prediction');
    });

    it('should fallback to next available provider when primary fails', async () => {
      // Note: The registry selects the best available provider before prediction.
      // If the primary provider is available but fails during prediction,
      // the node will store the failure result. True fallback requires
      // the primary to be unavailable during selection.
      
      const unavailableProvider = new MockMLProvider('unavailable', {
        available: false,
      });

      const fallbackProvider = new MockMLProvider('fallback', {
        predictionResult: {
          convictionScore: 0.7,
          direction: 'long',
          regime: 'bull',
          riskFlag: false,
          notes: 'Fallback prediction',
          providerId: 'fallback',
          timestamp: new Date().toISOString(),
        },
      });

      const unavailableFactory: MLProviderFactory = {
        create: (providerId: string, config: unknown) => unavailableProvider,
        getSupportedProviders: () => ['unavailable'],
      };

      const fallbackFactory: MLProviderFactory = {
        create: (providerId: string, config: unknown) => fallbackProvider,
        getSupportedProviders: () => ['fallback'],
      };

      const fallbackRegistry = new MLProviderRegistry();
      fallbackRegistry.registerProvider('unavailable', unavailableFactory);
      fallbackRegistry.registerProvider('fallback', fallbackFactory);
      fallbackRegistry.loadConfigs([
        {
          providerId: 'unavailable',
          enabled: true,
          priority: 100,
          config: {},
        },
        {
          providerId: 'fallback',
          enabled: true,
          priority: 50,
          config: {},
        },
      ]);

      const fallbackNode = new AiMlNode(fallbackRegistry);
      const result = await fallbackNode.execute(mockState);

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult.providerId).toBe('fallback');
      expect(aiMlResult.aiMl.notes).toBe('Fallback prediction');
    });

    it('should handle no available providers gracefully', async () => {
      const unavailableProvider = new MockMLProvider('unavailable', {
        available: false,
      });

      const unavailableFactory: MLProviderFactory = {
        create: (providerId: string, config: unknown) => unavailableProvider,
        getSupportedProviders: () => ['unavailable'],
      };

      const unavailableRegistry = new MLProviderRegistry();
      unavailableRegistry.registerProvider('unavailable', unavailableFactory);
      unavailableRegistry.loadConfigs([
        {
          providerId: 'unavailable',
          enabled: true,
          priority: 100,
          config: {},
        },
      ]);

      const unavailableNode = new AiMlNode(unavailableRegistry);
      const result = await unavailableNode.execute(mockState);

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult.serviceAvailable).toBe(false);
      expect(aiMlResult.aiMl).toBeUndefined();
    });
  });

  // ============================================================================
  // Provider Health Check Tests
  // ============================================================================

  describe('Provider Health Check Integration', () => {
    it('should check provider health before prediction', async () => {
      const healthCheckProvider = new MockMLProvider('health-check', {
        available: true,
      });

      const healthCheckFactory: MLProviderFactory = {
        create: (providerId: string, config: unknown) => healthCheckProvider,
        getSupportedProviders: () => ['health-check'],
      };

      const healthRegistry = new MLProviderRegistry();
      healthRegistry.registerProvider('health-check', healthCheckFactory);
      healthRegistry.loadConfigs([
        {
          providerId: 'health-check',
          enabled: true,
          priority: 100,
          config: {},
        },
      ]);

      const healthNode = new AiMlNode(healthRegistry);

      // Execute node (this will instantiate the provider)
      const result = await healthNode.execute(mockState);

      // Get health status after execution (provider is now instantiated)
      const healthStatus = await healthRegistry.getHealthStatus();
      expect(healthStatus.get('health-check')?.healthy).toBe(true);

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult.serviceAvailable).toBe(true);
    });

    it('should not use unhealthy provider', async () => {
      const unhealthyProvider = new MockMLProvider('unhealthy', {
        available: false,
      });

      const unhealthyFactory: MLProviderFactory = {
        create: (providerId: string, config: unknown) => unhealthyProvider,
        getSupportedProviders: () => ['unhealthy'],
      };

      const unhealthyRegistry = new MLProviderRegistry();
      unhealthyRegistry.registerProvider('unhealthy', unhealthyFactory);
      unhealthyRegistry.loadConfigs([
        {
          providerId: 'unhealthy',
          enabled: true,
          priority: 100,
          config: {},
        },
      ]);

      const unhealthyNode = new AiMlNode(unhealthyRegistry);

      // Execute node
      const result = await unhealthyNode.execute(mockState);

      // Get health status (provider may not be instantiated if unavailable)
      const healthStatus = await unhealthyRegistry.getHealthStatus();
      // Health status may be undefined if provider was never instantiated
      if (healthStatus.has('unhealthy')) {
        expect(healthStatus.get('unhealthy')?.healthy).toBe(false);
      }

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult.serviceAvailable).toBe(false);
    });
  });

  // ============================================================================
  // Backward Compatibility Tests
  // ============================================================================

  describe('Backward Compatibility', () => {
    it('should work with default registry (Tiny Brains auto-registered)', async () => {
      const defaultNode = new AiMlNode();

      // Node should be created successfully
      expect(defaultNode).toBeInstanceOf(AiMlNode);
      expect(defaultNode.id).toBe('ai-ml');
    });

    it('should maintain existing enrichment result format', async () => {
      const result = await node.execute(mockState);

      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;

      // Verify existing fields are present
      expect(aiMlResult).toHaveProperty('aiMl');
      expect(aiMlResult).toHaveProperty('serviceAvailable');
      expect(aiMlResult).toHaveProperty('timestamp');

      // Verify new providerId field is present
      expect(aiMlResult).toHaveProperty('providerId');

      // Verify aiMl object has expected structure
      expect(aiMlResult.aiMl).toHaveProperty('convictionScore');
      expect(aiMlResult.aiMl).toHaveProperty('direction');
      expect(aiMlResult.aiMl).toHaveProperty('regime');
      expect(aiMlResult.aiMl).toHaveProperty('riskFlag');
      expect(aiMlResult.aiMl).toHaveProperty('notes');
    });
  });

  // ============================================================================
  // Feature Extraction Tests
  // ============================================================================

  describe('buildProviderInput', () => {
    it('should build complete MLProviderInput from enrichment results', () => {
      const input = (node as any).buildProviderInput(mockState);

      expect(input).toEqual({
        signalId: 'test-signal-123',
        symbol: 'BTC',
        timeframe: '1h',
        traceId: 'test-signal-123',
        technical: {
          emaDistancePct: 0.05,
          isInValueSweetSpot: true,
          brokeEmaWithBody: false,
          indicators: { rsi: 65, macd: 0.5 },
        },
        pattern: {
          patternName: 'bullish_flag',
          patternConfidence: 0.85,
          regime: 'bullish',
        },
        sentiment: {
          score: 0.7,
          tags: ['positive', 'bullish'],
        },
        newsFeatures: {
          hasNewsShock: false,
          headlineCount: 3,
          mostRecentMinutesAgo: 30,
          oldestMinutesAgo: 120,
          hasExchangeEvent: false,
          hasRegulatoryEvent: true,
          hasMacroEvent: false,
        },
      });
    });

    it('should handle missing enrichment results', () => {
      const stateWithMissingResults = createTestSignal({
        signalId: 'test-signal-456',
        rawSignal: { symbol: 'ETH', timeframe: '4h' },
        enrichmentResults: new Map(),
      });

      const input = (node as any).buildProviderInput(stateWithMissingResults);

      expect(input).toEqual({
        signalId: 'test-signal-456',
        symbol: 'ETH',
        timeframe: '4h',
        traceId: 'test-signal-456',
        technical: {
          emaDistancePct: null,
          isInValueSweetSpot: null,
          brokeEmaWithBody: null,
          indicators: null,
        },
        pattern: {
          patternName: null,
          patternConfidence: null,
          regime: null,
        },
        sentiment: {
          score: null,
          tags: null,
        },
        newsFeatures: {
          hasNewsShock: false,
          headlineCount: 0,
          mostRecentMinutesAgo: null,
          oldestMinutesAgo: null,
          hasExchangeEvent: false,
          hasRegulatoryEvent: false,
          hasMacroEvent: false,
        },
      });
    });

    it('should handle partial enrichment results', () => {
      const stateWithPartialResults = createTestSignal({
        signalId: 'test-signal-789',
        rawSignal: { symbol: 'ADA' },
        enrichmentResults: new Map([
          ['technical-indicators', { emaDistancePct: null }],
          ['sentiment', {}],
        ]),
      });

      const input = (node as any).buildProviderInput(stateWithPartialResults);

      expect(input).toEqual({
        signalId: 'test-signal-789',
        symbol: 'ADA',
        timeframe: '1h',
        traceId: 'test-signal-789',
        technical: {
          emaDistancePct: null,
          isInValueSweetSpot: null,
          brokeEmaWithBody: null,
          indicators: null,
        },
        pattern: {
          patternName: null,
          patternConfidence: null,
          regime: null,
        },
        sentiment: {
          score: null,
          tags: null,
        },
        newsFeatures: {
          hasNewsShock: false,
          headlineCount: 0,
          mostRecentMinutesAgo: null,
          oldestMinutesAgo: null,
          hasExchangeEvent: false,
          hasRegulatoryEvent: false,
          hasMacroEvent: false,
        },
      });
    });
  });

  // ============================================================================
  // Helper Method Tests
  // ============================================================================

  describe('extractSymbol', () => {
    it('should extract symbol from rawSignal object', () => {
      const rawSignal = { symbol: 'BTC', price: 50000 };
      const result = (node as any).extractSymbol(rawSignal);
      expect(result).toBe('BTC');
    });

    it('should return default BTC when symbol is not a string', () => {
      const rawSignal = { symbol: 123, price: 50000 };
      const result = (node as any).extractSymbol(rawSignal);
      expect(result).toBe('BTC');
    });

    it('should return default BTC when symbol property is missing', () => {
      const rawSignal = { price: 50000 };
      const result = (node as any).extractSymbol(rawSignal);
      expect(result).toBe('BTC');
    });

    it('should return default BTC when rawSignal is not an object', () => {
      const rawSignal = 'invalid';
      const result = (node as any).extractSymbol(rawSignal);
      expect(result).toBe('BTC');
    });

    it('should return default BTC when rawSignal is null', () => {
      const rawSignal = null;
      const result = (node as any).extractSymbol(rawSignal);
      expect(result).toBe('BTC');
    });
  });

  describe('extractTimeframe', () => {
    it('should extract timeframe from rawSignal object', () => {
      const rawSignal = { timeframe: '4h', symbol: 'BTC' };
      const result = (node as any).extractTimeframe(rawSignal);
      expect(result).toBe('4h');
    });

    it('should return default 1h when timeframe is not a string', () => {
      const rawSignal = { timeframe: 60, symbol: 'BTC' };
      const result = (node as any).extractTimeframe(rawSignal);
      expect(result).toBe('1h');
    });

    it('should return default 1h when timeframe property is missing', () => {
      const rawSignal = { symbol: 'BTC' };
      const result = (node as any).extractTimeframe(rawSignal);
      expect(result).toBe('1h');
    });

    it('should return default 1h when rawSignal is not an object', () => {
      const rawSignal = 123;
      const result = (node as any).extractTimeframe(rawSignal);
      expect(result).toBe('1h');
    });

    it('should return default 1h when rawSignal is undefined', () => {
      const rawSignal = undefined;
      const result = (node as any).extractTimeframe(rawSignal);
      expect(result).toBe('1h');
    });
  });

  describe('extractTechnicalFeatures', () => {
    it('should extract all technical features when present', () => {
      const technical = {
        emaDistancePct: 0.02,
        isInValueSweetSpot: false,
        brokeEmaWithBody: true,
        indicators: { rsi: 70, macd: -0.3 },
        extraField: 'ignored',
      };

      const result = (node as any).extractTechnicalFeatures(technical);

      expect(result).toEqual({
        emaDistancePct: 0.02,
        isInValueSweetSpot: false,
        brokeEmaWithBody: true,
        indicators: { rsi: 70, macd: -0.3 },
      });
    });

    it('should handle null values in technical features', () => {
      const technical = {
        emaDistancePct: null,
        isInValueSweetSpot: null,
        brokeEmaWithBody: null,
        indicators: null,
      };

      const result = (node as any).extractTechnicalFeatures(technical);

      expect(result).toEqual({
        emaDistancePct: null,
        isInValueSweetSpot: null,
        brokeEmaWithBody: null,
        indicators: null,
      });
    });

    it('should return empty object when technical is null', () => {
      const result = (node as any).extractTechnicalFeatures(null);
      expect(result).toEqual({});
    });

    it('should return empty object when technical is not an object', () => {
      const result = (node as any).extractTechnicalFeatures('invalid');
      expect(result).toEqual({});
    });

    it('should handle missing fields gracefully', () => {
      const technical = { emaDistancePct: 0.01 };
      const result = (node as any).extractTechnicalFeatures(technical);

      expect(result).toEqual({
        emaDistancePct: 0.01,
        isInValueSweetSpot: null,
        brokeEmaWithBody: null,
        indicators: null,
      });
    });
  });

  describe('extractPatternFeatures', () => {
    it('should extract all pattern features when present', () => {
      const pattern = {
        patternName: 'double_bottom',
        patternConfidence: 0.92,
        regime: 'bullish',
        extraField: 'ignored',
      };

      const result = (node as any).extractPatternFeatures(pattern);

      expect(result).toEqual({
        patternName: 'double_bottom',
        patternConfidence: 0.92,
        regime: 'bullish',
      });
    });

    it('should handle null values in pattern features', () => {
      const pattern = {
        patternName: null,
        patternConfidence: null,
        regime: null,
      };

      const result = (node as any).extractPatternFeatures(pattern);

      expect(result).toEqual({
        patternName: null,
        patternConfidence: null,
        regime: null,
      });
    });

    it('should return empty object when pattern is null', () => {
      const result = (node as any).extractPatternFeatures(null);
      expect(result).toEqual({});
    });

    it('should return empty object when pattern is not an object', () => {
      const result = (node as any).extractPatternFeatures(42);
      expect(result).toEqual({});
    });

    it('should handle missing fields gracefully', () => {
      const pattern = { patternName: 'triangle' };
      const result = (node as any).extractPatternFeatures(pattern);

      expect(result).toEqual({
        patternName: 'triangle',
        patternConfidence: null,
        regime: null,
      });
    });
  });

  describe('extractSentimentFeatures', () => {
    it('should extract all sentiment features when present', () => {
      const sentiment = {
        score: 0.65,
        tags: ['bullish', 'optimistic'],
        extraField: 'ignored',
      };

      const result = (node as any).extractSentimentFeatures(sentiment);

      expect(result).toEqual({
        score: 0.65,
        tags: ['bullish', 'optimistic'],
      });
    });

    it('should handle null values in sentiment features', () => {
      const sentiment = {
        score: null,
        tags: null,
      };

      const result = (node as any).extractSentimentFeatures(sentiment);

      expect(result).toEqual({
        score: null,
        tags: null,
      });
    });

    it('should return empty object when sentiment is null', () => {
      const result = (node as any).extractSentimentFeatures(null);
      expect(result).toEqual({});
    });

    it('should return empty object when sentiment is not an object', () => {
      const result = (node as any).extractSentimentFeatures('invalid');
      expect(result).toEqual({});
    });

    it('should handle missing fields gracefully', () => {
      const sentiment = { score: -0.2 };
      const result = (node as any).extractSentimentFeatures(sentiment);

      expect(result).toEqual({
        score: -0.2,
        tags: null,
      });
    });
  });

  describe('extractNewsFeatures', () => {
    it('should extract all news features when present', () => {
      const news = {
        hasNewsShock: true,
        headlineCount: 5,
        mostRecentMinutesAgo: 15,
        oldestMinutesAgo: 180,
        hasExchangeEvent: true,
        hasRegulatoryEvent: false,
        hasMacroEvent: true,
        extraField: 'ignored',
      };

      const result = (node as any).extractNewsFeatures(news);

      expect(result).toEqual({
        hasNewsShock: true,
        headlineCount: 5,
        mostRecentMinutesAgo: 15,
        oldestMinutesAgo: 180,
        hasExchangeEvent: true,
        hasRegulatoryEvent: false,
        hasMacroEvent: true,
      });
    });

    it('should handle null values in news features', () => {
      const news = {
        hasNewsShock: false,
        headlineCount: 0,
        mostRecentMinutesAgo: null,
        oldestMinutesAgo: null,
        hasExchangeEvent: false,
        hasRegulatoryEvent: false,
        hasMacroEvent: false,
      };

      const result = (node as any).extractNewsFeatures(news);

      expect(result).toEqual({
        hasNewsShock: false,
        headlineCount: 0,
        mostRecentMinutesAgo: null,
        oldestMinutesAgo: null,
        hasExchangeEvent: false,
        hasRegulatoryEvent: false,
        hasMacroEvent: false,
      });
    });

    it('should return default values when news is null', () => {
      const result = (node as any).extractNewsFeatures(null);

      expect(result).toEqual({
        hasNewsShock: false,
        headlineCount: 0,
        mostRecentMinutesAgo: null,
        oldestMinutesAgo: null,
        hasExchangeEvent: false,
        hasRegulatoryEvent: false,
        hasMacroEvent: false,
      });
    });

    it('should return default values when news is not an object', () => {
      const result = (node as any).extractNewsFeatures('invalid');

      expect(result).toEqual({
        hasNewsShock: false,
        headlineCount: 0,
        mostRecentMinutesAgo: null,
        oldestMinutesAgo: null,
        hasExchangeEvent: false,
        hasRegulatoryEvent: false,
        hasMacroEvent: false,
      });
    });

    it('should handle missing fields with defaults', () => {
      const news = { hasNewsShock: true, headlineCount: 2 };
      const result = (node as any).extractNewsFeatures(news);

      expect(result).toEqual({
        hasNewsShock: true,
        headlineCount: 2,
        mostRecentMinutesAgo: null,
        oldestMinutesAgo: null,
        hasExchangeEvent: false,
        hasRegulatoryEvent: false,
        hasMacroEvent: false,
      });
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration Tests', () => {
    it('should handle real-world scenario with mixed enrichment data', async () => {
      const realWorldState = createTestSignal({
        signalId: 'real-signal-001',
        rawSignal: {
          symbol: 'SOL',
          timeframe: '15m',
          price: 150,
        },
        enrichmentResults: new Map([
          ['technical-indicators', {
            emaDistancePct: -0.03,
            isInValueSweetSpot: false,
            brokeEmaWithBody: true,
            indicators: { rsi: 45, macd: -0.8 },
          }],
          ['pattern-recognition', {
            patternName: null,
            patternConfidence: null,
            regime: 'bearish',
          }],
          ['sentiment', {
            score: -0.4,
            tags: ['bearish', 'negative'],
          }],
          ['news', {
            hasNewsShock: true,
            headlineCount: 8,
            mostRecentMinutesAgo: 5,
            oldestMinutesAgo: 300,
            hasExchangeEvent: true,
            hasRegulatoryEvent: false,
            hasMacroEvent: true,
          }],
        ]),
      });

      const result = await node.execute(realWorldState);

      expect(result.enrichmentResults.has('ai-ml')).toBe(true);
      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult?.aiMl).toBeDefined();
      expect(aiMlResult?.serviceAvailable).toBe(true);
      expect(aiMlResult?.providerId).toBe('mock-provider');
    });

    it('should handle empty enrichment results gracefully', async () => {
      const emptyState = createTestSignal({
        signalId: 'empty-signal',
        rawSignal: {},
        enrichmentResults: new Map(),
      });

      const result = await node.execute(emptyState);

      expect(result.enrichmentResults.has('ai-ml')).toBe(true);
      const aiMlResult = result.enrichmentResults.get('ai-ml') as any;
      expect(aiMlResult?.serviceAvailable).toBe(true);
      expect(aiMlResult?.providerId).toBe('mock-provider');
    });

    it('should handle multiple sequential executions', async () => {
      const state1 = createTestSignal({
        signalId: 'signal-1',
        rawSignal: { symbol: 'BTC', timeframe: '1h' },
        enrichmentResults: new Map([
          ['technical-indicators', { emaDistancePct: 0.05 }],
          ['pattern-recognition', { patternName: 'bullish_flag' }],
          ['sentiment', { score: 0.7 }],
          ['news', { hasNewsShock: false, headlineCount: 0, mostRecentMinutesAgo: null, oldestMinutesAgo: null, hasExchangeEvent: false, hasRegulatoryEvent: false, hasMacroEvent: false }],
        ]),
      });

      const state2 = createTestSignal({
        signalId: 'signal-2',
        rawSignal: { symbol: 'ETH', timeframe: '4h' },
        enrichmentResults: new Map([
          ['technical-indicators', { emaDistancePct: -0.02 }],
          ['pattern-recognition', { patternName: 'bearish_flag' }],
          ['sentiment', { score: -0.3 }],
          ['news', { hasNewsShock: true, headlineCount: 5, mostRecentMinutesAgo: 10, oldestMinutesAgo: 60, hasExchangeEvent: false, hasRegulatoryEvent: false, hasMacroEvent: false }],
        ]),
      });

      const result1 = await node.execute(state1);
      const result2 = await node.execute(state2);

      expect(result1.enrichmentResults.get('ai-ml') as any).toHaveProperty('providerId', 'mock-provider');
      expect(result2.enrichmentResults.get('ai-ml') as any).toHaveProperty('providerId', 'mock-provider');
    });
  });
});
