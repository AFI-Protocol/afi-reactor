/**
 * AFI Reactor - DAG Executor Tests
 *
 * Comprehensive unit tests for the DAGExecutor component.
 *
 * @module afi-reactor/src/langgraph/__tests__/DAGExecutor.test
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { Pipehead, PipelineState } from '../../types/pipeline.js';
import { PluginRegistry } from '../PluginRegistry.js';
import { DAGBuilder, type DAG, type AnalystConfig } from '../DAGBuilder.js';
import { ScoutNode } from '../plugins/ScoutNode.js';
import {
  DAGExecutor,
  type ExecutionResult,
  type ExecutionMetrics,
  type ExecutionStatus,
  type ExecutionContext,
  type NodeExecutionResult,
  type ExecutionOptions,
} from '../DAGExecutor.js';

/**
 * Mock plugin for testing
 */
class MockPlugin implements Pipehead {
  id = 'mock-plugin';
  type = 'enrichment' as const;
  plugin = 'mock-plugin';
  parallel = true;
  dependencies: string[] = [];

  async execute(state: PipelineState): Promise<PipelineState> {
    const startTime = Date.now();
    const startTimeIso = new Date(startTime).toISOString();

    // Create a trace entry for the start of execution
    const traceEntry = {
      nodeId: state.currentNode || this.id,
      nodeType: this.type,
      startTime: startTimeIso,
      status: 'running' as const,
    };

    try {
      // Update trace entry with completion status
      const endTime = Date.now();
      const endTimeIso = new Date(endTime).toISOString();
      const duration = endTime - startTime;

      const completedTraceEntry = {
        ...traceEntry,
        endTime: endTimeIso,
        duration,
        status: 'completed' as const,
      };

      state.metadata.trace.push(completedTraceEntry);

      return state;
    } catch (error) {
      // Update trace entry with failure status
      const endTime = Date.now();
      const endTimeIso = new Date(endTime).toISOString();
      const duration = endTime - startTime;

      const failedTraceEntry = {
        ...traceEntry,
        endTime: endTimeIso,
        duration,
        status: 'failed' as const,
        error: error instanceof Error ? error.message : String(error),
      };

      state.metadata.trace.push(failedTraceEntry);

      throw error;
    }
  }
}

/**
 * Mock ingress plugin for testing
 */
class MockIngressPlugin implements Pipehead {
  id = 'mock-ingress-plugin';
  type = 'ingress' as const;
  plugin = 'mock-ingress-plugin';
  parallel = true;
  dependencies: string[] = [];

  async execute(state: PipelineState): Promise<PipelineState> {
    return state;
  }
}

/**
 * Mock plugin with dependencies for testing
 */
class MockPluginWithDeps implements Pipehead {
  id = 'mock-plugin-with-deps';
  type = 'enrichment' as const;
  plugin = 'mock-plugin-with-deps';
  parallel = false;
  dependencies: string[] = ['mock-plugin'];

  async execute(state: PipelineState): Promise<PipelineState> {
    const startTime = Date.now();
    const startTimeIso = new Date(startTime).toISOString();

    // Create a trace entry for the start of execution
    const traceEntry = {
      nodeId: state.currentNode || this.id,
      nodeType: this.type,
      startTime: startTimeIso,
      status: 'running' as const,
    };

    try {
      // Update trace entry with completion status
      const endTime = Date.now();
      const endTimeIso = new Date(endTime).toISOString();
      const duration = endTime - startTime;

      const completedTraceEntry = {
        ...traceEntry,
        endTime: endTimeIso,
        duration,
        status: 'completed' as const,
      };

      state.metadata.trace.push(completedTraceEntry);

      return state;
    } catch (error) {
      // Update trace entry with failure status
      const endTime = Date.now();
      const endTimeIso = new Date(endTime).toISOString();
      const duration = endTime - startTime;

      const failedTraceEntry = {
        ...traceEntry,
        endTime: endTimeIso,
        duration,
        status: 'failed' as const,
        error: error instanceof Error ? error.message : String(error),
      };

      state.metadata.trace.push(failedTraceEntry);

      throw error;
    }
  }
}

/**
 * Mock plugin that fails for testing
 */
class MockFailingPlugin implements Pipehead {
  id = 'mock-failing-plugin';
  type = 'enrichment' as const;
  plugin = 'mock-failing-plugin';
  parallel = false;
  dependencies: string[] = [];

  async execute(state: PipelineState): Promise<PipelineState> {
    throw new Error('Mock plugin failed');
  }
}

/**
 * Mock plugin that delays for testing
 */
class MockDelayPlugin implements Pipehead {
  id = 'mock-delay-plugin';
  type = 'enrichment' as const;
  plugin = 'mock-delay-plugin';
  parallel = true;
  dependencies: string[] = [];

  constructor(private delay: number = 100) {}

  async execute(state: PipelineState): Promise<PipelineState> {
    await new Promise(resolve => setTimeout(resolve, this.delay));
    return state;
  }
}

/**
 * Mock plugin that modifies state for testing
 */
class MockStateModifyingPlugin implements Pipehead {
  id = 'mock-state-modifying-plugin';
  type = 'enrichment' as const;
  plugin = 'mock-state-modifying-plugin';
  parallel = false;
  dependencies: string[] = [];

  async execute(state: PipelineState): Promise<PipelineState> {
    const key = state.currentNode || this.id;
    state.enrichmentResults.set(key, { modified: true });
    return state;
  }
}

describe('DAGExecutor', () => {
  let registry: PluginRegistry;
  let dagBuilder: DAGBuilder;
  let executor: DAGExecutor;

  beforeEach(() => {
    // Create a fresh registry, DAGBuilder, and DAGExecutor for each test
    registry = new PluginRegistry();
    dagBuilder = new DAGBuilder(registry);
    executor = new DAGExecutor(dagBuilder, registry);
  });

  afterEach(() => {
    // Clean up the registry after each test
    registry.clear();
  });

  describe('Constructor', () => {
    it('should create a new DAGExecutor instance', () => {
      expect(executor).toBeInstanceOf(DAGExecutor);
    });

    it('should store the DAG builder', () => {
      expect(executor.getDAGBuilder()).toBe(dagBuilder);
    });

    it('should store the plugin registry', () => {
      expect(executor.getPluginRegistry()).toBe(registry);
    });

    it('should use default options', () => {
      const options = executor.getDefaultOptions();
      expect(options.timeout).toBe(0);
      expect(options.maxRetries).toBe(0);
      expect(options.retryDelay).toBe(1000);
      expect(options.continueOnError).toBe(true);
      expect(options.failFast).toBe(false);
      expect(options.maxParallelNodes).toBe(0);
      expect(options.trackMemoryUsage).toBe(false);
      expect(options.enableLogging).toBe(false);
      expect(options.executionMode).toBe('adaptive');
    });

    it('should accept custom default options', () => {
      const customExecutor = new DAGExecutor(dagBuilder, registry, {
        timeout: 5000,
        maxRetries: 3,
        enableLogging: true,
      });

      const options = customExecutor.getDefaultOptions();
      expect(options.timeout).toBe(5000);
      expect(options.maxRetries).toBe(3);
      expect(options.enableLogging).toBe(true);
    });
  });

  describe('execute', () => {
    it('should execute a simple DAG successfully', async () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.metrics.nodesExecuted).toBe(1);
      expect(result.metrics.nodesSucceeded).toBe(1);
      expect(result.metrics.nodesFailed).toBe(0);
    });

    it('should execute a DAG with multiple nodes', async () => {
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockIngressPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'ingress',
            plugin: 'mock-ingress-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(true);
      expect(result.metrics.nodesExecuted).toBe(2);
      expect(result.metrics.nodesSucceeded).toBe(2);
    });

    it('should execute a DAG with dependencies', async () => {
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockPluginWithDeps());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin-with-deps',
            enabled: true,
            dependencies: ['node1'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(true);
      expect(result.metrics.nodesExecuted).toBe(2);

      // Check execution order
      const node1Result = result.metrics.nodeResults.get('node1');
      const node2Result = result.metrics.nodeResults.get('node2');
      expect(node1Result).toBeDefined();
      expect(node2Result).toBeDefined();
      expect(node1Result!.startTime).toBeLessThanOrEqual(node2Result!.startTime);
    });

    it('should use initial state if provided', async () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const initialState: PipelineState = {
        signalId: 'test-signal',
        rawSignal: { data: 'test' },
        enrichmentResults: new Map(),
        analystConfig: {
          analystId: 'test-analyst',
          enrichmentNodes: [],
        },
        metadata: {
          startTime: new Date().toISOString(),
          trace: [],
        },
      };

      const result = await executor.execute(buildResult.dag!, initialState);

      expect(result.success).toBe(true);
      expect(result.state?.signalId).toBe('test-signal');
      expect(result.state?.rawSignal).toEqual({ data: 'test' });
    });

    it('should handle execution options', async () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        timeout: 5000,
        maxRetries: 2,
        retryDelay: 500,
        continueOnError: false,
        failFast: true,
      };

      const result = await executor.execute(buildResult.dag!, undefined, options);

      expect(result.success).toBe(true);
    });
  });

  describe('executeSequential', () => {
    it('should execute nodes sequentially', async () => {
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockIngressPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'ingress',
            plugin: 'mock-ingress-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.executeSequential(buildResult.dag!);

      expect(result.success).toBe(true);
      expect(result.metrics.nodesExecuted).toBe(2);

      // Check that nodes were executed sequentially (not in parallel)
      const node1Result = result.metrics.nodeResults.get('node1');
      const node2Result = result.metrics.nodeResults.get('node2');
      expect(node1Result).toBeDefined();
      expect(node2Result).toBeDefined();
      expect(node1Result!.endTime).toBeLessThanOrEqual(node2Result!.startTime);
    });

    it('should execute sequential dependencies correctly', async () => {
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockPluginWithDeps());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin-with-deps',
            enabled: true,
            dependencies: ['node1'],
            config: {},
          },
          {
            id: 'node3',
            type: 'enrichment',
            plugin: 'mock-plugin-with-deps',
            enabled: true,
            dependencies: ['node2'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.executeSequential(buildResult.dag!);

      expect(result.success).toBe(true);
      expect(result.metrics.nodesExecuted).toBe(3);

      // Check execution order
      const node1Result = result.metrics.nodeResults.get('node1');
      const node2Result = result.metrics.nodeResults.get('node2');
      const node3Result = result.metrics.nodeResults.get('node3');

      expect(node1Result!.startTime).toBeLessThanOrEqual(node2Result!.startTime);
      expect(node2Result!.startTime).toBeLessThanOrEqual(node3Result!.startTime);
    });
  });

  describe('executeParallel', () => {
    it('should execute independent nodes in parallel', async () => {
      registry.registerPlugin(new MockDelayPlugin(50));
      registry.registerPlugin(new MockDelayPlugin(50));

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const startTime = Date.now();
      const result = await executor.executeParallel(buildResult.dag!);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.metrics.nodesExecuted).toBe(2);

      // Parallel execution should be faster than sequential
      // Sequential would take ~100ms (50ms + 50ms), parallel should take ~50ms
      const executionTime = endTime - startTime;
      expect(executionTime).toBeLessThan(100);
    });

    it('should execute nodes at same level in parallel', async () => {
      registry.registerPlugin(new MockDelayPlugin(50));
      registry.registerPlugin(new MockDelayPlugin(50));
      registry.registerPlugin(new MockDelayPlugin(50));

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node3',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: ['node1', 'node2'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const startTime = Date.now();
      const result = await executor.executeParallel(buildResult.dag!);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.metrics.nodesExecuted).toBe(3);

      // node1 and node2 should execute in parallel, then node3
      // Total time should be ~100ms (50ms for level 0 + 50ms for level 1)
      const executionTime = endTime - startTime;
      expect(executionTime).toBeLessThan(200);
    });

    it('should respect maxParallelNodes option', async () => {
      registry.registerPlugin(new MockDelayPlugin(50));
      registry.registerPlugin(new MockDelayPlugin(50));
      registry.registerPlugin(new MockDelayPlugin(50));

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node3',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        maxParallelNodes: 2,
      };

      const startTime = Date.now();
      const result = await executor.executeParallel(buildResult.dag!, undefined, options);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.metrics.nodesExecuted).toBe(3);

      // With maxParallelNodes=2, execution should take ~100ms (2 nodes in parallel, then 1)
      const executionTime = endTime - startTime;
      expect(executionTime).toBeLessThan(150);
    });
  });

  describe('Error Handling', () => {
    it('should handle node execution failure', async () => {
      registry.registerPlugin(new MockFailingPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-failing-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.metrics.nodesFailed).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should continue on error when continueOnError is true', async () => {
      registry.registerPlugin(new MockFailingPlugin());
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-failing-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.metrics.nodesExecuted).toBe(2);
      expect(result.metrics.nodesFailed).toBe(1);
      expect(result.metrics.nodesSucceeded).toBe(1);
    });

    it('should stop on error when continueOnError is false', async () => {
      registry.registerPlugin(new MockFailingPlugin());
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-failing-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['node1'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        continueOnError: false,
      };

      const result = await executor.execute(buildResult.dag!, undefined, options);

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.metrics.nodesExecuted).toBe(1);
      expect(result.metrics.nodesFailed).toBe(1);
    });

    it('should handle optional node failure gracefully', async () => {
      registry.registerPlugin(new MockFailingPlugin());
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-failing-plugin',
            enabled: true,
            optional: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(false);
      expect(result.metrics.nodesExecuted).toBe(2);
      expect(result.metrics.nodesFailed).toBe(1);
    });

    it('should handle missing plugin', async () => {
      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'non-existent-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(false);
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed nodes when maxRetries is set', async () => {
      let attemptCount = 0;

      class MockRetryPlugin implements Pipehead {
        id = 'mock-retry-plugin';
        type = 'enrichment' as const;
        plugin = 'mock-retry-plugin';
        parallel = false;
        dependencies: string[] = [];

        async execute(state: PipelineState): Promise<PipelineState> {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error('Temporary failure');
          }
          return state;
        }
      }

      registry.registerPlugin(new MockRetryPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-retry-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        maxRetries: 3,
        retryDelay: 10,
      };

      const result = await executor.execute(buildResult.dag!, undefined, options);

      expect(result.success).toBe(true);
      expect(result.metrics.nodesSucceeded).toBe(1);
      expect(attemptCount).toBe(3);
    });

    it('should fail after max retries exceeded', async () => {
      class MockAlwaysFailingPlugin implements Pipehead {
        id = 'mock-always-failing-plugin';
        type = 'enrichment' as const;
        plugin = 'mock-always-failing-plugin';
        parallel = false;
        dependencies: string[] = [];

        async execute(state: PipelineState): Promise<PipelineState> {
          throw new Error('Always fails');
        }
      }

      registry.registerPlugin(new MockAlwaysFailingPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-always-failing-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        maxRetries: 2,
        retryDelay: 10,
      };

      const result = await executor.execute(buildResult.dag!, undefined, options);

      expect(result.success).toBe(false);
      expect(result.metrics.nodesFailed).toBe(1);

      const nodeResult = result.metrics.nodeResults.get('node1');
      expect(nodeResult?.retries).toBe(2);
    });

    it('should respect retry delay', async () => {
      class MockRetryWithDelayPlugin implements Pipehead {
        id = 'mock-retry-with-delay-plugin';
        type = 'enrichment' as const;
        plugin = 'mock-retry-with-delay-plugin';
        parallel = false;
        dependencies: string[] = [];

        async execute(state: PipelineState): Promise<PipelineState> {
          throw new Error('Always fails');
        }
      }

      registry.registerPlugin(new MockRetryWithDelayPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-retry-with-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        maxRetries: 2,
        retryDelay: 100,
      };

      const startTime = Date.now();
      const result = await executor.execute(buildResult.dag!, undefined, options);
      const endTime = Date.now();

      expect(result.success).toBe(false);

      // Should take at least 200ms (2 retries * 100ms delay)
      const executionTime = endTime - startTime;
      expect(executionTime).toBeGreaterThanOrEqual(200);
    });
  });

  describe('Execution Cancellation', () => {
    it('should cancel a running execution', async () => {
      registry.registerPlugin(new MockDelayPlugin(5000));

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      // Start execution
      const executionPromise = executor.execute(buildResult.dag!);

      const executionId = (executionPromise as any).executionId as string;

      // Wait a bit then cancel
      await new Promise(resolve => setTimeout(resolve, 100));
      await executor.cancelExecution(executionId, 'Test cancellation');

      const result = await executionPromise;

      expect(result.status).toBe('cancelled');
    });

    it('should not cancel completed execution', async () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.status).toBe('completed');

      await expect(executor.cancelExecution(result.executionId)).rejects.toThrow();
    });

    it('should skip remaining nodes after cancellation', async () => {
      registry.registerPlugin(new MockDelayPlugin(5000));
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['node1'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      // Start execution
      const executionPromise = executor.execute(buildResult.dag!);

      const executionId = (executionPromise as any).executionId as string;

      // Wait a bit then cancel
      await new Promise(resolve => setTimeout(resolve, 100));
      await executor.cancelExecution(executionId, 'Test cancellation');

      const result = await executionPromise;

      expect(result.status).toBe('cancelled');
      expect(result.metrics.nodesSkipped).toBeGreaterThan(0);
    });
  });

  describe('Execution Metrics', () => {
    it('should track execution time', async () => {
      registry.registerPlugin(new MockDelayPlugin(100));

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.metrics.totalTime).toBeGreaterThan(0);
      expect(result.metrics.startTime).toBeLessThan(result.metrics.endTime);
    });

    it('should track node execution time', async () => {
      registry.registerPlugin(new MockDelayPlugin(100));

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      const nodeResult = result.metrics.nodeResults.get('node1');
      expect(nodeResult).toBeDefined();
      expect(nodeResult!.duration).toBeGreaterThan(0);
      expect(nodeResult!.startTime).toBeLessThan(nodeResult!.endTime);
    });

    it('should track success/failure counts', async () => {
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockFailingPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-failing-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.metrics.nodesExecuted).toBe(2);
      expect(result.metrics.nodesSucceeded).toBe(1);
      expect(result.metrics.nodesFailed).toBe(1);
    });

    it('should track parallel execution levels', async () => {
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node3',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['node1', 'node2'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.metrics.parallelLevels).toBe(1);
    });

    it('should get execution metrics by ID', async () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      const metrics = executor.getExecutionMetrics(result.executionId);
      expect(metrics).toBeDefined();
      expect(metrics?.executionId).toBe(result.executionId);
    });
  });

  describe('Execution Status', () => {
    it('should get execution status by ID', async () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      const status = executor.getExecutionStatus(result.executionId);
      expect(status).toBe('completed');
    });

    it('should return undefined for non-existent execution', () => {
      const status = executor.getExecutionStatus('non-existent');
      expect(status).toBeUndefined();
    });
  });

  describe('Execution Context', () => {
    it('should get execution context by ID', async () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      const context = executor.getExecutionContext(result.executionId);
      expect(context).toBeDefined();
      expect(context?.executionId).toBe(result.executionId);
    });

    it('should return undefined for non-existent execution', () => {
      const context = executor.getExecutionContext('non-existent');
      expect(context).toBeUndefined();
    });
  });

  describe('Active Executions', () => {
    it('should get active executions', async () => {
      registry.registerPlugin(new MockDelayPlugin(1000));

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      // Start execution
      const executionPromise = executor.execute(buildResult.dag!);

      // Get active executions
      const activeExecutions = executor.getActiveExecutions();
      expect(activeExecutions.size).toBeGreaterThan(0);

      // Wait for completion
      await executionPromise;
    });

    it('should not include completed executions in active list', async () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      await executor.execute(buildResult.dag!);

      const activeExecutions = executor.getActiveExecutions();
      expect(activeExecutions.size).toBe(0);
    });
  });

  describe('Clear Completed Executions', () => {
    it('should clear completed executions', async () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      // Verify execution exists
      expect(executor.getExecutionStatus(result.executionId)).toBe('completed');

      // Clear completed executions
      executor.clearCompletedExecutions();

      // Verify execution is cleared
      expect(executor.getExecutionStatus(result.executionId)).toBeUndefined();
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout execution after specified time', async () => {
      registry.registerPlugin(new MockDelayPlugin(5000));

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-delay-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        timeout: 100,
      };

      const startTime = Date.now();
      const result = await executor.execute(buildResult.dag!, undefined, options);
      const endTime = Date.now();

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.includes('timeout'))).toBe(true);

      // Should timeout in approximately 100ms
      const executionTime = endTime - startTime;
      expect(executionTime).toBeLessThan(500);
    });
  });

  describe('Fail Fast', () => {
    it('should stop execution on first error when failFast is true', async () => {
      registry.registerPlugin(new MockFailingPlugin());
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-failing-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        failFast: true,
      };

      const result = await executor.execute(buildResult.dag!, undefined, options);

      expect(result.success).toBe(false);
      expect(result.metrics.nodesExecuted).toBe(1);
    });
  });

  describe('State Management', () => {
    it('should propagate state changes through nodes', async () => {
      registry.registerPlugin(new MockStateModifyingPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-state-modifying-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(true);
      expect(result.state?.enrichmentResults.has('node1')).toBe(true);
    });

    it('should maintain state across sequential nodes', async () => {
      registry.registerPlugin(new MockStateModifyingPlugin());
      registry.registerPlugin(new MockStateModifyingPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-state-modifying-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-state-modifying-plugin',
            enabled: true,
            dependencies: ['node1'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(true);
      expect(result.state?.enrichmentResults.size).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty DAG', async () => {
      const dag: DAG = {
        nodes: new Map(),
        edges: [],
        requiredNodes: [],
        analystId: 'test-analyst',
      };

      const result = await executor.execute(dag);

      expect(result.success).toBe(true);
      expect(result.metrics.nodesExecuted).toBe(0);
    });

    it('should handle single node DAG', async () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(true);
      expect(result.metrics.nodesExecuted).toBe(1);
    });

    it('should handle DAG with all optional nodes', async () => {
      registry.registerPlugin(new MockFailingPlugin());
      registry.registerPlugin(new MockFailingPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-failing-plugin',
            enabled: true,
            optional: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-failing-plugin',
            enabled: true,
            optional: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(false);
      expect(result.metrics.nodesExecuted).toBe(2);
      expect(result.metrics.nodesFailed).toBe(2);
    });
  });

  describe('Integration with DAGBuilder', () => {
    it('should use DAGBuilder for execution levels', async () => {
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node3',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['node1', 'node2'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const levels = dagBuilder.getExecutionLevels(buildResult.dag!);
      expect(levels).toHaveLength(2);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(true);
      expect(result.metrics.parallelLevels).toBe(1);
    });
  });

  describe('Integration with PluginRegistry', () => {
    it('should use PluginRegistry to retrieve node implementations', async () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(true);
    });

    it('should work with initialized registry', async () => {
      registry.initialize();

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'technical-indicators',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(true);
    });
  });

  describe('Logging', () => {
    it('should log messages when enableLogging is true', async () => {
      const logs: string[] = [];

      const logger = (message: string) => {
        logs.push(message);
      };

      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        enableLogging: true,
        logger,
      };

      const result = await executor.execute(buildResult.dag!, undefined, options);

      expect(result.success).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some(log => log.includes('Starting execution'))).toBe(true);
    });
  });

  describe('Scout Node Execution', () => {
    it('should execute Scout nodes before enrichment nodes', async () => {
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new ScoutNode());
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'scout',
            type: 'ingress',
            plugin: 'scout',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'technical-indicators',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      // Verify Scout executed before enrichment
      const scoutTrace = result.state?.metadata.trace.find(t => t.nodeId === 'scout');
      const enrichmentTrace = result.state?.metadata.trace.find(t => t.nodeId === 'technical-indicators');

      expect(scoutTrace).toBeDefined();
      expect(enrichmentTrace).toBeDefined();
      expect(scoutTrace!.startTime < enrichmentTrace!.startTime).toBe(true);
    });

    it('should execute multiple Scout nodes in parallel', async () => {
      registry.registerPlugin(new ScoutNode());
      registry.registerPlugin(new ScoutNode());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'scout-1',
            type: 'ingress',
            plugin: 'scout-1',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'scout-2',
            type: 'ingress',
            plugin: 'scout-2',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'technical-indicators',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      // Register multiple ScoutNode instances with different IDs
      const scout1 = new ScoutNode();
      scout1.id = 'scout-1';
      const scout2 = new ScoutNode();
      scout2.id = 'scout-2';

      registry.registerPlugin(scout1);
      registry.registerPlugin(scout2);
      registry.registerPlugin(new MockPlugin());

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      // Verify both Scouts executed
      const scout1Trace = result.state?.metadata.trace.find(t => t.nodeId === 'scout-1');
      const scout2Trace = result.state?.metadata.trace.find(t => t.nodeId === 'scout-2');

      expect(scout1Trace).toBeDefined();
      expect(scout2Trace).toBeDefined();
      expect(result.metrics.nodesExecuted).toBe(3);
      expect(result.metrics.nodesSucceeded).toBe(3);
    });

    it('should track Scout submissions for reward attribution', async () => {
      registry.registerPlugin(new ScoutNode());
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'scout',
            type: 'ingress',
            plugin: 'scout',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'technical-indicators',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      // Verify Scout submissions are tracked
      const scoutResult = result.state?.enrichmentResults.get('scout');
      expect(scoutResult).toBeDefined();
      expect(scoutResult).toHaveProperty('scoutId', 'scout:afi-native:v1');
    });

    it('should execute Scout nodes with no dependencies', async () => {
      registry.registerPlugin(new ScoutNode());
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'scout',
            type: 'ingress',
            plugin: 'scout',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'technical-indicators',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const result = await executor.execute(buildResult.dag!);

      expect(result.success).toBe(true);
      expect(result.metrics.nodesExecuted).toBe(2);
      expect(result.metrics.nodesSucceeded).toBe(2);
    });

    it('should log Scout node execution', async () => {
      const logs: string[] = [];

      const logger = (message: string) => {
        logs.push(message);
      };

      registry.registerPlugin(new ScoutNode());
      registry.registerPlugin(new MockPlugin());
      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'scout',
            type: 'ingress',
            plugin: 'scout',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'technical-indicators',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        enableLogging: true,
        logger,
      };

      const result = await executor.execute(buildResult.dag!, undefined, options);

      expect(result.success).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('Default Options Management', () => {
    it('should set default options', () => {
      executor.setDefaultOptions({
        timeout: 10000,
        maxRetries: 5,
        enableLogging: true,
      });

      const options = executor.getDefaultOptions();
      expect(options.timeout).toBe(10000);
      expect(options.maxRetries).toBe(5);
      expect(options.enableLogging).toBe(true);
    });

    it('should merge default options with execution options', async () => {
      executor.setDefaultOptions({
        timeout: 5000,
        maxRetries: 2,
      });

      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      expect(buildResult.success).toBe(true);

      const options: ExecutionOptions = {
        enableLogging: true,
      };

      const result = await executor.execute(buildResult.dag!, undefined, options);

      expect(result.success).toBe(true);
    });
  });
});
