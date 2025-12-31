/**
 * AFI Reactor - Pipeline Types
 *
 * This file defines TypeScript interfaces for pipeline orchestration,
 * bridging afi-factory configurations with DAG execution.
 *
 * These interfaces define the core types used by the pipeline orchestrator,
 * state management, and pipehead execution.
 *
 * @module afi-reactor/src/types/dag
 */

// Note: AnalystConfig and EnrichmentNodeConfig are defined in afi-factory/schemas
// For type compatibility, we define minimal types here to avoid cross-repo import issues
interface AnalystConfig {
  analystId: string;
  enrichmentNodes: EnrichmentNodeConfig[];
}

interface EnrichmentNodeConfig {
  id: string;
  type: 'enrichment' | 'ingress';
  plugin: string;
  enabled: boolean;
}

/**
 * Pipehead interface
 *
 * Defines the contract for all pipeheads (required, enrichment, and ingress).
 * All pipeheads must implement this interface to be executable in the DAG.
 *
 * Why "Pipehead"? Because every pipehead leads the way through the pipeline!
 */
export interface Pipehead {
  /** Pipehead ID. Must be unique within the DAG. */
  id: string;

  /** Pipehead type: 'required' pipeheads are always present, 'enrichment' and 'ingress' pipeheads are analyst-configurable. */
  type: 'required' | 'enrichment' | 'ingress';

  /** Plugin ID that implements this pipehead. Must reference a registered plugin. */
  plugin: string;

  /** Pipehead execution function that processes state and returns updated state. */
  execute: (state: PipelineState) => Promise<PipelineState>;

  /** Whether this pipehead can run in parallel with other pipeheads. */
  parallel?: boolean;

  /** Pipehead dependencies. The DAG will ensure all dependencies complete before executing this pipehead. */
  dependencies?: string[];
}

/**
 * Pipeline state interface
 *
 * Represents the state of a pipeline execution. The state is passed through
 * all pipeheads and accumulates enrichment results and execution metadata.
 */
export interface PipelineState {
  /** Signal ID. Unique identifier for the signal being processed. */
  signalId: string;

  /** Raw signal data. The original signal before enrichment. */
  rawSignal: unknown;

  /** Enrichment results. Map of pipehead ID to enrichment result. */
  enrichmentResults: Map<string, unknown>;

  /** Analyst configuration. The configuration for the analyst processing this signal. */
  analystConfig: AnalystConfig;

  /** Current pipehead being executed. */
  currentNode?: string;

  /** Execution metadata. Tracks execution progress and timing. */
  metadata: {
    /** Execution start time. ISO 8601 timestamp. */
    startTime: string;

    /** Current pipehead start time. ISO 8601 timestamp. */
    currentNodeStartTime?: string;

    /** Execution trace. Array of trace entries for each executed pipehead. */
    trace: ExecutionTraceEntry[];
  };
}

/**
 * Execution trace entry
 *
 * Represents a single entry in the execution trace. Each pipehead execution
 * produces a trace entry with timing and status information.
 */
export interface ExecutionTraceEntry {
  /** Pipehead ID. */
  nodeId: string;

  /** Pipehead type. */
  nodeType: 'required' | 'enrichment' | 'ingress';

  /** Start time. ISO 8601 timestamp. */
  startTime: string;

  /** End time. ISO 8601 timestamp. Present only after pipehead completes. */
  endTime?: string;

  /** Duration in milliseconds. Present only after pipehead completes. */
  duration?: number;

  /** Status. */
  status: 'pending' | 'running' | 'completed' | 'failed';

  /** Error message. Present only if pipehead failed. */
  error?: string;
}

/**
 * DAG configuration
 *
 * Defines the structure of the Directed Acyclic Graph (DAG) for pipeline execution.
 * The DAG consists of required pipeheads and analyst-configurable enrichment pipeheads.
 */
export interface DAGConfig {
  /** Required pipeheads. Pipeheads that are always present in the DAG (e.g., 'analyst', 'execution', 'observer'). */
  requiredNodes: string[];

  /** Enrichment pipeheads. Map of pipehead ID to enrichment pipehead configuration. */
  enrichmentNodes: Map<string, EnrichmentNodeConfig>;

  /** DAG edges. Map of source pipehead ID to array of target pipehead IDs. */
  edges: Map<string, string[]>;
}

/**
 * DAG build result
 *
 * Result of building a DAG from analyst configuration.
 * Includes the DAG configuration and any build errors or warnings.
 */
export interface DAGBuildResult {
  /** Whether the DAG was built successfully. */
  success: boolean;

  /** DAG configuration. Present only if build succeeded. */
  config?: DAGConfig;

  /** Build errors. Present only if build failed. */
  errors?: string[];

  /** Build warnings. Present for non-critical issues. */
  warnings?: string[];
}

/**
 * DAG execution result
 *
 * Result of executing a DAG. Includes the final state and execution metrics.
 */
export interface DAGExecutionResult {
  /** Whether the execution was successful. */
  success: boolean;

  /** Final state. Present only if execution succeeded. */
  state?: PipelineState;

  /** Execution errors. Present only if execution failed. */
  errors?: string[];

  /** Execution warnings. Present for non-critical issues. */
  warnings?: string[];

  /** Execution metrics. */
  metrics: {
    /** Total execution time in milliseconds. */
    totalTime: number;

    /** Number of pipeheads executed. */
    nodesExecuted: number;

    /** Number of pipeheads failed. */
    nodesFailed: number;
  };
}

/**
 * Node execution context
 *
 * Provides additional context to nodes during execution.
 */
export interface NodeExecutionContext {
  /** Node ID. */
  nodeId: string;

  /** Node type. */
  nodeType: 'required' | 'enrichment' | 'ingress';

  /** Plugin ID. */
  pluginId: string;

  /** Execution start time. */
  startTime: number;

  /** Whether this node is optional. */
  optional?: boolean;

  /** Whether this node can run in parallel. */
  parallel?: boolean;
}

/**
 * Parallel execution options
 *
 * Options for controlling parallel execution of nodes.
 */
export interface ParallelExecutionOptions {
  /** Maximum number of parallel nodes. */
  maxParallelNodes?: number;

  /** Timeout for parallel execution in milliseconds. */
  timeout?: number;

  /** Whether to fail fast on first error. */
  failFast?: boolean;
}

/**
 * DAG validation result
 *
 * Result of validating a DAG configuration.
 */
export interface DAGValidationResult {
  /** Whether the DAG is valid. */
  valid: boolean;

  /** Validation errors. */
  errors: string[];

  /** Validation warnings. */
  warnings: string[];

  /** Detected cycles. Array of node IDs involved in cycles. */
  cycles?: string[][];
}

/**
 * Type guard to check if an object is a Pipehead
 */
export function isPipehead(obj: unknown): obj is Pipehead {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const pipehead = obj as unknown as Record<string, unknown>;

  return (
    typeof pipehead.id === 'string' &&
    (pipehead.type === 'required' || pipehead.type === 'enrichment' || pipehead.type === 'ingress') &&
    typeof pipehead.plugin === 'string' &&
    typeof pipehead.execute === 'function'
  );
}

/**
 * Type guard to check if an object is a PipelineState
 */
export function isPipelineState(obj: unknown): obj is PipelineState {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const state = obj as unknown as Record<string, unknown>;
  const metadata = state.metadata as unknown as Record<string, unknown> | undefined;

  return (
    typeof state.signalId === 'string' &&
    state.rawSignal !== undefined &&
    state.enrichmentResults instanceof Map &&
    typeof state.analystConfig === 'object' &&
    state.analystConfig !== null &&
    typeof metadata === 'object' &&
    metadata !== null &&
    typeof metadata.startTime === 'string' &&
    Array.isArray(metadata.trace)
  );
}

/**
 * Pipehead metadata interface
 *
 * Provides additional information about a pipehead.
 */
export interface PipeheadMetadata {
  /** Pipehead ID */
  id: string;

  /** Pipehead type */
  type: 'required' | 'enrichment' | 'ingress';

  /** Pipehead version */
  version: string;

  /** Pipehead name */
  name: string;

  /** Pipehead description */
  description: string;

  /** Pipehead author */
  author?: string;

  /** Pipehead tags for categorization */
  tags?: string[];

  /** Whether the pipehead is deprecated */
  deprecated?: boolean;

  /** Minimum required AFI version */
  minAfiVersion?: string;

  /** Maximum compatible AFI version */
  maxAfiVersion?: string;
}

/**
 * Pipehead configuration interface
 *
 * Defines the static configuration of a pipehead without execution logic.
 *
 * Why "PipeheadConfig"? Because even pipeheads need to know how to configure themselves!
 */
export interface PipeheadConfig {
  /** Pipehead ID */
  id: string;

  /** Pipehead type */
  type: 'required' | 'enrichment' | 'ingress';

  /** Pipehead identifier */
  plugin: string;

  /** Whether this pipehead can run in parallel */
  parallel?: boolean;

  /** Pipehead dependencies */
  dependencies?: string[];

  /** Pipehead-specific configuration */
  config?: Record<string, unknown>;
}

/**
 * Abstract base class for pipeheads.
 *
 * Provides common functionality for all pipehead implementations including:
 * - Trace entry creation
 * - Error handling
 * - State management utilities
 *
 * Why "BasePipehead"? Because every pipehead needs a good foundation!
 */
export abstract class BasePipehead implements Pipehead {
  abstract id: string;
  abstract type: 'required' | 'enrichment' | 'ingress';
  abstract plugin: string;
  abstract parallel?: boolean;
  abstract dependencies?: string[];

  /**
   * Executes the pipehead with automatic trace entry management.
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
   */
  async execute(state: PipelineState): Promise<PipelineState> {
    const startTime = Date.now();
    const startTimeIso = new Date(startTime).toISOString();

    // Create a trace entry for the start of execution
    const traceEntry: ExecutionTraceEntry = {
      nodeId: this.id,
      nodeType: this.type,
      startTime: startTimeIso,
      status: 'running',
    };

    try {
      // Execute the pipehead logic
      const result = await this.executeInternal(state);

      // Update trace entry with completion status
      const endTime = Date.now();
      const endTimeIso = new Date(endTime).toISOString();
      const duration = endTime - startTime;

      const completedTraceEntry: ExecutionTraceEntry = {
        ...traceEntry,
        endTime: endTimeIso,
        duration,
        status: 'completed',
      };

      result.metadata.trace.push(completedTraceEntry);

      return result;
    } catch (error) {
      // Update trace entry with failure status
      const endTime = Date.now();
      const endTimeIso = new Date(endTime).toISOString();
      const duration = endTime - startTime;

      const failedTraceEntry: ExecutionTraceEntry = {
        ...traceEntry,
        endTime: endTimeIso,
        duration,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };

      state.metadata.trace.push(failedTraceEntry);

      throw error;
    }
  }

  /**
   * Internal execution method to be implemented by subclasses.
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
   * @protected
   */
  protected abstract executeInternal(state: PipelineState): Promise<PipelineState>;
}

/**
 * Type guard to check if an object is an ExecutionTraceEntry
 */
export function isExecutionTraceEntry(obj: unknown): obj is ExecutionTraceEntry {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const entry = obj as unknown as Record<string, unknown>;

  return (
    typeof entry.nodeId === 'string' &&
    (entry.nodeType === 'required' || entry.nodeType === 'enrichment' || entry.nodeType === 'ingress') &&
    typeof entry.startTime === 'string' &&
    (entry.status === 'pending' || entry.status === 'running' || entry.status === 'completed' || entry.status === 'failed')
  );
}
