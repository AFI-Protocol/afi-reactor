/**
 * AFI Reactor - DAG Builder
 *
 * This module provides the DAGBuilder component for constructing Directed Acyclic Graphs (DAGs)
 * from analyst configurations. The DAGBuilder handles:
 * - DAG construction from analyst configuration files
 * - Dependency resolution between nodes
 * - Topological sorting to determine execution order
 * - DAG structure validation (no cycles, all dependencies satisfied)
 * - Support for sequential and parallel execution patterns
 * - Integration with the PluginRegistry to retrieve node implementations
 *
 * @module afi-reactor/src/dag/DAGBuilder
 */

import type { Pipehead } from '../types/dag.js';
import { PluginRegistry } from './PluginRegistry.js';
import { AiMlNode } from './plugins/AiMlNode.js';

/**
 * Analyst configuration interface
 *
 * Defines the structure of an analyst configuration used to build a DAG.
 */
export interface AnalystConfig {
  /** Unique identifier for the analyst */
  analystId: string;

  /** Semantic version of the analyst configuration */
  version?: string;

  /** Array of enrichment nodes that define the processing pipeline */
  enrichmentNodes: EnrichmentNodeConfig[];

  /** Optional metadata about the analyst configuration */
  metadata?: Record<string, unknown>;
}

/**
 * Enrichment node configuration interface
 *
 * Defines the structure of an enrichment node configuration.
 */
export interface EnrichmentNodeConfig {
  /** Unique identifier for the enrichment node */
  id: string;

  /** Type of enrichment node */
  type: 'enrichment' | 'ingress';

  /** Identifier of the plugin that implements this enrichment node */
  plugin: string;

  /** Whether this enrichment node is active */
  enabled: boolean;

  /** Whether this enrichment node is optional */
  optional?: boolean;

  /** Whether this enrichment node can be executed in parallel */
  parallel?: boolean;

  /** List of enrichment node IDs that this node depends on */
  dependencies?: string[];

  /** Plugin-specific configuration for this enrichment node */
  config?: Record<string, unknown>;
}

/**
 * DAG node interface
 *
 * Represents a single pipehead in the DAG.
 */
export interface DAGNode {
  /** Pipehead ID */
  id: string;

  /** Pipehead type */
  type: 'required' | 'enrichment' | 'ingress';

  /** Plugin ID that implements this pipehead */
  plugin: string;

  /** Whether this pipehead is enabled */
  enabled: boolean;

  /** Whether this pipehead is optional */
  optional: boolean;

  /** Whether this pipehead can run in parallel */
  parallel: boolean;

  /** Pipehead dependencies */
  dependencies: string[];

  /** Plugin-specific configuration */
  config: Record<string, unknown>;

  /** Reference to the Pipehead implementation */
  node?: Pipehead;
}

/**
 * DAG edge interface
 *
 * Represents a connection between pipeheads in the DAG.
 */
export interface DAGEdge {
  /** Source pipehead ID */
  from: string;

  /** Target pipehead ID */
  to: string;
}

/**
 * DAG interface
 *
 * Represents the complete DAG with pipeheads and edges.
 */
export interface DAG {
  /** DAG pipeheads */
  nodes: Map<string, DAGNode>;

  /** DAG edges */
  edges: DAGEdge[];

  /** Required pipeheads */
  requiredNodes: string[];

  /** Analyst ID */
  analystId: string;

  /** DAG version */
  version?: string;
}

/**
 * Dependency graph interface
 *
 * Graph structure for dependency resolution.
 */
export interface DependencyGraph {
  /** Map of pipehead ID to array of dependency pipehead IDs */
  dependencies: Map<string, string[]>;

  /** Map of pipehead ID to array of dependent pipehead IDs */
  dependents: Map<string, string[]>;

  /** All pipehead IDs in the graph */
  nodes: string[];
}

/**
 * Validation result interface
 *
 * Result of DAG validation.
 */
export interface ValidationResult {
  /** Whether the DAG is valid */
  valid: boolean;

  /** Validation errors */
  errors: string[];

  /** Validation warnings */
  warnings: string[];

  /** Detected cycles */
  cycles?: string[][];
}

/**
 * Execution level interface
 *
 * Represents pipeheads that can execute in parallel at a specific level.
 */
export interface ExecutionLevel {
  /** Level number (0-based) */
  level: number;

  /** Pipehead IDs that can execute in parallel at this level */
  nodes: string[];
}

/**
 * DAG build result interface
 *
 * Result of building a DAG from configuration.
 */
export interface DAGBuildResult {
  /** Whether the DAG was built successfully */
  success: boolean;

  /** The built DAG */
  dag?: DAG;

  /** Build errors */
  errors?: string[];

  /** Build warnings */
  warnings?: string[];
}

/**
 * DAG Builder
 *
 * Constructs Directed Acyclic Graphs (DAGs) from analyst configurations.
 * Provides methods for building, validating, and analyzing DAGs.
 */
export class DAGBuilder {
  /** Plugin registry for retrieving pipehead implementations */
  private pluginRegistry: PluginRegistry;

  /**
   * Creates a new DAGBuilder instance.
   *
   * @param pluginRegistry - The plugin registry to use for retrieving pipehead implementations
   */
  constructor(pluginRegistry: PluginRegistry) {
    this.pluginRegistry = pluginRegistry;
  }

  /**
   * Builds a DAG from an analyst configuration.
   *
   * This method:
   * 1. Parses the analyst configuration
   * 2. Creates DAG pipeheads from enrichment pipeheads
   * 3. Resolves dependencies between pipeheads
   * 4. Creates edges based on dependencies
   * 5. Validates the resulting DAG
   *
   * @param config - The analyst configuration
   * @returns DAGBuildResult - Result of building the DAG
   */
  buildFromConfig(config: AnalystConfig): DAGBuildResult {
    const result: DAGBuildResult = {
      success: false,
      warnings: [],
    };

    // Validate configuration
    const configValidation = this.validateConfig(config);
    if (!configValidation.valid) {
      result.errors = configValidation.errors;
      return result;
    }

    result.warnings = configValidation.warnings;

    // Create DAG pipeheads
    const nodes = new Map<string, DAGNode>();
    const edges: DAGEdge[] = [];

    const enrichmentNodes = Array.isArray(config.enrichmentNodes) ? config.enrichmentNodes : [];

    for (const nodeConfig of enrichmentNodes) {
      // Skip disabled nodes
      if (!nodeConfig.enabled) {
        result.warnings?.push(`Node '${nodeConfig.id}' is disabled and will be skipped`);
        continue;
      }

      // Get plugin from registry
      const plugin = this.pluginRegistry.getPlugin(nodeConfig.plugin);
      if (!plugin) {
        result.errors = result.errors || [];
        result.errors.push(`Plugin '${nodeConfig.plugin}' not found in registry for node '${nodeConfig.id}'`);
        continue;
      }

      const builtinDeps = nodeConfig.plugin === 'ai-ml'
        ? this.resolveAiMlDependencies(config)
        : [];

      if (nodeConfig.dependencies && nodeConfig.dependencies.length > 0) {
        const seenDeps = new Set<string>();
        for (const depId of nodeConfig.dependencies) {
          if (seenDeps.has(depId)) {
            result.warnings?.push(`Duplicate edge detected: ${depId} -> ${nodeConfig.id}`);
          }
          seenDeps.add(depId);
        }
      }

      // Create DAG pipehead
      const dagNode: DAGNode = {
        id: nodeConfig.id,
        type: nodeConfig.type,
        plugin: nodeConfig.plugin,
        enabled: nodeConfig.enabled,
        optional: nodeConfig.optional ?? true,
        parallel: nodeConfig.parallel ?? plugin.parallel,
        dependencies: this.mergeDependencies(nodeConfig.dependencies || [], builtinDeps),
        config: nodeConfig.config || {},
        node: plugin,
      };

      nodes.set(nodeConfig.id, dagNode);
    }

    // Check for errors during pipehead creation
    if (result.errors && result.errors.length > 0) {
      return result;
    }

    // Create edges based on dependencies
    for (const [nodeId, node] of nodes.entries()) {
      for (const depId of node.dependencies) {
        // Check if dependency exists
        if (!nodes.has(depId)) {
          result.warnings?.push(`Node '${nodeId}' depends on non-existent node '${depId}'`);
          continue;
        }

        edges.push({ from: depId, to: nodeId });
      }
    }

    // Create DAG
    const dag: DAG = {
      nodes,
      edges,
      requiredNodes: [],
      analystId: config.analystId,
      version: config.version,
    };

    // Validate DAG
    const validation = this.validateDAG(dag);
    if (!validation.valid) {
      result.errors = validation.errors;
      return result;
    }

    result.warnings = [...(result.warnings || []), ...validation.warnings];
    result.success = true;
    result.dag = dag;

    return result;
  }

  /**
   * Builds a DAG from a JSON string.
   *
   * @param configJson - The analyst configuration as a JSON string
   * @returns DAGBuildResult - Result of building the DAG
   */
  buildFromJSON(configJson: string): DAGBuildResult {
    try {
      const config: AnalystConfig = JSON.parse(configJson);
      return this.buildFromConfig(config);
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  /**
   * Validates a DAG structure.
   *
   * This method checks:
   * - No cycles in the graph
   * - All dependencies are satisfied
   * - All pipeheads have valid configurations
   *
   * @param dag - The DAG to validate
   * @returns ValidationResult - Result of validation
   */
  validateDAG(dag: DAG): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // Check for empty DAG
    if (dag.nodes.size === 0) {
      result.valid = false;
      result.errors.push('DAG has no nodes');
      return result;
    }

    // Check for cycles
    const cycles = this.detectCycles(dag);
    if (cycles.length > 0) {
      result.valid = false;
      result.errors.push(`DAG contains ${cycles.length} cycle(s)`);
      result.cycles = cycles;
    }

    // Check for missing dependencies
    for (const [nodeId, node] of dag.nodes.entries()) {
      for (const depId of node.dependencies) {
        if (!dag.nodes.has(depId)) {
          result.warnings.push(`Node '${nodeId}' has missing dependency '${depId}'`);
        }
      }
    }

    // Detect duplicate edges
    const seenEdges = new Set<string>();
    for (const edge of dag.edges) {
      const key = `${edge.from} -> ${edge.to}`;
      if (seenEdges.has(key)) {
        result.warnings.push(`Duplicate edge detected: ${edge.from} -> ${edge.to}`);
      } else {
        seenEdges.add(key);
      }
    }

    // Check for self-dependencies
    for (const [nodeId, node] of dag.nodes.entries()) {
      if (node.dependencies.includes(nodeId)) {
        result.valid = false;
        result.errors.push(`Node '${nodeId}' depends on itself`);
      }
    }

    // Check for duplicate edges
    const edgeSet = new Set<string>();
    for (const edge of dag.edges) {
      const edgeKey = `${edge.from}->${edge.to}`;
      if (edgeSet.has(edgeKey)) {
        result.warnings.push(`Duplicate edge detected: ${edge.from} -> ${edge.to}`);
      }
      edgeSet.add(edgeKey);
    }

    return result;
  }

  /**
   * Performs topological sorting on a DAG.
   *
   * Uses Kahn's algorithm to determine the execution order of pipeheads.
   * Returns pipehead names in topological order.
   *
   * @param dag - The DAG to sort
   * @returns string[] - Pipehead IDs in topological order
   * @throws Error if the DAG contains cycles
   */
  topologicalSort(dag: DAG): string[] {
    // Build dependency graph
    const depGraph = this.resolveDependencies(dag);

    // Calculate in-degree for each pipehead
    const inDegree = new Map<string, number>();
    for (const nodeId of depGraph.nodes) {
      inDegree.set(nodeId, 0);
    }

    for (const [nodeId, deps] of depGraph.dependencies.entries()) {
      for (const depId of deps) {
        inDegree.set(nodeId, (inDegree.get(nodeId) || 0) + 1);
      }
    }

    // Initialize queue with pipeheads that have no dependencies
    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    // Process pipeheads in topological order
    const sorted: string[] = [];
    while (queue.length > 0) {
      // Sort queue for deterministic ordering
      queue.sort();

      const nodeId = queue.shift()!;
      sorted.push(nodeId);

      // Get dependents of this pipehead
      const dependents = depGraph.dependents.get(nodeId) || [];
      for (const depId of dependents) {
        const newDegree = (inDegree.get(depId) || 0) - 1;
        inDegree.set(depId, newDegree);

        if (newDegree === 0) {
          queue.push(depId);
        }
      }
    }

    // Check if all pipeheads were processed (no cycles)
    if (sorted.length !== depGraph.nodes.length) {
      throw new Error('DAG contains cycles and cannot be topologically sorted');
    }

    return sorted;
  }

  /**
   * Groups pipeheads by execution level for parallel execution.
   *
   * Pipeheads at the same level can be executed in parallel.
   * Returns an array of execution levels, where each level contains
   * pipehead IDs that can execute in parallel.
   *
   * Execution level rules:
   * - Scout pipeheads are always at level 0 (independent signal sources)
   * - Signal Ingress pipeheads are at level 0 or 1 (level 1 if they depend on Scout)
   * - Enrichment pipeheads are at level 1 or higher (based on dependencies)
   *
   * @param dag - The DAG to analyze
   * @returns string[][] - Array of execution levels, each containing pipehead IDs
   */
  getExecutionLevels(dag: DAG): string[][] {
    // Get topological order
    const sorted = this.topologicalSort(dag);

    // Build dependency graph
    const depGraph = this.resolveDependencies(dag);

    // Calculate execution levels
    const levels: string[][] = [];
    const nodeLevels = new Map<string, number>();

    for (const nodeId of sorted) {
      const node = dag.nodes.get(nodeId);
      if (!node) {
        continue;
      }

      // Scout pipeheads always at level 0
      if (node.type === 'ingress' && node.plugin === 'scout') {
        nodeLevels.set(nodeId, 0);
        while (levels.length <= 0) {
          levels.push([]);
        }
        levels[0].push(nodeId);
        continue;
      }

      // Signal Ingress pipeheads at level 0 or 1 (if they depend on Scout)
      if (node.type === 'ingress' && node.plugin === 'signal-ingress') {
        const deps = depGraph.dependencies.get(nodeId) || [];
        const dependsOnScout = deps.some(depId => {
          const depNode = dag.nodes.get(depId);
          return depNode?.plugin === 'scout';
        });
        
        const nodeLevel = dependsOnScout ? 1 : 0;
        nodeLevels.set(nodeId, nodeLevel);
        
        while (levels.length <= nodeLevel) {
          levels.push([]);
        }
        levels[nodeLevel].push(nodeId);
        continue;
      }

      // Enrichment pipeheads at level 1 or higher (based on dependencies)
      const deps = depGraph.dependencies.get(nodeId) || [];
      let maxLevel = -1;

      // Find the maximum level among dependencies
      for (const depId of deps) {
        const depLevel = nodeLevels.get(depId) ?? -1;
        if (depLevel > maxLevel) {
          maxLevel = depLevel;
        }
      }

      // Pipehead's level is max dependency level + 1
      const nodeLevel = Math.max(1, maxLevel + 1);
      nodeLevels.set(nodeId, nodeLevel);

      // Add pipehead to appropriate level
      while (levels.length <= nodeLevel) {
        levels.push([]);
      }
      levels[nodeLevel].push(nodeId);
    }

    while (levels.length > 0 && levels[0].length === 0) {
      levels.shift();
    }

    return levels;
  }

  /**
   * Resolves dependencies between pipeheads in a DAG.
   *
   * Builds a dependency graph structure that maps:
   * - Pipehead ID to array of dependency pipehead IDs
   * - Pipehead ID to array of dependent pipehead IDs
   *
   * @param dag - The DAG to analyze
   * @returns DependencyGraph - The dependency graph
   */
  resolveDependencies(dag: DAG): DependencyGraph {
    const dependencies = new Map<string, string[]>();
    const dependents = new Map<string, string[]>();
    const nodes: string[] = [];

    // Initialize maps for all pipeheads
    for (const nodeId of dag.nodes.keys()) {
      dependencies.set(nodeId, []);
      dependents.set(nodeId, []);
      nodes.push(nodeId);
    }

    // Build dependency relationships
    for (const [nodeId, node] of dag.nodes.entries()) {
      for (const depId of node.dependencies) {
        // Add dependency
        const deps = dependencies.get(nodeId) || [];
        deps.push(depId);
        dependencies.set(nodeId, deps);

        // Add dependent
        const depsOfDep = dependents.get(depId) || [];
        depsOfDep.push(nodeId);
        dependents.set(depId, depsOfDep);
      }
    }

    return {
      dependencies,
      dependents,
      nodes,
    };
  }

  /**
   * Detects cycles in a DAG using DFS.
   *
   * @param dag - The DAG to check for cycles
   * @returns string[][] - Array of cycles, where each cycle is an array of pipehead IDs
   */
  detectCycles(dag: DAG): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = dag.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (!visited.has(depId)) {
            if (dfs(depId)) {
              return true;
            }
          } else if (recursionStack.has(depId)) {
            // Found a cycle
            const cycleStart = path.indexOf(depId);
            const cycle = path.slice(cycleStart);
            cycles.push([...cycle, depId]);
            return true;
          }
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of dag.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return cycles;
  }

  /**
   * Validates an analyst configuration.
   *
   * @param config - The analyst configuration to validate
   * @returns ValidationResult - Result of validation
   */
  private validateConfig(config: AnalystConfig): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    // Check required fields
    if (!config.analystId) {
      result.valid = false;
      result.errors.push('Missing required field: analystId');
    }

    if (!config.enrichmentNodes || config.enrichmentNodes.length === 0) {
      result.valid = false;
      result.errors.push('Missing or empty field: enrichmentNodes');
    }

    // Validate enrichment nodes
    const nodeIds = new Set<string>();
    let enabledEnrichmentCount = 0;
    for (const node of config.enrichmentNodes || []) {
      if (!node.id) {
        result.valid = false;
        result.errors.push('Enrichment node missing required field: id');
        continue;
      }

      // Check for duplicate node IDs
      if (nodeIds.has(node.id)) {
        result.valid = false;
        result.errors.push(`Duplicate node ID: ${node.id}`);
      }
      nodeIds.add(node.id);

      // Validate node type
      if (node.type !== 'enrichment' && node.type !== 'ingress') {
        result.valid = false;
        result.errors.push(`Invalid node type '${node.type}' for node '${node.id}'`);
      }

      // Validate plugin
      if (!node.plugin) {
        result.valid = false;
        result.errors.push(`Node '${node.id}' missing required field: plugin`);
      }

      if (node.type === 'enrichment' && node.enabled) {
        enabledEnrichmentCount++;
      }
    }

    if (enabledEnrichmentCount < 1) {
      result.valid = false;
      result.errors.push('At least one enrichment node must be enabled');
    }

    // Validate Scout pipehead positioning
    const scoutValidation = this.validateScoutNodePositioning(config);
    if (!scoutValidation.valid) {
      result.valid = false;
      result.errors.push(...scoutValidation.errors);
    }
    result.warnings.push(...scoutValidation.warnings);

    return result;
  }

  /**
   * Validates Scout pipehead positioning in the DAG.
   *
   * This method ensures:
   * - Scout pipeheads have no dependencies (they are independent signal sources)
   * - Enrichment pipeheads do not depend on Scout pipeheads
   *
   * @param config - The analyst configuration to validate
   * @returns ValidationResult - Result of validation
   */
  private validateScoutNodePositioning(config: AnalystConfig): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    const nodes = Array.isArray(config.enrichmentNodes) ? config.enrichmentNodes : [];

    for (const node of nodes) {
      if (node.type === 'ingress' && node.plugin === 'scout') {
        // Scout nodes must have no dependencies
        if (node.dependencies && node.dependencies.length > 0) {
          result.valid = false;
          result.errors.push(
            `Scout node '${node.id}' has dependencies [${node.dependencies.join(', ')}]. ` +
            `Scout nodes must be independent signal sources with no dependencies.`
          );
        }
      } else if (node.type === 'enrichment') {
        // Enrichment nodes must not depend on Scout nodes
        if (node.dependencies && node.dependencies.some(dep => dep.startsWith('scout'))) {
          result.valid = false;
          result.errors.push(
            `Enrichment node '${node.id}' depends on Scout node. ` +
            `Enrichment nodes must not depend on Scout nodes.`
          );
        }
      }
    }

    return result;
  }

  /**
   * Merges configuration dependencies with plugin built-in dependencies.
   * Removes duplicates and validates no conflicts.
   *
   * @param configDeps - Dependencies from configuration
   * @param pluginDeps - Built-in dependencies from plugin
   * @returns Merged dependencies array
   * @private
   */
  private mergeDependencies(configDeps: string[], pluginDeps: string[]): string[] {
    return [...pluginDeps, ...configDeps];
  }

  private resolveAiMlDependencies(config: AnalystConfig): string[] {
    const enabledIds = config.enrichmentNodes
      .filter((n) => n.enabled && n.id !== 'ai-ml')
      .map((n) => n.id);
    return AiMlNode.resolveDependencies(enabledIds);
  }

  /**
   * Gets the plugin registry used by this DAGBuilder.
   *
   * @returns The plugin registry
   */
  getPluginRegistry(): PluginRegistry {
    return this.pluginRegistry;
  }
}
