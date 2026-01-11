/**
 * AFI Reactor - DAG Executor
 *
 * This module provides the DAGExecutor component for executing Directed Acyclic Graphs (DAGs)
 * built by the DAGBuilder. The DAGExecutor handles:
 * - Sequential and parallel execution of DAG nodes
 * - Error handling and recovery mechanisms
 * - Execution metrics tracking (timing, success/failure rates)
 * - Execution cancellation support
 * - Execution context and state management
 * - Integration with DAGBuilder for execution planning
 * - Integration with PluginRegistry for node implementation retrieval
 *
 * @module afi-reactor/src/dag/DAGExecutor
 */

import type { Pipehead, PipelineState } from '../types/dag.js';
import { DAGBuilder, type DAG, type DAGNode } from './DAGBuilder.js';
import { PluginRegistry } from './PluginRegistry.js';

/**
 * Execution status enumeration
 *
 * Defines the possible states of a DAG execution.
 */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Pipehead execution result
 *
 * Result of executing a single pipehead in the DAG.
 */
export interface NodeExecutionResult {
  /** Pipehead ID */
  nodeId: string;

  /** Pipehead type */
  nodeType: 'required' | 'enrichment' | 'ingress';

  /** Whether the pipehead execution was successful */
  success: boolean;

  /** Execution start time (timestamp in milliseconds) */
  startTime: number;

  /** Execution end time (timestamp in milliseconds) */
  endTime: number;

  /** Execution duration in milliseconds */
  duration: number;

  /** Result state after pipehead execution */
  state?: PipelineState;

  /** Error message if execution failed */
  error?: string;

  /** Number of retries attempted */
  retries: number;

  /** Whether the pipehead was skipped */
  skipped: boolean;
}

/**
 * Execution metrics
 *
 * Metrics collected during DAG execution.
 */
export interface ExecutionMetrics {
  /** Execution ID */
  executionId: string;

  /** Total execution time in milliseconds */
  totalTime: number;

  /** Execution start time (timestamp in milliseconds) */
  startTime: number;

  /** Execution end time (timestamp in milliseconds) */
  endTime: number;

  /** Number of pipeheads executed */
  nodesExecuted: number;

  /** Number of pipeheads that succeeded */
  nodesSucceeded: number;

  /** Number of pipeheads that failed */
  nodesFailed: number;

  /** Number of pipeheads that were skipped */
  nodesSkipped: number;

  /** Map of pipehead ID to pipehead execution result */
  nodeResults: Map<string, NodeExecutionResult>;

  /** Execution errors */
  errors: string[];

  /** Execution warnings */
  warnings: string[];

  /** Memory usage in bytes (if available) */
  memoryUsage?: number;

  /** Number of parallel execution levels */
  parallelLevels: number;
}

/**
 * Execution context
 *
 * Context for a single DAG execution.
 */
export interface ExecutionContext {
  /** Unique execution ID */
  executionId: string;

  /** DAG being executed */
  dag: DAG;

  /** Initial state */
  initialState: PipelineState;

  /** Current state */
  currentState: PipelineState;

  /** Execution status */
  status: ExecutionStatus;

  /** Execution start time (timestamp in milliseconds) */
  startTime: number;

  /** Execution end time (timestamp in milliseconds) */
  endTime?: number;

  /** Execution options */
  options: ExecutionOptions;

  /** Cancellation flag */
  cancelled: boolean;

  /** Cancellation signal promise */
  cancelSignal: Promise<void>;

  /** Cancellation trigger */
  cancelReject?: (reason?: unknown) => void;

  /** Cancellation reason */
  cancellationReason?: string;

  /** Map of pipehead ID to pipehead execution result */
  nodeResults: Map<string, NodeExecutionResult>;

  /** Execution errors */
  errors: string[];

  /** Execution warnings */
  warnings: string[];

  /** Pipeheads that have been executed */
  executedNodes: Set<string>;

  /** Pipeheads that are currently executing */
  executingNodes: Set<string>;

  /** Pipeheads that failed */
  failedNodes: Set<string>;

  /** Pipeheads that were skipped */
  skippedNodes: Set<string>;
}

/**
 * Execution options
 *
 * Options for controlling DAG execution behavior.
 */
export interface ExecutionOptions {
  /** Maximum execution time in milliseconds (0 for no timeout) */
  timeout?: number;

  /** Maximum number of retries for failed nodes (0 for no retries) */
  maxRetries?: number;

  /** Delay between retries in milliseconds */
  retryDelay?: number;

  /** Whether to continue execution on non-critical failures */
  continueOnError?: boolean;

  /** Whether to fail fast on first error */
  failFast?: boolean;

  /** Execution mode: sequential, parallel, or adaptive (default) */
  executionMode?: 'sequential' | 'parallel' | 'adaptive';

  /** Maximum number of parallel nodes (0 for unlimited) */
  maxParallelNodes?: number;

  /** Whether to track memory usage */
  trackMemoryUsage?: boolean;

  /** Whether to enable detailed logging */
  enableLogging?: boolean;

  /** Custom logger function */
  logger?: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/**
 * Execution result
 *
 * Result of executing a DAG.
 */
export interface ExecutionResult {
  /** Whether the execution was successful */
  success: boolean;

  /** Execution ID */
  executionId: string;

  /** Final state after execution */
  state?: PipelineState;

  /** Execution status */
  status: ExecutionStatus;

  /** Execution metrics */
  metrics: ExecutionMetrics;

  /** Execution errors */
  errors: string[];

  /** Execution warnings */
  warnings: string[];
}

/**
 * Retry policy
 *
 * Defines retry behavior for failed nodes.
 */
export interface RetryPolicy {
  /** Maximum number of retries */
  maxRetries: number;

  /** Delay between retries in milliseconds */
  retryDelay: number;

  /** Exponential backoff multiplier */
  backoffMultiplier?: number;

  /** Maximum delay between retries in milliseconds */
  maxRetryDelay?: number;

  /** Whether to retry on specific error types */
  retryableErrors?: string[];
}

/**
 * DAG Executor
 *
 * Executes DAGs with support for sequential and parallel execution patterns.
 * Provides error handling, recovery mechanisms, and execution metrics tracking.
 */
export class DAGExecutor {
  /** DAG builder for execution planning */
  private dagBuilder: DAGBuilder;

  /** Plugin registry for retrieving pipehead implementations */
  private pluginRegistry: PluginRegistry;

  /** Map of execution ID to execution context */
  private executions: Map<string, ExecutionContext>;

  /** Default execution options */
  private defaultOptions: ExecutionOptions;

  /**
   * Creates a new DAGExecutor instance.
   *
   * @param dagBuilder - The DAG builder to use for execution planning
   * @param pluginRegistry - The plugin registry to use for retrieving pipehead implementations
   * @param defaultOptions - Default execution options
   */
  constructor(
    dagBuilder: DAGBuilder,
    pluginRegistry: PluginRegistry,
    defaultOptions: ExecutionOptions = {}
  ) {
    this.dagBuilder = dagBuilder;
    this.pluginRegistry = pluginRegistry;
    this.executions = new Map();
    this.defaultOptions = {
      timeout: 0,
      maxRetries: 0,
      retryDelay: 1000,
      continueOnError: true,
      failFast: false,
      maxParallelNodes: 0,
      trackMemoryUsage: false,
      enableLogging: false,
      executionMode: 'adaptive',
      ...defaultOptions,
    };
  }

  /**
   * Executes a DAG with automatic execution strategy selection.
   *
   * This method determines the optimal execution strategy based on the DAG structure
   * and executes the DAG accordingly.
   *
   * @param dag - The DAG to execute
   * @param initialState - The initial state for execution
   * @param options - Execution options
   * @returns Promise<ExecutionResult> - Result of execution
   */
  async execute(
    dag: DAG,
    initialState?: PipelineState,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    const executionId = this.generateExecutionId();

    // Create execution context
    const context = this.createExecutionContext(executionId, dag, initialState, mergedOptions);
    this.executions.set(executionId, context);

    this.log(context, `Starting execution ${executionId}`, 'info');

    const runPromise = (async () => {
      try {
        // Check for timeout
        if (mergedOptions.timeout && mergedOptions.timeout > 0) {
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Execution timeout after ${mergedOptions.timeout}ms`));
            }, mergedOptions.timeout);
          });

          await Promise.race([
            this.executeInternal(context),
            timeoutPromise,
          ]);
        } else {
          await this.executeInternal(context);
        }

        // Determine final status
        if (context.cancelled) {
          context.status = 'cancelled';
        } else if (context.failedNodes.size > 0) {
          context.status = 'failed';
        } else {
          context.status = 'completed';
        }

        context.endTime = Date.now();

        this.log(context, `Execution ${executionId} completed with status: ${context.status}`, 'info');

        return this.buildExecutionResult(context);
      } catch (error) {
        context.status = context.cancelled ? 'cancelled' : 'failed';
        context.endTime = Date.now();
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.errors.push(errorMessage);

        this.log(context, `Execution ${executionId} failed: ${errorMessage}`, 'error');

        return this.buildExecutionResult(context);
      } finally {
        // Clean up execution context after a delay
        setTimeout(() => {
          this.executions.delete(executionId);
        }, 60000); // Keep for 1 minute
      }
    })();

    (runPromise as any).executionId = executionId;
    return runPromise;
  }

  /**
   * Executes a DAG sequentially.
   *
   * Pipeheads are executed one at a time in topological order.
   *
   * @param dag - The DAG to execute
   * @param initialState - The initial state for execution
   * @param options - Execution options
   * @returns Promise<ExecutionResult> - Result of execution
   */
  async executeSequential(
    dag: DAG,
    initialState?: PipelineState,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const mergedOptions = { ...this.defaultOptions, ...options, maxParallelNodes: 1 };
    return this.execute(dag, initialState, mergedOptions);
  }

  /**
   * Executes a DAG in parallel where possible.
   *
   * Pipeheads at the same execution level are executed in parallel.
   *
   * @param dag - The DAG to execute
   * @param initialState - The initial state for execution
   * @param options - Execution options
   * @returns Promise<ExecutionResult> - Result of execution
   */
  async executeParallel(
    dag: DAG,
    initialState?: PipelineState,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    return this.execute(dag, initialState, mergedOptions);
  }

  /**
   * Cancels a running execution.
   *
   * @param executionId - The execution ID to cancel
   * @param reason - The reason for cancellation
   * @returns Promise<void>
   */
  async cancelExecution(executionId?: string, reason?: string): Promise<void> {
    const targetId = executionId || Array.from(this.executions.keys()).pop();
    if (!targetId) {
      throw new Error('Execution not found');
    }

    const context = this.executions.get(targetId);
    if (!context) {
      throw new Error(`Execution ${targetId} not found`);
    }

    if (context.status !== 'running' && context.status !== 'pending') {
      throw new Error(`Cannot cancel execution ${executionId} with status ${context.status}`);
    }

    context.cancelled = true;
    context.cancellationReason = reason || 'Execution cancelled by user';

    if (context.cancelReject) {
      context.cancelReject(new Error(context.cancellationReason));
    }

    this.log(context, `Cancelling execution ${targetId}: ${context.cancellationReason}`, 'warn');
  }

  /**
   * Gets metrics for an execution.
   *
   * @param executionId - The execution ID
   * @returns ExecutionMetrics | undefined - The execution metrics, or undefined if not found
   */
  getExecutionMetrics(executionId: string): ExecutionMetrics | undefined {
    const context = this.executions.get(executionId);
    if (!context) {
      return undefined;
    }

    return this.buildExecutionMetrics(context);
  }

  /**
   * Gets the status of an execution.
   *
   * @param executionId - The execution ID
   * @returns ExecutionStatus | undefined - The execution status, or undefined if not found
   */
  getExecutionStatus(executionId: string): ExecutionStatus | undefined {
    const context = this.executions.get(executionId);
    return context?.status;
  }

  /**
   * Gets the execution context for an execution.
   *
   * @param executionId - The execution ID
   * @returns ExecutionContext | undefined - The execution context, or undefined if not found
   */
  getExecutionContext(executionId: string): ExecutionContext | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Gets all active executions.
   *
   * @returns Map<string, ExecutionContext> - Map of execution ID to execution context
   */
  getActiveExecutions(): Map<string, ExecutionContext> {
    const active = new Map<string, ExecutionContext>();
    for (const [id, context] of this.executions.entries()) {
      if (context.status === 'running' || context.status === 'pending') {
        active.set(id, context);
      }
    }
    return active;
  }

  /**
   * Clears all completed executions.
   */
  clearCompletedExecutions(): void {
    for (const [id, context] of this.executions.entries()) {
      if (context.status === 'completed' || context.status === 'failed' || context.status === 'cancelled') {
        this.executions.delete(id);
      }
    }
  }

  /**
   * Internal execution method.
   *
   * @param context - The execution context
   * @returns Promise<void>
   * @private
   */
  private async executeInternal(context: ExecutionContext): Promise<void> {
    context.status = 'running';

    const levels = this.dagBuilder.getExecutionLevels(context.dag);

    for (const level of levels) {
      const pending = level.filter((nodeId) => !context.executedNodes.has(nodeId));
      if (pending.length === 0) continue;

      const runParallel = this.shouldRunLevelParallel(context, pending);

      if (runParallel) {
        await this.executeLevelParallel(context, pending);
      } else {
        for (const nodeId of pending) {
          await this.executeNode(context, nodeId);

          if (context.options.failFast && context.failedNodes.size > 0) {
            this.log(context, 'Fail fast enabled, stopping execution', 'warn');
            return;
          }

          if (context.cancelled) {
            this.log(context, 'Execution cancelled, stopping', 'warn');
            return;
          }
        }
      }

      if (context.cancelled) {
        this.log(context, 'Execution cancelled, stopping', 'warn');
        return;
      }
    }
  }

  /**
   * Executes a single pipehead.
   *
   * @param context - The execution context
   * @param nodeId - The pipehead ID to execute
   * @returns Promise<void>
   * @private
   */
  private async executeNode(context: ExecutionContext, nodeId: string): Promise<void> {
    // Check if pipehead was already executed
    if (context.executedNodes.has(nodeId)) {
      return;
    }

    // Check for cancellation
    if (context.cancelled) {
      this.log(context, `Skipping pipehead ${nodeId} due to cancellation`, 'warn');
      context.skippedNodes.add(nodeId);
      return;
    }

    const node = context.dag.nodes.get(nodeId);
    if (!node) {
      const error = `Pipehead ${nodeId} not found in DAG`;
      context.errors.push(error);
      context.failedNodes.add(nodeId);
      this.log(context, error, 'error');
      return;
    }

    // Check if dependencies have succeeded
    for (const depId of node.dependencies) {
      if (context.failedNodes.has(depId)) {
        const error = `Pipehead ${nodeId} has failed dependency ${depId}`;
        context.errors.push(error);
        context.skippedNodes.add(nodeId);
        this.log(context, error, 'error');
        return;
      }
    }

    // Mark pipehead as executing
    context.executingNodes.add(nodeId);

    const startTime = Date.now();
    let retries = 0;
    let lastError: string | undefined;

    // Execute with retry logic
    while (retries <= (context.options.maxRetries || 0)) {
      try {
        this.log(context, `Executing pipehead ${nodeId} (attempt ${retries + 1})`, 'info');

        // Update current pipehead in state
        context.currentState.currentNode = nodeId;
        context.currentState.metadata.currentNodeStartTime = new Date().toISOString();

        // Get pipehead implementation
        const nodeImpl = node.node || this.pluginRegistry.getPlugin(node.plugin);
        if (!nodeImpl) {
          this.log(context, `No implementation found for pipehead ${nodeId}, plugin ${node.plugin}`, 'error');
          throw new Error(`Plugin ${node.plugin} not found for pipehead ${nodeId}`);
        }

        // Execute pipehead with cancellation support
        const executionPromise = nodeImpl.execute(context.currentState);
        const newState = await Promise.race([
          executionPromise,
          this.getCancellationPromise(context),
        ]);

        // Update state
        context.currentState = newState;

        // Record successful execution
        const endTime = Date.now();
        const result: NodeExecutionResult = {
          nodeId,
          nodeType: node.type,
          success: true,
          startTime,
          endTime,
          duration: endTime - startTime,
          state: newState,
          retries,
          skipped: false,
        };

        context.nodeResults.set(nodeId, result);
        context.executedNodes.add(nodeId);
        context.executingNodes.delete(nodeId);

        this.log(context, `Pipehead ${nodeId} executed successfully in ${result.duration}ms`, 'info');

        return;
      } catch (error) {
        if (context.cancelled) {
          this.log(context, `Skipping pipehead ${nodeId} due to cancellation`, 'warn');
          context.skippedNodes.add(nodeId);
          context.executingNodes.delete(nodeId);
          return;
        }

        lastError = error instanceof Error ? error.message : String(error);
        retries++;

        this.log(context, `Pipehead ${nodeId} failed (attempt ${retries}): ${lastError}`, 'error');

        // Check if we should retry
        if (retries <= (context.options.maxRetries || 0)) {
          const delay = context.options.retryDelay || 1000;
          this.log(context, `Retrying pipehead ${nodeId} in ${delay}ms`, 'warn');
          await this.sleep(delay);
        } else {
          // Max retries exceeded
          const endTime = Date.now();
          const result: NodeExecutionResult = {
            nodeId,
            nodeType: node.type,
            success: false,
            startTime,
            endTime,
            duration: endTime - startTime,
            error: lastError,
            retries: retries - 1,
            skipped: false,
          };

          context.nodeResults.set(nodeId, result);
          context.executedNodes.add(nodeId);
          context.executingNodes.delete(nodeId);
          context.failedNodes.add(nodeId);
          context.errors.push(`Pipehead ${nodeId} failed after ${retries} attempts: ${lastError}`);

          // Check if we should continue on error
          if (!context.options.continueOnError && !node.optional) {
            throw new Error(`Pipehead ${nodeId} failed and continueOnError is false`);
          }

          this.log(context, `Pipehead ${nodeId} failed after ${retries} attempts`, 'error');
        }
      }
    }
  }

  /**
   * Executes a level of pipeheads in parallel.
   *
   * @param context - The execution context
   * @param level - The pipehead IDs in this level
   * @returns Promise<void>
   * @private
   */
  private async executeLevelParallel(context: ExecutionContext, level: string[]): Promise<void> {
    const maxParallel = context.options.maxParallelNodes || level.length;
    const chunks: string[][] = [];

    // Split into chunks if maxParallel is set
    for (let i = 0; i < level.length; i += maxParallel) {
      chunks.push(level.slice(i, i + maxParallel));
    }

    // Execute each chunk
    for (const chunk of chunks) {
      // Check for cancellation
      if (context.cancelled) {
        this.log(context, 'Execution cancelled, stopping parallel execution', 'warn');
        return;
      }

      // Execute pipeheads in parallel
      const promises = chunk.map(nodeId => this.executeNode(context, nodeId));
      await Promise.all(promises);

      // Check for fail fast
      if (context.options.failFast && context.failedNodes.size > 0) {
        this.log(context, 'Fail fast enabled, stopping parallel execution', 'warn');
        return;
      }
    }
  }

  private shouldRunLevelParallel(context: ExecutionContext, level: string[]): boolean {
    const mode = context.options.executionMode || 'adaptive';
    if (mode === 'sequential') return false;
    if (level.length <= 1) return false;

    const maxParallel = context.options.maxParallelNodes || level.length;
    if (maxParallel <= 1) return false;

    const allParallelCapable = level.every((nodeId) => {
      const node = context.dag.nodes.get(nodeId);
      return node?.parallel !== false;
    });

    if (!allParallelCapable) return false;

    if (mode === 'parallel') return true;

    // adaptive: parallel when safe and capacity allows
    return true;
  }

  private getCancellationPromise(context: ExecutionContext): Promise<never> {
    return context.cancelSignal.then(() => {
      throw new Error(context.cancellationReason || 'Execution cancelled');
    });
  }

  /**
   * Executes Scout nodes in parallel.
   *
   * Scout nodes are independent signal sources that have no dependencies.
   * They execute first, before any enrichment nodes.
   *
   * @param context - The execution context
   * @returns Promise<void>
   * @private
   */
  private async executeScoutNodes(context: ExecutionContext): Promise<void> {
    // Get all Scout nodes
    const scoutNodes = Array.from(context.dag.nodes.entries())
      .filter(([_, node]) => node.type === 'ingress' && node.plugin !== 'signal-ingress');

    this.log(context, `Found ${scoutNodes.length} scout nodes: ${scoutNodes.map(([id]) => id).join(', ')}`, 'info');

    if (scoutNodes.length === 0) {
      this.log(context, 'No Scout nodes to execute', 'info');
      return;
    }

    this.log(context, `Executing ${scoutNodes.length} Scout nodes`, 'info');

    // Execute Scout nodes in parallel (they have no dependencies)
    const scoutPromises = scoutNodes.map(([nodeId, node]) =>
      this.executeNode(context, nodeId)
    );

    await Promise.all(scoutPromises);

    // Track Scout submissions for reward attribution
    for (const [nodeId, node] of scoutNodes) {
      const result = context.nodeResults.get(nodeId);
      if (result && result.success) {
        // Scout submissions are tracked in the state for reward attribution
        if (context.currentState.enrichmentResults.has(nodeId)) {
          const scoutResult = context.currentState.enrichmentResults.get(nodeId);
          if (scoutResult && typeof scoutResult === 'object') {
            // Ensure scoutId is present for reward attribution
            if (!('scoutId' in scoutResult)) {
              (scoutResult as any).scoutId = nodeId;
            }
          }
        }
      }
    }

    this.log(context, `Executed ${scoutNodes.length} Scout nodes successfully`, 'info');
  }

  /**
   * Executes nodes by type.
   *
   * @param context - The execution context
   * @param type - The node type to execute
   * @param plugin - Optional plugin filter
   * @returns Promise<void>
   * @private
   */
  private async executeNodesByType(
    context: ExecutionContext,
    type: 'required' | 'enrichment' | 'ingress',
    plugin?: string
  ): Promise<void> {
    // Get nodes of the specified type
    const nodes = Array.from(context.dag.nodes.entries())
      .filter(([_, node]) => {
        if (node.type !== type) {
          return false;
        }
        if (plugin && node.plugin !== plugin) {
          return false;
        }
        return true;
      });

    const pluginSuffix = plugin ? ` (${plugin})` : '';

    if (nodes.length === 0) {
      this.log(context, `No ${type}${pluginSuffix} nodes to execute`, 'info');
      return;
    }

    this.log(context, `Executing ${nodes.length} ${type}${pluginSuffix} nodes`, 'info');

    // Execute nodes in parallel if they have no dependencies
    const nodesWithoutDeps = nodes.filter(([_, node]) => node.dependencies.length === 0);
    const nodesWithDeps = nodes.filter(([_, node]) => node.dependencies.length > 0);

    // Execute nodes without dependencies in parallel
    if (nodesWithoutDeps.length > 0) {
      const promises = nodesWithoutDeps.map(([nodeId]) => this.executeNode(context, nodeId));
      await Promise.all(promises);
    }

    // Execute nodes with dependencies sequentially (respecting dependency order)
    if (nodesWithDeps.length > 0) {
      for (const [nodeId] of nodesWithDeps) {
        await this.executeNode(context, nodeId);
      }
    }

    this.log(context, `Executed ${nodes.length} ${type}${pluginSuffix} nodes successfully`, 'info');
  }

  /**
   * Creates an execution context.
   *
   * @param executionId - The execution ID
   * @param dag - The DAG to execute
   * @param initialState - The initial state
   * @param options - Execution options
   * @returns ExecutionContext - The execution context
   * @private
   */
  private createExecutionContext(
    executionId: string,
    dag: DAG,
    initialState?: PipelineState,
    options?: ExecutionOptions
  ): ExecutionContext {
    const now = new Date().toISOString();

    let cancelReject: (reason?: unknown) => void;
    const cancelSignal = new Promise<void>((_, reject) => {
      cancelReject = reject;
    });

    // Create initial state if not provided
    const state: PipelineState = initialState || {
      signalId: `signal-${executionId}`,
      rawSignal: null,
      enrichmentResults: new Map(),
      analystConfig: {
        analystId: dag.analystId,
        enrichmentNodes: [],
      },
      metadata: {
        startTime: now,
        trace: [],
      },
    };

    return {
      executionId,
      dag,
      initialState: state,
      currentState: { ...state },
      status: 'pending',
      startTime: Date.now(),
      options: options || this.defaultOptions,
      cancelled: false,
      cancelSignal,
      cancelReject,
      nodeResults: new Map(),
      errors: [],
      warnings: [],
      executedNodes: new Set(),
      executingNodes: new Set(),
      failedNodes: new Set(),
      skippedNodes: new Set(),
    };
  }

  /**
   * Builds an execution result from an execution context.
   *
   * @param context - The execution context
   * @returns ExecutionResult - The execution result
   * @private
   */
  private buildExecutionResult(context: ExecutionContext): ExecutionResult {
    const success = context.status === 'completed' && context.failedNodes.size === 0;

    return {
      success,
      executionId: context.executionId,
      state: context.currentState,
      status: context.status,
      metrics: this.buildExecutionMetrics(context),
      errors: [...context.errors],
      warnings: [...context.warnings],
    };
  }

  /**
   * Builds execution metrics from an execution context.
   *
   * @param context - The execution context
   * @returns ExecutionMetrics - The execution metrics
   * @private
   */
  private buildExecutionMetrics(context: ExecutionContext): ExecutionMetrics {
    const endTime = context.endTime || Date.now();
    const totalTime = endTime - context.startTime;

    // Get memory usage if tracking is enabled
    let memoryUsage: number | undefined;
    if (context.options.trackMemoryUsage) {
      memoryUsage = this.getMemoryUsage();
    }

    // Count parallel levels
    const levels = this.dagBuilder.getExecutionLevels(context.dag);
    const parallelLevels = levels.filter(level => level.length > 1).length;

    return {
      executionId: context.executionId,
      totalTime,
      startTime: context.startTime,
      endTime,
      nodesExecuted: context.executedNodes.size,
      nodesSucceeded: context.executedNodes.size - context.failedNodes.size,
      nodesFailed: context.failedNodes.size,
      nodesSkipped: context.skippedNodes.size,
      nodeResults: new Map(context.nodeResults),
      errors: [...context.errors],
      warnings: [...context.warnings],
      memoryUsage,
      parallelLevels,
    };
  }

  /**
   * Generates a unique execution ID.
   *
   * @returns string - The execution ID
   * @private
   */
  private generateExecutionId(): string {
    return `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Sleeps for a specified duration.
   *
   * @param ms - The duration in milliseconds
   * @returns Promise<void>
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gets the current memory usage.
   *
   * @returns number - Memory usage in bytes
   * @private
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }

  /**
   * Logs a message if logging is enabled.
   *
   * @param context - The execution context
   * @param message - The message to log
   * @param level - The log level
   * @private
   */
  private log(context: ExecutionContext, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (context.options.enableLogging) {
      const logger = context.options.logger || console.log;
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${context.executionId}] [${level.toUpperCase()}]`;
      logger(`${prefix} ${message}`);
    }
  }

  /**
   * Gets the DAG builder used by this executor.
   *
   * @returns The DAG builder
   */
  getDAGBuilder(): DAGBuilder {
    return this.dagBuilder;
  }

  /**
   * Gets the plugin registry used by this executor.
   *
   * @returns The plugin registry
   */
  getPluginRegistry(): PluginRegistry {
    return this.pluginRegistry;
  }

  /**
   * Gets the default execution options.
   *
   * @returns The default execution options
   */
  getDefaultOptions(): ExecutionOptions {
    return { ...this.defaultOptions };
  }

  /**
   * Sets the default execution options.
   *
   * @param options - The default execution options
   */
  setDefaultOptions(options: ExecutionOptions): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
  }
}
