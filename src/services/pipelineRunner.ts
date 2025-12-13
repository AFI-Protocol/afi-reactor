/**
 * Pipeline Runner
 * 
 * Generic helper for executing linear pipelines defined by PipelineStage configs.
 * This is a stepping stone toward a full DAG engine - it handles sequential execution
 * of plugin and internal stages without introducing parallelism or branching yet.
 * 
 * Future: This runner will be extended to support:
 * - Parallel stage groups
 * - Conditional branching
 * - DAG topology sorting
 * - Stage dependencies and fan-in/fan-out
 * 
 * @module pipelineRunner
 */

import { pathToFileURL } from "url";
import path from "path";
import type { PipelineStage } from "../config/froggyPipeline.js";

/**
 * Pipeline execution context.
 * Provides shared state and utilities to all stages.
 */
export interface PipelineContext {
  /** Logger function (optional) */
  logger?: (message: string) => void;
  
  /** Environment info (optional) */
  env?: Record<string, string | undefined>;
  
  /** Demo mode flag (optional) */
  isDemo?: boolean;
  
  /** Include stage summaries flag (optional) */
  includeStageSummaries?: boolean;
  
  /** Allow additional context fields */
  [key: string]: unknown;
}

/**
 * Stage execution result.
 * Contains metadata about a single stage's execution, including orchestration fields.
 */
export interface StageResult {
  /** Stage identifier */
  stageId: string;

  /** Human-readable label */
  label?: string;

  /** Stage type */
  kind: "plugin" | "internal";

  /** Stage category */
  category?: string;

  /** Persona/agent responsible */
  persona?: string;

  // ========== Orchestration Metadata Snapshot ==========
  // These fields are copied from PipelineStage for observability.
  // They do not affect runtime behavior yet.

  /** Soft per-stage timeout hint in milliseconds (future use) */
  timeoutMs?: number;

  /** Maximum retry attempts on failure (future use) */
  maxRetries?: number;

  /** Delay between retry attempts in milliseconds (future use) */
  retryDelayMs?: number;

  /** Logical group identifier for future parallel execution clusters */
  group?: string;

  /** Stage IDs that must complete before this stage can run (future DAG dependencies) */
  dependsOn?: string[];

  /** Whether failure of this stage should fail the entire pipeline (future use) */
  critical?: boolean;

  /** Arbitrary tags for filtering/grouping */
  tags?: string[];

  // ========== Execution Results ==========

  /** Execution status */
  status: "success" | "error";

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Error object if status is "error" */
  error?: Error;

  /** Stage output payload */
  output: unknown;
}

/**
 * Pipeline execution result.
 * Contains the final payload and optional metadata.
 */
export interface PipelineResult<T = any> {
  /** Final payload after all stages */
  payload: T;

  /** Stage execution metadata with orchestration fields */
  stageMeta?: StageResult[];

  /** Intermediate payloads from each stage (optional, for debugging/summaries) */
  intermediatePayloads?: Map<string, any>;
}

/**
 * Execute a linear pipeline of stages.
 *
 * This function iterates through stages sequentially, calling each plugin's
 * run() function or internal handler with the current payload.
 *
 * Error handling:
 * - Plugin import errors: logged and re-thrown (fail-fast)
 * - Plugin execution errors: logged and re-thrown (fail-fast)
 * - Internal stage errors: logged and re-thrown (fail-fast)
 *
 * @param stages - Array of pipeline stages to execute
 * @param initialPayload - Initial payload to pass to first stage
 * @param context - Execution context (logger, env, etc.)
 * @param internalHandlers - Map of internal stage handlers (stageId → handler function)
 * @param pluginRegistry - Optional map of pre-loaded plugins (stageId → plugin instance)
 * @returns Pipeline result with final payload
 */
export async function runPipeline<T = any>(
  stages: PipelineStage[],
  initialPayload: any,
  context: PipelineContext = {},
  internalHandlers: Map<string, (payload: any, context: PipelineContext) => Promise<any>> = new Map(),
  pluginRegistry?: Map<string, any>
): Promise<PipelineResult<T>> {
  const logger = context.logger || console.log;
  const stageMeta: StageResult[] = [];
  const intermediatePayloads = new Map<string, any>();

  let currentPayload = initialPayload;

  // Store initial payload
  intermediatePayloads.set("__initial__", initialPayload);
  
  for (const stage of stages) {
    const startTime = Date.now();
    
    try {
      if (stage.kind === "plugin") {
        // Load plugin from registry or dynamic import
        let plugin;

        if (pluginRegistry && pluginRegistry.has(stage.id)) {
          // Use pre-loaded plugin from registry
          plugin = pluginRegistry.get(stage.id);
        } else {
          // Fall back to dynamic import
          if (!stage.pluginPath) {
            throw new Error(`Plugin stage "${stage.id}" missing pluginPath and not in registry`);
          }

          // Resolve plugin path
          // Use .js extension for compiled output (dist/)
          // Jest/ts-node will automatically resolve .ts files
          const pluginPath = path.resolve(stage.pluginPath + ".js");
          const pluginUrl = pathToFileURL(pluginPath).href;

          // Dynamic import
          const pluginModule = await import(pluginUrl);
          plugin = pluginModule.default;
        }

        if (typeof plugin?.run !== "function") {
          throw new Error(`Plugin "${stage.id}" does not export a valid 'run' function`);
        }

        // Build log message with optional orchestration metadata
        const logParts = [`🔧 Running plugin stage: ${stage.id} (${stage.label || stage.id})`];
        if (stage.group) logParts.push(`[group: ${stage.group}]`);
        if (stage.tags && stage.tags.length > 0) logParts.push(`[tags: ${stage.tags.join(", ")}]`);
        logger(logParts.join(" "));

        // Execute plugin
        currentPayload = await plugin.run(currentPayload);
        
      } else if (stage.kind === "internal") {
        // Execute internal handler
        const handler = internalHandlers.get(stage.id);

        if (!handler) {
          throw new Error(`Internal stage "${stage.id}" has no registered handler`);
        }

        // Build log message with optional orchestration metadata
        const logParts = [`🔧 Running internal stage: ${stage.id} (${stage.label || stage.id})`];
        if (stage.group) logParts.push(`[group: ${stage.group}]`);
        if (stage.tags && stage.tags.length > 0) logParts.push(`[tags: ${stage.tags.join(", ")}]`);
        logger(logParts.join(" "));

        // Execute internal handler
        currentPayload = await handler(currentPayload, context);
        
      } else {
        throw new Error(`Unknown stage kind: ${(stage as any).kind}`);
      }

      const duration = Date.now() - startTime;

      // Build StageResult with orchestration metadata
      const stageResult: StageResult = {
        stageId: stage.id,
        label: stage.label,
        kind: stage.kind,
        category: stage.category,
        persona: stage.persona,

        // Copy orchestration fields from stage config
        timeoutMs: stage.timeoutMs,
        maxRetries: stage.maxRetries,
        retryDelayMs: stage.retryDelayMs,
        group: stage.group,
        dependsOn: stage.dependsOn,
        critical: stage.critical,
        tags: stage.tags,

        // Execution results
        status: "success",
        durationMs: duration,
        output: currentPayload,
      };

      stageMeta.push(stageResult);

      // Store intermediate payload
      intermediatePayloads.set(stage.id, currentPayload);

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Build StageResult with orchestration metadata (error case)
      const stageResult: StageResult = {
        stageId: stage.id,
        label: stage.label,
        kind: stage.kind,
        category: stage.category,
        persona: stage.persona,

        // Copy orchestration fields from stage config
        timeoutMs: stage.timeoutMs,
        maxRetries: stage.maxRetries,
        retryDelayMs: stage.retryDelayMs,
        group: stage.group,
        dependsOn: stage.dependsOn,
        critical: stage.critical,
        tags: stage.tags,

        // Execution results (error)
        status: "error",
        durationMs: duration,
        error: error instanceof Error ? error : new Error(String(error)),
        output: currentPayload, // Last known good payload
      };

      stageMeta.push(stageResult);

      logger(`❌ Stage "${stage.id}" failed: ${errorMessage}`);
      throw error; // Fail-fast: re-throw to stop pipeline
    }
  }
  
  return {
    payload: currentPayload as T,
    stageMeta,
    intermediatePayloads,
  };
}

/**
 * Execute a DAG-aware pipeline of stages.
 *
 * This function respects stage dependencies (dependsOn) and executes stages
 * in parallel batches using Promise.all when possible.
 *
 * Execution model:
 * - Stages with no dependencies (or empty dependsOn) receive initialPayload
 * - Stages with a single dependency receive that parent's output payload
 * - Stages with multiple dependencies receive: { parents: string[], inputs: Record<string, any> }
 *
 * Final payload:
 * - If there is exactly one sink node (stage with no dependents), return its payload
 * - If multiple sink nodes exist, return an object mapping sink IDs to their payloads
 *
 * Error handling:
 * - Validates all stage IDs are unique
 * - Validates all dependsOn references exist
 * - Detects cycles using Kahn's algorithm
 * - Fail-fast: if any stage fails, abort and throw after populating metadata
 *
 * @param stages - Array of pipeline stages with dependencies
 * @param initialPayload - Initial payload for stages with no dependencies
 * @param context - Execution context (logger, env, etc.)
 * @param internalHandlers - Map of internal stage handlers
 * @param pluginRegistry - Optional map of pre-loaded plugins
 * @returns Pipeline result with final payload
 */
export async function runPipelineDag<T = any>(
  stages: PipelineStage[],
  initialPayload: any,
  context: PipelineContext = {},
  internalHandlers: Map<string, (payload: any, ctx: PipelineContext) => Promise<any>> = new Map(),
  pluginRegistry?: Map<string, any>
): Promise<PipelineResult<T>> {
  const logger = context.logger || console.log;
  const stageMeta: StageResult[] = [];
  const intermediatePayloads = new Map<string, any>();

  // Build stage map and validate
  const stageMap = new Map<string, PipelineStage>();
  for (const stage of stages) {
    if (stageMap.has(stage.id)) {
      throw new Error(`Duplicate stage ID: "${stage.id}"`);
    }
    stageMap.set(stage.id, stage);
  }

  // Validate all dependsOn references exist
  for (const stage of stages) {
    if (stage.dependsOn) {
      for (const depId of stage.dependsOn) {
        if (!stageMap.has(depId)) {
          throw new Error(`Stage "${stage.id}" depends on unknown stage "${depId}"`);
        }
      }
    }
  }

  // Detect cycles using Kahn's algorithm (topological sort)
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>(); // parent -> children

  for (const stage of stages) {
    inDegree.set(stage.id, (stage.dependsOn || []).length);

    // Build reverse dependency graph
    if (stage.dependsOn) {
      for (const parentId of stage.dependsOn) {
        if (!dependents.has(parentId)) {
          dependents.set(parentId, new Set());
        }
        dependents.get(parentId)!.add(stage.id);
      }
    }
  }

  // Kahn's algorithm to detect cycles
  const queue: string[] = [];
  const sorted: string[] = [];

  for (const [stageId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(stageId);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    const children = dependents.get(current);
    if (children) {
      for (const childId of children) {
        const newDegree = inDegree.get(childId)! - 1;
        inDegree.set(childId, newDegree);
        if (newDegree === 0) {
          queue.push(childId);
        }
      }
    }
  }

  if (sorted.length !== stages.length) {
    throw new Error(`Cycle detected in pipeline dependencies. Sorted ${sorted.length} of ${stages.length} stages.`);
  }

  // Execute stages in batches
  const completed = new Set<string>();
  const payloads = new Map<string, any>();

  // Store initial payload
  intermediatePayloads.set("__initial__", initialPayload);

  while (completed.size < stages.length) {
    // Find ready stages (all dependencies completed, not yet started)
    const ready: PipelineStage[] = [];

    for (const stage of stages) {
      if (completed.has(stage.id)) {
        continue; // Already done
      }

      const deps = stage.dependsOn || [];
      const allDepsCompleted = deps.every(depId => completed.has(depId));

      if (allDepsCompleted) {
        ready.push(stage);
      }
    }

    if (ready.length === 0) {
      // No progress possible - should not happen if cycle detection worked
      throw new Error(`Pipeline stuck: no ready stages but ${stages.length - completed.size} incomplete`);
    }

    // Execute ready stages in parallel
    await Promise.all(
      ready.map(async (stage) => {
        const startTime = Date.now();

        try {
          // Determine input payload
          let inputPayload: any;

          if (!stage.dependsOn || stage.dependsOn.length === 0) {
            // No dependencies: use initial payload
            inputPayload = initialPayload;
          } else if (stage.dependsOn.length === 1) {
            // Single dependency: use parent's output
            inputPayload = payloads.get(stage.dependsOn[0]);
          } else {
            // Multiple dependencies: provide structured input
            const inputs: Record<string, any> = {};
            for (const parentId of stage.dependsOn) {
              inputs[parentId] = payloads.get(parentId);
            }
            inputPayload = {
              parents: stage.dependsOn,
              inputs,
            };
          }

          // Execute stage
          let outputPayload: any;

          if (stage.kind === "plugin") {
            // Load plugin from registry or dynamic import
            let plugin;

            if (pluginRegistry && pluginRegistry.has(stage.id)) {
              plugin = pluginRegistry.get(stage.id);
            } else {
              if (!stage.pluginPath) {
                throw new Error(`Plugin stage "${stage.id}" missing pluginPath and not in registry`);
              }

              const pluginPath = path.resolve(stage.pluginPath + ".js");
              const pluginUrl = pathToFileURL(pluginPath).href;
              const pluginModule = await import(pluginUrl);
              plugin = pluginModule.default;
            }

            if (typeof plugin?.run !== "function") {
              throw new Error(`Plugin "${stage.id}" does not export a valid 'run' function`);
            }

            const logParts = [`🔧 Running plugin stage: ${stage.id} (${stage.label || stage.id})`];
            if (stage.group) logParts.push(`[group: ${stage.group}]`);
            if (stage.tags && stage.tags.length > 0) logParts.push(`[tags: ${stage.tags.join(", ")}]`);
            logger(logParts.join(" "));

            outputPayload = await plugin.run(inputPayload);

          } else if (stage.kind === "internal") {
            const handler = internalHandlers.get(stage.id);

            if (!handler) {
              throw new Error(`Internal stage "${stage.id}" has no registered handler`);
            }

            const logParts = [`🔧 Running internal stage: ${stage.id} (${stage.label || stage.id})`];
            if (stage.group) logParts.push(`[group: ${stage.group}]`);
            if (stage.tags && stage.tags.length > 0) logParts.push(`[tags: ${stage.tags.join(", ")}]`);
            logger(logParts.join(" "));

            outputPayload = await handler(inputPayload, context);

          } else {
            throw new Error(`Unknown stage kind: ${(stage as any).kind}`);
          }

          const duration = Date.now() - startTime;

          // Build StageResult
          const stageResult: StageResult = {
            stageId: stage.id,
            label: stage.label,
            kind: stage.kind,
            category: stage.category,
            persona: stage.persona,

            // Orchestration metadata
            timeoutMs: stage.timeoutMs,
            maxRetries: stage.maxRetries,
            retryDelayMs: stage.retryDelayMs,
            group: stage.group,
            dependsOn: stage.dependsOn,
            critical: stage.critical,
            tags: stage.tags,

            // Execution results
            status: "success",
            durationMs: duration,
            output: outputPayload,
          };

          stageMeta.push(stageResult);
          payloads.set(stage.id, outputPayload);
          intermediatePayloads.set(stage.id, outputPayload);
          completed.add(stage.id);

        } catch (error) {
          const duration = Date.now() - startTime;
          const errorMessage = error instanceof Error ? error.message : String(error);

          // Build StageResult (error case)
          const stageResult: StageResult = {
            stageId: stage.id,
            label: stage.label,
            kind: stage.kind,
            category: stage.category,
            persona: stage.persona,

            // Orchestration metadata
            timeoutMs: stage.timeoutMs,
            maxRetries: stage.maxRetries,
            retryDelayMs: stage.retryDelayMs,
            group: stage.group,
            dependsOn: stage.dependsOn,
            critical: stage.critical,
            tags: stage.tags,

            // Execution results (error)
            status: "error",
            durationMs: duration,
            error: error instanceof Error ? error : new Error(String(error)),
            output: undefined,
          };

          stageMeta.push(stageResult);

          logger(`❌ Stage "${stage.id}" failed: ${errorMessage}`);
          throw error; // Fail-fast
        }
      })
    );
  }

  // Determine final payload
  // Find sink nodes (stages that no other stage depends on)
  const sinkNodes: string[] = [];

  for (const stage of stages) {
    const hasDependents = dependents.has(stage.id) && dependents.get(stage.id)!.size > 0;
    if (!hasDependents) {
      sinkNodes.push(stage.id);
    }
  }

  let finalPayload: any;

  if (sinkNodes.length === 1) {
    // Single sink: return its payload
    finalPayload = payloads.get(sinkNodes[0]);
  } else if (sinkNodes.length > 1) {
    // Multiple sinks: return object mapping sink IDs to payloads
    finalPayload = {};
    for (const sinkId of sinkNodes) {
      finalPayload[sinkId] = payloads.get(sinkId);
    }
  } else {
    // No sinks (shouldn't happen with valid DAG)
    finalPayload = undefined;
  }

  return {
    payload: finalPayload as T,
    stageMeta,
    intermediatePayloads,
  };
}

