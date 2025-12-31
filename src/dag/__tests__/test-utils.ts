/**
 * AFI Reactor - DAG Test Utilities
 *
 * Comprehensive test utilities and fixtures for DAG integration tests.
 * Provides reusable components for testing DAG execution, plugin behavior, and
 * configuration scenarios.
 *
 * @module afi-reactor/src/dag/__tests__/test-utils
 */

import type { Pipehead, PipelineState } from '../../types/pipeline.js';
import { PluginRegistry } from '../PluginRegistry.js';
import { DAGBuilder, type AnalystConfig } from '../DAGBuilder.js';
import { DAGExecutor } from '../DAGExecutor.js';

// ============================================================================
// Test Configuration Creators
// ============================================================================

/**
 * Creates a test analyst configuration
 * @param nodes - Array of enrichment node configurations
 * @returns AnalystConfig object for testing
 */
export function createTestConfig(nodes: any[]): AnalystConfig {
  return {
    analystId: 'test-analyst',
    version: 'v1.0.0',
    enrichmentNodes: nodes,
  };
}

/**
 * Creates a test signal envelope with optional overrides
 * @param overrides - Optional properties to override in the signal
 * @returns PipelineState object for testing
 */
export function createTestSignal(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    signalId: `test-signal-${Date.now()}`,
    rawSignal: {
      type: 'crypto',
      symbol: 'BTC',
      price: 50000,
      timestamp: new Date().toISOString(),
    },
    enrichmentResults: new Map(),
    analystConfig: {
      analystId: 'test-analyst',
      enrichmentNodes: [],
    },
    metadata: {
      startTime: new Date().toISOString(),
      trace: [],
    },
    ...overrides,
  };
}

/**
 * Creates configuration with all built-in plugins enabled
 * @returns AnalystConfig with all plugins configured
 */
export function createAllPluginsConfig(): AnalystConfig {
  return createTestConfig([
    {
      id: 'signal-ingress',
      type: 'ingress',
      plugin: 'signal-ingress',
      enabled: true,
      dependencies: [],
      config: {},
    },
    {
      id: 'technical-indicators',
      type: 'enrichment',
      plugin: 'technical-indicators',
      enabled: true,
      dependencies: ['signal-ingress'],
      config: {},
    },
    {
      id: 'pattern-recognition',
      type: 'enrichment',
      plugin: 'pattern-recognition',
      enabled: true,
      dependencies: ['technical-indicators'],
      config: {},
    },
    {
      id: 'sentiment',
      type: 'enrichment',
      plugin: 'sentiment',
      enabled: true,
      dependencies: ['signal-ingress'],
      config: {},
    },
    {
      id: 'news',
      type: 'enrichment',
      plugin: 'news',
      enabled: true,
      dependencies: ['sentiment'],
      config: {},
    },
    {
      id: 'scout',
      type: 'ingress',
      plugin: 'scout',
      enabled: true,
      dependencies: ['pattern-recognition', 'news'],
      config: {},
    },
  ]);
}

// ============================================================================
// Mock Plugin Classes
// ============================================================================

/**
 * Configurable mock plugin for testing
 * Supports delays, failures, custom dependencies, and parallel settings
 */
export class MockPlugin implements Pipehead {
  id: string;
  type: 'enrichment' | 'ingress' | 'required' = 'enrichment';
  plugin: string;
  parallel = true;
  dependencies: string[] = [];
  private delay: number = 0;
  private shouldFail: boolean = false;
  private executeCount: number = 0;

  /**
   * Creates a new MockPlugin instance
   * @param id - Unique plugin identifier
   * @param plugin - Plugin name
   * @param options - Configuration options
   */
  constructor(
    id: string,
    plugin: string,
    options: { delay?: number; shouldFail?: boolean; dependencies?: string[]; parallel?: boolean } = {}
  ) {
    this.id = id;
    this.plugin = plugin;
    this.delay = options.delay || 0;
    this.shouldFail = options.shouldFail || false;
    this.dependencies = options.dependencies || [];
    this.parallel = options.parallel !== undefined ? options.parallel : true;
  }

  /**
   * Executes the mock plugin logic
   * @param state - Current Pipeline state
   * @returns Updated state with enrichment results
   */
  async execute(state: PipelineState): Promise<PipelineState> {
    this.executeCount++;
    if (this.delay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delay));
    }
    if (this.shouldFail) {
      throw new Error(`Mock plugin ${this.id} failed`);
    }
    state.enrichmentResults.set(this.id, {
      executed: true,
      count: this.executeCount,
      timestamp: new Date().toISOString(),
    });
    return state;
  }

  /**
   * Gets the number of times this plugin has been executed
   * @returns Execution count
   */
  getExecuteCount(): number {
    return this.executeCount;
  }
}

/**
 * Mock plugin that retries on failure
 * Useful for testing retry logic and error handling
 */
export class MockRetryPlugin implements Pipehead {
  id = 'mock-retry';
  type = 'enrichment' as const;
  plugin = 'mock-retry';
  parallel = false;
  dependencies: string[] = [];

  private attemptCount = 0;
  private maxFailures: number;

  /**
   * Creates a new MockRetryPlugin instance
   * @param maxFailures - Number of times to fail before succeeding
   */
  constructor(maxFailures: number = 2) {
    this.maxFailures = maxFailures;
  }

  /**
   * Executes the retry plugin logic
   * @param state - Current Pipeline state
   * @returns Updated state after retries
   */
  async execute(state: PipelineState): Promise<PipelineState> {
    this.attemptCount++;
    if (this.attemptCount <= this.maxFailures) {
      throw new Error('Temporary failure');
    }
    state.enrichmentResults.set(this.id, { success: true });
    return state;
  }

  /**
   * Gets the current attempt count
   * @returns Number of execution attempts
   */
  getAttemptCount(): number {
    return this.attemptCount;
  }
}

// ============================================================================
// Execution Helpers
// ============================================================================

/**
 * Waits for execution completion with timeout
 * @param executor - DAGExecutor instance
 * @param executionId - Execution ID to wait for
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @returns ExecutionResult when complete
 */
export async function waitForExecution(
  executor: DAGExecutor,
  executionId: string,
  timeout: number = 10000
): Promise<any> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const status = executor.getExecutionStatus(executionId);
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      const context = executor.getExecutionContext(executionId);
      if (context) {
        return {
          success: status === 'completed',
          executionId,
          state: context.currentState,
          status,
          metrics: executor.getExecutionMetrics(executionId)!,
          errors: [...context.errors],
          warnings: [...context.warnings],
        };
      }
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Execution ${executionId} timed out after ${timeout}ms`);
}

/**
 * Asserts that execution succeeded
 * @param result - ExecutionResult to validate
 */
export function assertExecutionSuccess(result: any): void {
  expect(result.success).toBe(true);
  expect(result.status).toBe('completed');
  expect(result.errors).toHaveLength(0);
}

/**
 * Asserts that execution failed
 * @param result - ExecutionResult to validate
 */
export function assertExecutionFailed(result: any): void {
  expect(result.success).toBe(false);
  expect(result.status).toBe('failed');
  expect(result.errors.length).toBeGreaterThan(0);
}

/**
 * Asserts that execution was cancelled
 * @param result - ExecutionResult to validate
 */
export function assertExecutionCancelled(result: any): void {
  expect(result.success).toBe(false);
  expect(result.status).toBe('cancelled');
}

// ============================================================================
// Test Setup Utilities
// ============================================================================

/**
 * Creates test setup with registry, builder, and executor instances
 * @returns Object containing initialized test components
 */
export function createTestSetup() {
  const registry = new PluginRegistry();
  const dagBuilder = new DAGBuilder(registry);
  const executor = new DAGExecutor(dagBuilder, registry);

  return {
    registry,
    dagBuilder,
    executor,

    /**
     * Cleans up test setup by clearing registry
     */
    cleanup: () => {
      registry.clear();
    },
  };
}

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Common test configurations for different scenarios
 */
export const TestConfigs = {
  /**
   * Simple pipeline with ingress -> enrichment
   */
  simple: () => createTestConfig([
    {
      id: 'signal-ingress',
      type: 'ingress',
      plugin: 'signal-ingress',
      enabled: true,
      dependencies: [],
      config: {},
    },
    {
      id: 'technical-indicators',
      type: 'enrichment',
      plugin: 'technical-indicators',
      enabled: true,
      dependencies: ['signal-ingress'],
      config: {},
    },
  ]),

  /**
   * Complex configuration with multiple dependency levels
   */
  complex: () => createTestConfig([
    {
      id: 'signal-ingress',
      type: 'ingress',
      plugin: 'signal-ingress',
      enabled: true,
      dependencies: [],
      config: {},
    },
    {
      id: 'technical-indicators',
      type: 'enrichment',
      plugin: 'technical-indicators',
      enabled: true,
      dependencies: ['signal-ingress'],
      config: {},
    },
    {
      id: 'sentiment',
      type: 'enrichment',
      plugin: 'sentiment',
      enabled: true,
      dependencies: ['signal-ingress'],
      config: {},
    },
    {
      id: 'pattern-recognition',
      type: 'enrichment',
      plugin: 'pattern-recognition',
      enabled: true,
      dependencies: ['technical-indicators'],
      config: {},
    },
    {
      id: 'news',
      type: 'enrichment',
      plugin: 'news',
      enabled: true,
      dependencies: ['sentiment'],
      config: {},
    },
    {
      id: 'scout',
      type: 'ingress',
      plugin: 'scout',
      enabled: true,
      dependencies: ['pattern-recognition', 'news'],
      config: {},
    },
  ]),

  /**
   * Configuration for error handling tests
   */
  errorHandling: () => createTestConfig([
    {
      id: 'mock-success',
      type: 'enrichment',
      plugin: 'mock-success',
      enabled: true,
      dependencies: [],
      config: {},
    },
    {
      id: 'mock-fail',
      type: 'enrichment',
      plugin: 'mock-fail',
      enabled: true,
      dependencies: [],
      config: {},
    },
  ]),

  /**
   * Configuration for performance testing
   */
  performance: (nodeCount: number = 10) => {
    const nodes: any[] = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        id: `perf-node-${i}`,
        type: 'enrichment',
        plugin: `perf-node-${i}`,
        enabled: true,
        parallel: true,
        dependencies: [],
        config: {},
      });
    }
    return createTestConfig(nodes);
  },
};

/**
 * Mock plugin presets for different testing scenarios
 */
export const MockPluginPresets = {
  /**
   * Fast mock plugin (no delay)
   */
  fast: (id: string) => new MockPlugin(id, id, { delay: 0 }),

  /**
   * Slow mock plugin (with delay)
   */
  slow: (id: string, delay: number = 100) => new MockPlugin(id, id, { delay }),

  /**
   * Failing mock plugin
   */
  failing: (id: string) => new MockPlugin(id, id, { shouldFail: true }),

  /**
   * Parallel-enabled mock plugin
   */
  parallel: (id: string, delay: number = 50) => new MockPlugin(id, id, { delay, parallel: true }),

  /**
   * Sequential mock plugin
   */
  sequential: (id: string, delay: number = 50) => new MockPlugin(id, id, { delay, parallel: false }),

  /**
   * Mock plugin with dependencies
   */
  withDeps: (id: string, dependencies: string[], delay: number = 0) =>
    new MockPlugin(id, id, { delay, dependencies }),
};