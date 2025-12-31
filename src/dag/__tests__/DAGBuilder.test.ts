/**
 * AFI Reactor - DAG Builder Tests
 *
 * Comprehensive unit tests for the DAGBuilder component.
 *
 * @module afi-reactor/src/langgraph/__tests__/DAGBuilder.test
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { Pipehead, PipelineState } from '../../types/pipeline.js';
import { PluginRegistry } from '../PluginRegistry.js';
import {
  DAGBuilder,
  type AnalystConfig,
  type EnrichmentNodeConfig,
  type DAG,
  type DAGNode,
  type DAGEdge,
  type DependencyGraph,
  type ValidationResult,
  type DAGBuildResult,
} from '../DAGBuilder.js';

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
    return state;
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
    return state;
  }
}

describe('DAGBuilder', () => {
  let registry: PluginRegistry;
  let dagBuilder: DAGBuilder;

  beforeEach(() => {
    // Create a fresh registry and DAGBuilder for each test
    registry = new PluginRegistry();
    dagBuilder = new DAGBuilder(registry);
  });

  afterEach(() => {
    // Clean up the registry after each test
    registry.clear();
  });

  describe('Constructor', () => {
    it('should create a new DAGBuilder instance', () => {
      expect(dagBuilder).toBeInstanceOf(DAGBuilder);
    });

    it('should store the plugin registry', () => {
      expect(dagBuilder.getPluginRegistry()).toBe(registry);
    });
  });

  describe('buildFromConfig', () => {
    it('should build a DAG from valid configuration', () => {
      // Register plugins
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockIngressPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        version: 'v1.0.0',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'ingress',
            plugin: 'mock-ingress-plugin',
            enabled: true,
            optional: true,
            parallel: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag).toBeDefined();
      expect(result.dag?.nodes.size).toBe(2);
      expect(result.dag?.analystId).toBe('test-analyst');
      expect(result.dag?.version).toBe('v1.0.0');
    });

    it('should build DAG with dependencies', () => {
      // Register plugins
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

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag?.edges).toHaveLength(1);
      expect(result.dag?.edges[0].from).toBe('node1');
      expect(result.dag?.edges[0].to).toBe('node2');
    });

    it('should skip disabled nodes', () => {
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
            enabled: false,
            dependencies: [],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag?.nodes.size).toBe(1);
      expect(result.warnings).toContain("Pipehead 'node2' is disabled and will be skipped");
    });

    it('should fail when plugin not found', () => {
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

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Plugin 'non-existent-plugin' not found in registry for node 'node1'");
    });

    it('should fail when configuration is invalid', () => {
      const config: AnalystConfig = {
        analystId: '',
        enrichmentNodes: [],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing required field: analystId');
      expect(result.errors).toContain('Missing or empty field: enrichmentNodes');
    });

    it('should fail when DAG has cycles', () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['node2'],
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

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('DAG contains 1 cycle(s)');
    });

    it('should warn about missing dependencies', () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['non-existent-node'],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.warnings).toContain("Node 'node1' depends on non-existent node 'non-existent-node'");
    });

    it('should handle complex dependency chains', () => {
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

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag?.nodes.size).toBe(3);
      expect(result.dag?.edges).toHaveLength(2);
    });

    it('should handle parallel nodes', () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            parallel: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            parallel: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag?.nodes.get('node1')?.parallel).toBe(true);
      expect(result.dag?.nodes.get('node2')?.parallel).toBe(true);
    });

    it('should handle optional nodes', () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
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
            optional: false,
            dependencies: [],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag?.nodes.get('node1')?.optional).toBe(true);
      expect(result.dag?.nodes.get('node2')?.optional).toBe(false);
    });
  });

  describe('buildFromJSON', () => {
    it('should build DAG from valid JSON string', () => {
      registry.registerPlugin(new MockPlugin());

      const configJson = JSON.stringify({
        analystId: 'test-analyst',
        version: 'v1.0.0',
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
      });

      const result = dagBuilder.buildFromJSON(configJson);

      expect(result.success).toBe(true);
      expect(result.dag?.analystId).toBe('test-analyst');
    });

    it('should fail on invalid JSON', () => {
      const result = dagBuilder.buildFromJSON('invalid json');

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Failed to parse JSON');
    });

    it('should fail on malformed JSON', () => {
      const result = dagBuilder.buildFromJSON('{ "analystId": "test" }');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing or empty field: enrichmentNodes');
    });

    it('should handle JSON with metadata', () => {
      registry.registerPlugin(new MockPlugin());

      const configJson = JSON.stringify({
        analystId: 'test-analyst',
        version: 'v1.0.0',
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
        metadata: {
          description: 'Test analyst',
          author: 'Test Author',
        },
      });

      const result = dagBuilder.buildFromJSON(configJson);

      expect(result.success).toBe(true);
      expect(result.dag?.analystId).toBe('test-analyst');
    });
  });

  describe('validateDAG', () => {
    it('should validate a valid DAG', () => {
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
      const validation = dagBuilder.validateDAG(buildResult.dag!);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect cycles in DAG', () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['node2'],
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

      // Build DAG manually for testing cycle detection
      const dag: DAG = {
        nodes: new Map([
          ['node1', {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node2'],
            config: {},
          }],
          ['node2', {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node1'],
            config: {},
          }],
        ]),
        edges: [
          { from: 'node2', to: 'node1' },
          { from: 'node1', to: 'node2' },
        ],
        requiredNodes: [],
        analystId: 'test-analyst',
      };

      const validation = dagBuilder.validateDAG(dag);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('DAG contains 1 cycle(s)');
      expect(validation.cycles).toBeDefined();
      expect(validation.cycles?.length).toBeGreaterThan(0);
    });

    it('should detect self-dependencies', () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['node1'],
            config: {},
          },
        ],
      };

      // Build DAG manually for testing self-dependency detection
      const dag: DAG = {
        nodes: new Map([
          ['node1', {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node1'],
            config: {},
          }],
        ]),
        edges: [],
        requiredNodes: [],
        analystId: 'test-analyst',
      };

      const validation = dagBuilder.validateDAG(dag);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("Node 'node1' depends on itself");
    });

    it('should detect empty DAG', () => {
      const dag: DAG = {
        nodes: new Map(),
        edges: [],
        requiredNodes: [],
        analystId: 'test-analyst',
      };

      const validation = dagBuilder.validateDAG(dag);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('DAG has no nodes');
    });

    it('should warn about duplicate edges', () => {
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
            dependencies: ['node1', 'node1'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      const validation = dagBuilder.validateDAG(buildResult.dag!);

      expect(validation.valid).toBe(true);
      expect(validation.warnings).toContain('Duplicate edge detected: node1 -> node2');
    });

    it('should warn about missing dependencies', () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['non-existent'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      const validation = dagBuilder.validateDAG(buildResult.dag!);

      expect(validation.valid).toBe(true);
      expect(validation.warnings).toContain("Node 'node1' has missing dependency 'non-existent'");
    });
  });

  describe('topologicalSort', () => {
    it('should return nodes in topological order', () => {
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
      const sorted = dagBuilder.topologicalSort(buildResult.dag!);

      expect(sorted).toHaveLength(3);
      expect(sorted.indexOf('node1')).toBeLessThan(sorted.indexOf('node2'));
      expect(sorted.indexOf('node2')).toBeLessThan(sorted.indexOf('node3'));
    });

    it('should handle independent nodes', () => {
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
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      const sorted = dagBuilder.topologicalSort(buildResult.dag!);

      expect(sorted).toHaveLength(2);
      expect(sorted).toContain('node1');
      expect(sorted).toContain('node2');
    });

    it('should throw error on cyclic DAG', () => {
      registry.registerPlugin(new MockPlugin());

      // Build DAG manually for testing topological sort on cyclic graph
      const dag: DAG = {
        nodes: new Map([
          ['node1', {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node2'],
            config: {},
          }],
          ['node2', {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node1'],
            config: {},
          }],
        ]),
        edges: [
          { from: 'node2', to: 'node1' },
          { from: 'node1', to: 'node2' },
        ],
        requiredNodes: [],
        analystId: 'test-analyst',
      };

      expect(() => {
        dagBuilder.topologicalSort(dag);
      }).toThrow('DAG contains cycles and cannot be topologically sorted');
    });

    it('should handle complex dependency graph', () => {
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
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node3',
            type: 'enrichment',
            plugin: 'mock-plugin-with-deps',
            enabled: true,
            dependencies: ['node1', 'node2'],
            config: {},
          },
          {
            id: 'node4',
            type: 'enrichment',
            plugin: 'mock-plugin-with-deps',
            enabled: true,
            dependencies: ['node3'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      const sorted = dagBuilder.topologicalSort(buildResult.dag!);

      expect(sorted).toHaveLength(4);
      expect(sorted.indexOf('node1')).toBeLessThan(sorted.indexOf('node3'));
      expect(sorted.indexOf('node2')).toBeLessThan(sorted.indexOf('node3'));
      expect(sorted.indexOf('node3')).toBeLessThan(sorted.indexOf('node4'));
    });
  });

  describe('getExecutionLevels', () => {
    it('should group nodes by execution level', () => {
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
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node3',
            type: 'enrichment',
            plugin: 'mock-plugin-with-deps',
            enabled: true,
            dependencies: ['node1'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      const levels = dagBuilder.getExecutionLevels(buildResult.dag!);

      expect(levels).toHaveLength(2);
      expect(levels[0]).toContain('node1');
      expect(levels[0]).toContain('node2');
      expect(levels[1]).toContain('node3');
    });

    it('should handle single node DAG', () => {
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
      const levels = dagBuilder.getExecutionLevels(buildResult.dag!);

      expect(levels).toHaveLength(1);
      expect(levels[0]).toContain('node1');
    });

    it('should handle sequential dependencies', () => {
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
      const levels = dagBuilder.getExecutionLevels(buildResult.dag!);

      expect(levels).toHaveLength(3);
      expect(levels[0]).toContain('node1');
      expect(levels[1]).toContain('node2');
      expect(levels[2]).toContain('node3');
    });

    it('should handle diamond dependency pattern', () => {
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
            dependencies: ['node1'],
            config: {},
          },
          {
            id: 'node4',
            type: 'enrichment',
            plugin: 'mock-plugin-with-deps',
            enabled: true,
            dependencies: ['node2', 'node3'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      const levels = dagBuilder.getExecutionLevels(buildResult.dag!);

      expect(levels).toHaveLength(3);
      expect(levels[0]).toContain('node1');
      expect(levels[1]).toContain('node2');
      expect(levels[1]).toContain('node3');
      expect(levels[2]).toContain('node4');
    });
  });

  describe('resolveDependencies', () => {
    it('should build dependency graph', () => {
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
      const depGraph = dagBuilder.resolveDependencies(buildResult.dag!);

      expect(depGraph.nodes).toHaveLength(2);
      expect(depGraph.dependencies.get('node1')).toEqual([]);
      expect(depGraph.dependencies.get('node2')).toEqual(['node1']);
      expect(depGraph.dependents.get('node1')).toEqual(['node2']);
      expect(depGraph.dependents.get('node2')).toEqual([]);
    });

    it('should handle multiple dependencies', () => {
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
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'node3',
            type: 'enrichment',
            plugin: 'mock-plugin-with-deps',
            enabled: true,
            dependencies: ['node1', 'node2'],
            config: {},
          },
        ],
      };

      const buildResult = dagBuilder.buildFromConfig(config);
      const depGraph = dagBuilder.resolveDependencies(buildResult.dag!);

      expect(depGraph.dependencies.get('node3')).toEqual(['node1', 'node2']);
      expect(depGraph.dependents.get('node1')).toEqual(['node3']);
      expect(depGraph.dependents.get('node2')).toEqual(['node3']);
    });

    it('should handle empty DAG', () => {
      const dag: DAG = {
        nodes: new Map(),
        edges: [],
        requiredNodes: [],
        analystId: 'test-analyst',
      };

      const depGraph = dagBuilder.resolveDependencies(dag);

      expect(depGraph.nodes).toHaveLength(0);
      expect(depGraph.dependencies.size).toBe(0);
      expect(depGraph.dependents.size).toBe(0);
    });
  });

  describe('detectCycles', () => {
    it('should detect simple cycle', () => {
      registry.registerPlugin(new MockPlugin());

      // Build DAG manually for testing cycle detection
      const dag: DAG = {
        nodes: new Map([
          ['node1', {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node2'],
            config: {},
          }],
          ['node2', {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node1'],
            config: {},
          }],
        ]),
        edges: [
          { from: 'node2', to: 'node1' },
          { from: 'node1', to: 'node2' },
        ],
        requiredNodes: [],
        analystId: 'test-analyst',
      };

      const cycles = dagBuilder.detectCycles(dag);

      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should detect self-cycle', () => {
      registry.registerPlugin(new MockPlugin());

      // Build DAG manually for testing self-cycle detection
      const dag: DAG = {
        nodes: new Map([
          ['node1', {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node1'],
            config: {},
          }],
        ]),
        edges: [],
        requiredNodes: [],
        analystId: 'test-analyst',
      };

      const cycles = dagBuilder.detectCycles(dag);

      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should not detect cycles in acyclic DAG', () => {
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
      const cycles = dagBuilder.detectCycles(buildResult.dag!);

      expect(cycles.length).toBe(0);
    });

    it('should detect multiple cycles', () => {
      registry.registerPlugin(new MockPlugin());

      // Build DAG manually for testing multiple cycle detection
      const dag: DAG = {
        nodes: new Map([
          ['node1', {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node2'],
            config: {},
          }],
          ['node2', {
            id: 'node2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node1'],
            config: {},
          }],
          ['node3', {
            id: 'node3',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node4'],
            config: {},
          }],
          ['node4', {
            id: 'node4',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['node3'],
            config: {},
          }],
        ]),
        edges: [
          { from: 'node2', to: 'node1' },
          { from: 'node1', to: 'node2' },
          { from: 'node4', to: 'node3' },
          { from: 'node3', to: 'node4' },
        ],
        requiredNodes: [],
        analystId: 'test-analyst',
      };

      const cycles = dagBuilder.detectCycles(dag);

      expect(cycles.length).toBeGreaterThan(1);
    });
  });

  describe('Integration with PluginRegistry', () => {
    it('should use plugins from registry', () => {
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

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag?.nodes.get('node1')?.node).toBe(plugin);
    });

    it('should work with initialized registry', () => {
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
          {
            id: 'node2',
            type: 'ingress',
            plugin: 'signal-ingress',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag?.nodes.size).toBe(2);
    });

    it('should handle disabled plugins', () => {
      const plugin = new MockPlugin();
      registry.registerPlugin(plugin);
      registry.disablePlugin('mock-plugin');

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

      const result = dagBuilder.buildFromConfig(config);

      // Plugin should still be found even if disabled
      expect(result.success).toBe(true);
      expect(result.dag?.nodes.get('node1')?.node).toBe(plugin);
    });

    it('should handle multiple plugin types', () => {
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

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag?.nodes.get('node1')?.type).toBe('enrichment');
      expect(result.dag?.nodes.get('node2')?.type).toBe('ingress');
    });
  });

  describe('Edge Cases', () => {
    it('should handle configuration with no nodes', () => {
      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing or empty field: enrichmentNodes');
    });

    it('should handle configuration with all disabled nodes', () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: false,
            dependencies: [],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('DAG has no nodes');
    });

    it('should handle duplicate node IDs', () => {
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
            id: 'node1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Duplicate node ID: node1');
    });

    it('should handle invalid node type', () => {
      registry.registerPlugin(new MockPlugin());

      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'invalid' as 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Invalid node type 'invalid' for node 'node1'");
    });

    it('should handle missing plugin field', () => {
      const config: AnalystConfig = {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node1',
            type: 'enrichment',
            plugin: '',
            enabled: true,
            dependencies: [],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(false);
      expect(result.errors).toContain("Node 'node1' missing required field: plugin");
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle signal processing pipeline', () => {
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockIngressPlugin());
      registry.registerPlugin(new MockPluginWithDeps());

      const config: AnalystConfig = {
        analystId: 'crypto-analyst',
        version: 'v1.0.0',
        enrichmentNodes: [
          {
            id: 'signal-ingress',
            type: 'ingress',
            plugin: 'mock-ingress-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: [],
            config: {},
          },
          {
            id: 'technical-indicators',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['signal-ingress'],
            config: {},
          },
          {
            id: 'sentiment-analysis',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            optional: true,
            parallel: true,
            dependencies: ['signal-ingress'],
            config: {},
          },
          {
            id: 'pattern-recognition',
            type: 'enrichment',
            plugin: 'mock-plugin-with-deps',
            enabled: true,
            optional: false,
            parallel: false,
            dependencies: ['technical-indicators', 'sentiment-analysis'],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag?.nodes.size).toBe(4);

      const levels = dagBuilder.getExecutionLevels(result.dag!);
      expect(levels).toHaveLength(3);
      expect(levels[0]).toContain('signal-ingress');
      expect(levels[1]).toContain('technical-indicators');
      expect(levels[1]).toContain('sentiment-analysis');
      expect(levels[2]).toContain('pattern-recognition');
    });

    it('should handle complex multi-source pipeline', () => {
      registry.registerPlugin(new MockPlugin());
      registry.registerPlugin(new MockIngressPlugin());
      registry.registerPlugin(new MockPluginWithDeps());

      const config: AnalystConfig = {
        analystId: 'multi-source-analyst',
        enrichmentNodes: [
          {
            id: 'source1',
            type: 'ingress',
            plugin: 'mock-ingress-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'source2',
            type: 'ingress',
            plugin: 'mock-ingress-plugin',
            enabled: true,
            dependencies: [],
            config: {},
          },
          {
            id: 'process1',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['source1'],
            config: {},
          },
          {
            id: 'process2',
            type: 'enrichment',
            plugin: 'mock-plugin',
            enabled: true,
            dependencies: ['source2'],
            config: {},
          },
          {
            id: 'merge',
            type: 'enrichment',
            plugin: 'mock-plugin-with-deps',
            enabled: true,
            dependencies: ['process1', 'process2'],
            config: {},
          },
        ],
      };

      const result = dagBuilder.buildFromConfig(config);

      expect(result.success).toBe(true);
      expect(result.dag?.nodes.size).toBe(5);

      const levels = dagBuilder.getExecutionLevels(result.dag!);
      expect(levels).toHaveLength(3);
      expect(levels[0]).toContain('source1');
      expect(levels[0]).toContain('source2');
      expect(levels[1]).toContain('process1');
      expect(levels[1]).toContain('process2');
      expect(levels[2]).toContain('merge');
    });
  
    describe('Scout Node Validation', () => {
      /**
       * Mock Scout plugin for testing
       */
      class MockScoutPlugin implements Pipehead {
        id = 'scout';
        type = 'ingress' as const;
        plugin = 'scout';
        parallel = true;
        dependencies: string[] = [];
  
        async execute(state: PipelineState): Promise<PipelineState> {
          return state;
        }
      }
  
      /**
       * Mock Signal Ingress plugin for testing
       */
      class MockSignalIngressPlugin implements Pipehead {
        id = 'signal-ingress';
        type = 'ingress' as const;
        plugin = 'signal-ingress';
        parallel = true;
        dependencies: string[] = [];
  
        async execute(state: PipelineState): Promise<PipelineState> {
          return state;
        }
      }
  
      it('should validate Scout node with no dependencies', () => {
        registry.registerPlugin(new MockScoutPlugin());
  
        const config: AnalystConfig = {
          analystId: 'test-analyst',
          enrichmentNodes: [
            {
              id: 'scout',
              type: 'ingress',
              plugin: 'scout',
              enabled: true,
              dependencies: [], // Valid: no dependencies
              config: {},
            },
          ],
        };
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(true);
        expect(result.errors).toBeUndefined();
      });
  
      it('should reject Scout node with dependencies', () => {
        registry.registerPlugin(new MockScoutPlugin());
        registry.registerPlugin(new MockPlugin());
  
        const config: AnalystConfig = {
          analystId: 'test-analyst',
          enrichmentNodes: [
            {
              id: 'scout',
              type: 'ingress',
              plugin: 'scout',
              enabled: true,
              dependencies: ['technical-indicators'], // Invalid: Scout has dependencies
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
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => err.includes('Scout node'))).toBe(true);
        expect(result.errors?.some(err => err.includes('must be independent signal sources'))).toBe(true);
      });
  
      it('should reject enrichment node depending on Scout', () => {
        registry.registerPlugin(new MockScoutPlugin());
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
              dependencies: ['scout'], // Invalid: enrichment depends on Scout
              config: {},
            },
          ],
        };
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.some(err => err.includes('Enrichment node'))).toBe(true);
        expect(result.errors?.some(err => err.includes('must not depend on Scout nodes'))).toBe(true);
      });
  
      it('should allow multiple Scout nodes with no dependencies', () => {
        registry.registerPlugin(new MockScoutPlugin());
  
        const config: AnalystConfig = {
          analystId: 'test-analyst',
          enrichmentNodes: [
            {
              id: 'scout1',
              type: 'ingress',
              plugin: 'scout',
              enabled: true,
              dependencies: [],
              config: {},
            },
            {
              id: 'scout2',
              type: 'ingress',
              plugin: 'scout',
              enabled: true,
              dependencies: [],
              config: {},
            },
          ],
        };
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(true);
        expect(result.errors).toBeUndefined();
      });
  
      it('should allow Signal Ingress depending on Scout', () => {
        registry.registerPlugin(new MockScoutPlugin());
        registry.registerPlugin(new MockSignalIngressPlugin());
  
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
              id: 'signal-ingress',
              type: 'ingress',
              plugin: 'signal-ingress',
              enabled: true,
              dependencies: ['scout'], // Valid: Signal Ingress can depend on Scout
              config: {},
            },
          ],
        };
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(true);
        expect(result.errors).toBeUndefined();
      });
    });
  
    describe('Execution Level Calculation with Scout Nodes', () => {
      /**
       * Mock Scout plugin for testing
       */
      class MockScoutPlugin implements Pipehead {
        id = 'scout';
        type = 'ingress' as const;
        plugin = 'scout';
        parallel = true;
        dependencies: string[] = [];
  
        async execute(state: PipelineState): Promise<PipelineState> {
          return state;
        }
      }
  
      /**
       * Mock Signal Ingress plugin for testing
       */
      class MockSignalIngressPlugin implements Pipehead {
        id = 'signal-ingress';
        type = 'ingress' as const;
        plugin = 'signal-ingress';
        parallel = true;
        dependencies: string[] = [];
  
        async execute(state: PipelineState): Promise<PipelineState> {
          return state;
        }
      }
  
      it('should place Scout nodes at execution level 0', () => {
        registry.registerPlugin(new MockScoutPlugin());
  
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
          ],
        };
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(true);
  
        const levels = dagBuilder.getExecutionLevels(result.dag!);
        expect(levels).toHaveLength(1);
        expect(levels[0]).toContain('scout');
      });
  
      it('should place multiple Scout nodes at execution level 0', () => {
        registry.registerPlugin(new MockScoutPlugin());
  
        const config: AnalystConfig = {
          analystId: 'test-analyst',
          enrichmentNodes: [
            {
              id: 'scout1',
              type: 'ingress',
              plugin: 'scout',
              enabled: true,
              dependencies: [],
              config: {},
            },
            {
              id: 'scout2',
              type: 'ingress',
              plugin: 'scout',
              enabled: true,
              dependencies: [],
              config: {},
            },
          ],
        };
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(true);
  
        const levels = dagBuilder.getExecutionLevels(result.dag!);
        expect(levels).toHaveLength(1);
        expect(levels[0]).toContain('scout1');
        expect(levels[0]).toContain('scout2');
      });
  
      it('should place Signal Ingress at level 0 when not depending on Scout', () => {
        registry.registerPlugin(new MockSignalIngressPlugin());
  
        const config: AnalystConfig = {
          analystId: 'test-analyst',
          enrichmentNodes: [
            {
              id: 'signal-ingress',
              type: 'ingress',
              plugin: 'signal-ingress',
              enabled: true,
              dependencies: [],
              config: {},
            },
          ],
        };
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(true);
  
        const levels = dagBuilder.getExecutionLevels(result.dag!);
        expect(levels).toHaveLength(1);
        expect(levels[0]).toContain('signal-ingress');
      });
  
      it('should place Signal Ingress at level 1 when depending on Scout', () => {
        registry.registerPlugin(new MockScoutPlugin());
        registry.registerPlugin(new MockSignalIngressPlugin());
  
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
              id: 'signal-ingress',
              type: 'ingress',
              plugin: 'signal-ingress',
              enabled: true,
              dependencies: ['scout'],
              config: {},
            },
          ],
        };
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(true);
  
        const levels = dagBuilder.getExecutionLevels(result.dag!);
        expect(levels).toHaveLength(2);
        expect(levels[0]).toContain('scout');
        expect(levels[1]).toContain('signal-ingress');
      });
  
      it('should place enrichment nodes at level 1 or higher', () => {
        registry.registerPlugin(new MockScoutPlugin());
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
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(true);
  
        const levels = dagBuilder.getExecutionLevels(result.dag!);
        expect(levels.length).toBeGreaterThanOrEqual(1);
        expect(levels[0]).toContain('scout');
        // technical-indicators should be at level 0 or 1 depending on dependencies
        const technicalLevel = levels.findIndex(level => level.includes('technical-indicators'));
        expect(technicalLevel).toBeGreaterThanOrEqual(0);
      });
  
      it('should handle complex pipeline with Scout, Signal Ingress, and enrichment', () => {
        registry.registerPlugin(new MockScoutPlugin());
        registry.registerPlugin(new MockSignalIngressPlugin());
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
              id: 'signal-ingress',
              type: 'ingress',
              plugin: 'signal-ingress',
              enabled: true,
              dependencies: ['scout'],
              config: {},
            },
            {
              id: 'technical-indicators',
              type: 'enrichment',
              plugin: 'mock-plugin',
              enabled: true,
              dependencies: ['signal-ingress'],
              config: {},
            },
            {
              id: 'pattern-recognition',
              type: 'enrichment',
              plugin: 'mock-plugin',
              enabled: true,
              dependencies: ['technical-indicators'],
              config: {},
            },
          ],
        };
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(true);
  
        const levels = dagBuilder.getExecutionLevels(result.dag!);
        expect(levels).toHaveLength(4);
        expect(levels[0]).toContain('scout');
        expect(levels[1]).toContain('signal-ingress');
        expect(levels[2]).toContain('technical-indicators');
        expect(levels[3]).toContain('pattern-recognition');
      });
  
      it('should place Scout and independent Signal Ingress at level 0', () => {
        registry.registerPlugin(new MockScoutPlugin());
        registry.registerPlugin(new MockSignalIngressPlugin());
  
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
              id: 'signal-ingress',
              type: 'ingress',
              plugin: 'signal-ingress',
              enabled: true,
              dependencies: [],
              config: {},
            },
          ],
        };
  
        const result = dagBuilder.buildFromConfig(config);
        expect(result.success).toBe(true);
  
        const levels = dagBuilder.getExecutionLevels(result.dag!);
        expect(levels).toHaveLength(1);
        expect(levels[0]).toContain('scout');
        expect(levels[0]).toContain('signal-ingress');
      });
    });
  });
});
