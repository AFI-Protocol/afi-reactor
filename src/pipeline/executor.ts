/**
 * GraphExecutor — the manifest-driven DAG executor of the V1 configurable
 * pipelines program (W3 spec section 2; evolved from runPipelineDag, which
 * stays untouched until the cleanup PR).
 *
 * Semantics (all FIXED by the spec):
 *  - Kahn waves over the manifest edges; Promise.all within a wave (bounded
 *    by a configurable concurrency limit, default 4); deterministic ordering
 *    (every ready-set is sorted by nodeId).
 *  - Per-node timeout via AbortController (node.timeoutMs, else the bound
 *    plugin manifest's defaultTimeoutMs); the abort signal is handed to the
 *    node ctx so underlying fetches can honor it.
 *  - maxRetries / retryDelayMs / backoff (none|fixed|exponential) honored —
 *    node values first, plugin defaultRetryPolicy as fallback. NO retry on
 *    NodeConfigurationError or on abort.
 *  - Pipeline-wide cancellation through one root AbortController (an
 *    external abortSignal aborts everything in flight).
 *  - Conditional edges: the governed predicate tree is evaluated against the
 *    settled nodes' validated outputs + pipeline context; false → edge
 *    inactive. A node whose ALL incoming edges are inactive is 'skipped'
 *    (recorded). Skip propagates — a skipped node's outgoing edges are
 *    inactive — EXCEPT into joins over an optional:true edge, where the
 *    skipped (or failed-optional) parent contributes an EMPTY namespace.
 *  - Joins: parent outputs delivered as { parents: { <nodeId>: output } } —
 *    NO hardcoded parent ids anywhere; branch-completion-order independent
 *    by construction (inputs keyed by nodeId; merge visits sorted nodeIds).
 *  - Failure taxonomy: NodeConfigurationError is ALWAYS fatal (D-FCP-8);
 *    other errors retry per policy, then abort the pipeline (critical, the
 *    default) or settle the node as 'failed-optional' (critical:false +
 *    failurePolicy 'degrade') whose contribution is its input passthrough
 *    (single-parent consumers) or an empty namespace (joins). A resolved
 *    node with recorded degradations settles 'degraded' and its output IS
 *    used (real partial data, never fabricated).
 *  - Result extraction from the manifest's single scorer sink.
 *  - Structured per-node logs/metrics { nodeId, status, durationMs, attempt }
 *    — operational only, NEVER hash material.
 *  - Execution summary: canonical, timestamp-free, ordered by wave then
 *    nodeId (src/pipeline/executionSummary.ts) + executionSummaryHash.
 */
import type { CanonicalUss } from "../types/canonicalUss.js";
import { evaluatePredicate, type ConditionEnv } from "./conditions.js";
import {
  buildExecutionSummary,
  computeExecutionSummaryHash,
  type ExecutionSummary,
  type ExecutionSummaryEntry,
  type NodeExecutionStatus,
} from "./executionSummary.js";
import type { CanonicalHashRef } from "./hashing.js";
import type {
  AnalysisPluginManifest,
  PipelineEdge,
  PipelineManifest,
  PipelineNode,
} from "./manifestTypes.js";
import {
  NodeConfigurationError,
  SILENT_NODE_LOGGER,
  type AnalysisNodePlugin,
  type NodeDegradation,
  type NodeLogger,
  type NodeResult,
} from "./nodeSdk.js";
import { pluginKey, type PluginRegistry } from "./pluginRegistry.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** The manifest violates a graph-semantic invariant (x-afiConstraints). */
export class GraphValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`pipeline manifest violates graph invariants: ${issues.join("; ")}`);
    this.name = "GraphValidationError";
    this.issues = issues;
  }
}

/** The run was cancelled through the external abort signal. */
export class PipelineAbortedError extends Error {
  constructor(reason?: unknown) {
    super(
      `pipeline execution aborted${reason !== undefined ? `: ${String(reason)}` : ""}`
    );
    this.name = "PipelineAbortedError";
  }
}

/** A node exhausted its policy and the failure is fatal for the run. */
export class NodeExecutionError extends Error {
  readonly nodeId: string;
  readonly fatalReason: "configuration" | "critical-failure";
  constructor(nodeId: string, fatalReason: "configuration" | "critical-failure", cause: unknown) {
    super(
      `node '${nodeId}' failed (${fatalReason}): ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = "NodeExecutionError";
    this.nodeId = nodeId;
    this.fatalReason = fatalReason;
    (this as { cause?: unknown }).cause = cause;
  }
}

/** A per-node attempt exceeded its timeout budget. */
export class NodeTimeoutError extends Error {
  constructor(nodeId: string, timeoutMs: number) {
    super(`node '${nodeId}' timed out after ${timeoutMs}ms`);
    this.name = "NodeTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// Graph validation (the x-afiConstraints invariants; shared with boot)
// ---------------------------------------------------------------------------

/** Returns the list of violated graph invariants (empty = admissible). */
export function validatePipelineGraph(manifest: PipelineManifest): string[] {
  const issues: string[] = [];
  const ids = manifest.nodes.map((n) => n.id);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) issues.push("node ids are not unique");
  if (!idSet.has(manifest.entry)) issues.push(`entry '${manifest.entry}' is not a declared node`);

  for (const e of manifest.edges) {
    if (!idSet.has(e.from)) issues.push(`edge from undeclared node '${e.from}'`);
    if (!idSet.has(e.to)) issues.push(`edge to undeclared node '${e.to}'`);
    if (e.from === e.to) issues.push(`self-edge on '${e.from}'`);
  }

  const scorers = manifest.nodes.filter((n) => n.category === "scorer");
  if (scorers.length !== 1) {
    issues.push(`exactly one scorer node required, found ${scorers.length}`);
  }

  const incoming = new Map<string, PipelineEdge[]>();
  const outgoing = new Map<string, PipelineEdge[]>();
  for (const id of ids) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const e of manifest.edges) {
    incoming.get(e.to)?.push(e);
    outgoing.get(e.from)?.push(e);
  }

  // Acyclicity (Kahn).
  const indegree = new Map<string, number>(ids.map((id) => [id, incoming.get(id)?.length ?? 0]));
  const queue = ids.filter((id) => indegree.get(id) === 0).sort();
  let visited = 0;
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    order.push(id);
    for (const e of outgoing.get(id) ?? []) {
      const d = (indegree.get(e.to) ?? 0) - 1;
      indegree.set(e.to, d);
      if (d === 0) queue.push(e.to);
    }
    queue.sort();
  }
  if (visited !== ids.length) issues.push("edge set contains a cycle");

  if (scorers.length === 1 && visited === ids.length) {
    const scorer = scorers[0];
    if ((outgoing.get(scorer.id) ?? []).length > 0) {
      issues.push(`scorer '${scorer.id}' must be a sink (no outgoing edges)`);
    }
    // Reachability from entry.
    const reachable = new Set<string>([manifest.entry]);
    const stack = [manifest.entry];
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const e of outgoing.get(id) ?? []) {
        if (!reachable.has(e.to)) {
          reachable.add(e.to);
          stack.push(e.to);
        }
      }
    }
    for (const id of ids) {
      if (!reachable.has(id)) issues.push(`node '${id}' is not reachable from entry`);
    }
    // Non-bypassable scorer: the scorer must be the ONLY sink.
    for (const id of ids) {
      if ((outgoing.get(id) ?? []).length === 0 && id !== scorer.id) {
        issues.push(`non-scorer sink '${id}' makes the scorer bypassable`);
      }
    }
  }

  // Join declarations.
  for (const node of manifest.nodes) {
    const parents = incoming.get(node.id) ?? [];
    if (parents.length > 1 && !node.join) {
      issues.push(`node '${node.id}' has ${parents.length} parents but declares no join`);
    }
    if (parents.length <= 1 && node.join) {
      issues.push(`node '${node.id}' declares a join but has ${parents.length} parent(s)`);
    }
    const rule = node.join?.merge?.conflictRule;
    if (rule && rule.startsWith("prefer:")) {
      const preferred = rule.slice("prefer:".length);
      if (!parents.some((e) => e.from === preferred)) {
        issues.push(
          `node '${node.id}' conflictRule '${rule}' does not name one of its parents`
        );
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/** Operational metric event (never hash material). */
export interface NodeMetricEvent {
  nodeId: string;
  status: "success" | "failure" | "timeout" | "retry" | "skipped";
  durationMs: number;
  attempt: number;
}

export type IoValidator = (
  schemaRef: string,
  value: unknown,
  direction: "input" | "output",
  nodeId: string
) => { ok: boolean; errors?: string[] } | undefined;

export interface GraphExecutorOptions {
  registry: PluginRegistry;
  /**
   * The bound plugin manifests keyed by 'pluginId@pluginVersion' (from the
   * validated analysis-plugins registry) — source of defaultTimeoutMs /
   * defaultRetryPolicy and of the input/output schema refs handed to the
   * ioValidator.
   */
  pluginManifests?: ReadonlyMap<string, AnalysisPluginManifest>;
  /** Wave-level concurrency limit (default 4). */
  concurrency?: number;
  logger?: NodeLogger;
  /** Structured per-node metrics hook: { nodeId, status, durationMs, attempt }. */
  onNodeEvent?: (event: NodeMetricEvent) => void;
  /**
   * I/O validation hook against the plugin manifest's schema refs. The refs
   * are governed schema IDENTIFIERS; refs the resolver does not know return
   * undefined (recorded as unvalidated — the contract schemas of the vendored
   * closure are boot-validated separately).
   */
  ioValidator?: IoValidator;
  /** Injectable delay (tests); must reject with PipelineAbortedError on abort. */
  sleep?: (ms: number, abort: AbortSignal) => Promise<void>;
}

export interface ExecuteRequest {
  manifest: PipelineManifest;
  /** The entry node's input value. */
  input: unknown;
  /** The canonical USS signal (ctx.signal for every node). */
  signal: CanonicalUss;
  /** Pipeline context addressable by predicates under /context/... */
  context?: Record<string, unknown>;
  /** External cancellation. */
  abortSignal?: AbortSignal;
}

export interface NodeRuntimeRecord {
  nodeId: string;
  pluginId: string;
  pluginVersion: string;
  status: NodeExecutionStatus;
  wave: number;
  attempts: number;
  durationMs: number;
  degradations: NodeDegradation[];
  /** Present for executed/degraded nodes. */
  output?: unknown;
  /** Present for failed-optional nodes. */
  error?: string;
}

export interface GraphExecutionResult {
  /** The single scorer sink's output. */
  result: unknown;
  summary: ExecutionSummary;
  executionSummaryHash: CanonicalHashRef;
  /** Operational per-node records (metrics/logging only — never hashed). */
  nodes: NodeRuntimeRecord[];
}

type SettledStatus = "executed" | "degraded" | "skipped" | "failed-optional";

interface NodeState {
  node: PipelineNode;
  status: "pending" | SettledStatus;
  output?: unknown;
  /** The input the node received (delivered on scheduling; passthrough source). */
  deliveredInput?: unknown;
  degradations: NodeDegradation[];
  attempts: number;
  durationMs: number;
  wave: number;
  error?: unknown;
}

function defaultSleep(ms: number, abort: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (abort.aborted) {
      reject(new PipelineAbortedError(abort.reason));
      return;
    }
    const timer = setTimeout(() => {
      abort.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new PipelineAbortedError(abort.reason));
    };
    abort.addEventListener("abort", onAbort, { once: true });
  });
}

/** Rejects when the signal aborts (used to race plugin runs). */
function abortRejection(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let onAbort: (() => void) | undefined;
  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new PipelineAbortedError(signal.reason));
      return;
    }
    onAbort = () =>
      reject(signal.reason instanceof Error ? signal.reason : new PipelineAbortedError(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  // Swallow the rejection when nobody is racing it anymore.
  promise.catch(() => {});
  return {
    promise,
    dispose: () => {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    },
  };
}

/** Simple FIFO semaphore — nodes START in sorted order within a wave. */
class Semaphore {
  private available: number;
  private queue: Array<() => void> = [];
  constructor(limit: number) {
    this.available = Math.max(1, limit);
  }
  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.available += 1;
  }
}

export class GraphExecutor {
  private readonly registry: PluginRegistry;
  private readonly pluginManifests?: ReadonlyMap<string, AnalysisPluginManifest>;
  private readonly concurrency: number;
  private readonly logger: NodeLogger;
  private readonly onNodeEvent?: (event: NodeMetricEvent) => void;
  private readonly ioValidator?: IoValidator;
  private readonly sleep: (ms: number, abort: AbortSignal) => Promise<void>;

  constructor(options: GraphExecutorOptions) {
    this.registry = options.registry;
    this.pluginManifests = options.pluginManifests;
    this.concurrency = options.concurrency ?? 4;
    this.logger = options.logger ?? SILENT_NODE_LOGGER;
    this.onNodeEvent = options.onNodeEvent;
    this.ioValidator = options.ioValidator;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async execute(request: ExecuteRequest): Promise<GraphExecutionResult> {
    const { manifest } = request;
    const issues = validatePipelineGraph(manifest);
    if (issues.length > 0) throw new GraphValidationError(issues);

    const root = new AbortController();
    const externalAbort = request.abortSignal;
    const onExternalAbort = () => root.abort(externalAbort?.reason);
    if (externalAbort) {
      if (externalAbort.aborted) throw new PipelineAbortedError(externalAbort.reason);
      externalAbort.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      return await this.executeGraph(request, root);
    } finally {
      externalAbort?.removeEventListener("abort", onExternalAbort);
      // Release anything still racing the root signal.
      if (!root.signal.aborted) root.abort(new PipelineAbortedError("execution finished"));
    }
  }

  private async executeGraph(
    request: ExecuteRequest,
    root: AbortController
  ): Promise<GraphExecutionResult> {
    const { manifest } = request;
    const states = new Map<string, NodeState>();
    const incoming = new Map<string, PipelineEdge[]>();
    for (const node of manifest.nodes) {
      states.set(node.id, {
        node,
        status: "pending",
        degradations: [],
        attempts: 0,
        durationMs: 0,
        wave: -1,
      });
      incoming.set(node.id, []);
    }
    for (const edge of manifest.edges) incoming.get(edge.to)!.push(edge);

    const conditionEnv: ConditionEnv = {
      nodes: {},
      context: request.context ?? {},
    };
    const summaryEntries: ExecutionSummaryEntry[] = [];
    const semaphore = new Semaphore(this.concurrency);
    const scorerId = manifest.nodes.find((n) => n.category === "scorer")!.id;

    const settle = (state: NodeState, status: SettledStatus, wave: number) => {
      state.status = status;
      state.wave = wave;
      if (status === "executed" || status === "degraded") {
        conditionEnv.nodes[state.node.id] = { output: state.output };
      }
      summaryEntries.push({
        nodeId: state.node.id,
        pluginId: state.node.pluginId,
        pluginVersion: state.node.pluginVersion,
        status,
      });
    };

    /**
     * Edge contribution once the source settled:
     *  'value'    — deliver the (port-projected) output;
     *  'empty'    — deliver an empty namespace (joins over optional edges,
     *               and failed-optional parents at joins);
     *  'inactive' — the edge does not fire.
     */
    const edgeStateFor = (
      edge: PipelineEdge,
      targetIsJoin: boolean
    ): "value" | "empty" | "inactive" => {
      const source = states.get(edge.from)!;
      switch (source.status) {
        case "executed":
        case "degraded": {
          if (edge.condition && !evaluatePredicate(edge.condition, conditionEnv)) {
            return "inactive";
          }
          return "value";
        }
        case "failed-optional":
          // Recorded failure under a declared degrade policy: joins receive
          // an empty namespace; single-parent consumers get the passthrough.
          return targetIsJoin ? "empty" : "value";
        case "skipped":
          // Skip propagates, except optional edges into joins.
          return targetIsJoin && edge.optional === true ? "empty" : "inactive";
        default:
          throw new Error(`edge from unsettled node '${edge.from}'`);
      }
    };

    const contributionOf = (edge: PipelineEdge): unknown => {
      const source = states.get(edge.from)!;
      if (source.status === "failed-optional") {
        // Input passthrough — never fabricated success data.
        return source.deliveredInput;
      }
      const output = source.output;
      if (edge.fromPort !== undefined) {
        if (output === null || typeof output !== "object") return undefined;
        return (output as Record<string, unknown>)[edge.fromPort];
      }
      return output;
    };

    let wave = 0;
    for (;;) {
      if (root.signal.aborted) throw new PipelineAbortedError(root.signal.reason);

      const pendingIds = [...states.values()]
        .filter((s) => s.status === "pending")
        .map((s) => s.node.id);
      if (pendingIds.length === 0) break;

      const ready = pendingIds
        .filter((id) =>
          (incoming.get(id) ?? []).every((e) => states.get(e.from)!.status !== "pending")
        )
        .sort();
      if (ready.length === 0) {
        throw new GraphValidationError(["deadlock: no ready node (cycle should be impossible)"]);
      }

      // Settle skips first (synchronously, in sorted order) — deterministic.
      const runnable: Array<{ id: string; input: unknown }> = [];
      for (const id of ready) {
        const state = states.get(id)!;
        const parents = incoming.get(id) ?? [];
        const isJoin = parents.length > 1;

        if (parents.length === 0) {
          // Entry node: receives the request input.
          runnable.push({ id, input: request.input });
          continue;
        }

        const edgeStates = parents.map((e) => ({ edge: e, state: edgeStateFor(e, isJoin) }));
        if (edgeStates.every((es) => es.state === "inactive")) {
          settle(state, "skipped", wave);
          this.onNodeEvent?.({ nodeId: id, status: "skipped", durationMs: 0, attempt: 0 });
          this.logger.info("node skipped (all incoming edges inactive)", { nodeId: id });
          continue;
        }

        let input: unknown;
        if (isJoin) {
          const parentsMap: Record<string, unknown> = {};
          for (const { edge, state: es } of edgeStates) {
            parentsMap[edge.from] = es === "value" ? contributionOf(edge) : {};
          }
          input = { parents: parentsMap };
        } else {
          input = contributionOf(edgeStates[0].edge);
        }
        runnable.push({ id, input });
      }

      // Run the wave (bounded Promise.all; deterministic start order).
      const settled = await Promise.allSettled(
        runnable.map(async ({ id, input }) => {
          await semaphore.acquire();
          try {
            return await this.runNode(states.get(id)!, input, request, root);
          } finally {
            semaphore.release();
          }
        })
      );

      // Record outcomes in sorted-node order (never completion order).
      let fatal: { nodeId: string; error: unknown } | undefined;
      runnable.forEach(({ id }, index) => {
        const state = states.get(id)!;
        const outcome = settled[index];
        if (outcome.status === "fulfilled") {
          settle(state, outcome.value, wave);
        } else {
          state.error = outcome.reason;
          if (!fatal) fatal = { nodeId: id, error: outcome.reason };
        }
      });

      if (fatal) {
        root.abort(fatal.error);
        if (fatal.error instanceof PipelineAbortedError) throw fatal.error;
        throw new NodeExecutionError(
          fatal.nodeId,
          fatal.error instanceof NodeConfigurationError ? "configuration" : "critical-failure",
          fatal.error
        );
      }

      wave += 1;
    }

    // Result extraction from the single scorer sink.
    const scorerState = states.get(scorerId)!;
    if (scorerState.status !== "executed" && scorerState.status !== "degraded") {
      throw new NodeExecutionError(
        scorerId,
        "critical-failure",
        new Error(`scorer settled '${scorerState.status}' — no scored result was produced`)
      );
    }

    const summary = buildExecutionSummary(summaryEntries);
    return {
      result: scorerState.output,
      summary,
      executionSummaryHash: computeExecutionSummaryHash(summary),
      nodes: [...states.values()].map((s) => ({
        nodeId: s.node.id,
        pluginId: s.node.pluginId,
        pluginVersion: s.node.pluginVersion,
        status: s.status as NodeExecutionStatus,
        wave: s.wave,
        attempts: s.attempts,
        durationMs: s.durationMs,
        degradations: s.degradations,
        output: s.status === "executed" || s.status === "degraded" ? s.output : undefined,
        error:
          s.status === "failed-optional"
            ? s.error instanceof Error
              ? s.error.message
              : String(s.error)
            : undefined,
      })),
    };
  }

  /**
   * Runs one node with timeout + retry policy. Resolves with the node's
   * settled status; rejects when the failure is fatal for the pipeline.
   */
  private async runNode(
    state: NodeState,
    input: unknown,
    request: ExecuteRequest,
    root: AbortController
  ): Promise<"executed" | "degraded" | "failed-optional"> {
    const node = state.node;
    state.deliveredInput = input;

    const plugin: AnalysisNodePlugin | undefined = this.registry.get(
      node.pluginId,
      node.pluginVersion
    );
    if (!plugin) {
      // Boot validation guarantees binding; reaching here is a deployment
      // configuration failure — always fatal.
      throw new NodeConfigurationError(
        `no build-time binding for ${pluginKey(node.pluginId, node.pluginVersion)}`
      );
    }

    const manifest = this.pluginManifests?.get(pluginKey(node.pluginId, node.pluginVersion));
    const timeoutMs = node.timeoutMs ?? manifest?.defaultTimeoutMs;
    const maxRetries = node.maxRetries ?? manifest?.defaultRetryPolicy?.maxRetries ?? 0;
    const retryDelayMs = node.retryDelayMs ?? manifest?.defaultRetryPolicy?.retryDelayMs ?? 0;
    const backoff = node.backoff ?? manifest?.defaultRetryPolicy?.backoff ?? "fixed";

    this.validateIo(manifest?.inputSchemaRef, input, "input", node.id);

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      if (root.signal.aborted) throw new PipelineAbortedError(root.signal.reason);

      const nodeController = new AbortController();
      const onRootAbort = () => nodeController.abort(root.signal.reason);
      root.signal.addEventListener("abort", onRootAbort, { once: true });
      const timer =
        timeoutMs !== undefined
          ? setTimeout(() => nodeController.abort(new NodeTimeoutError(node.id, timeoutMs)), timeoutMs)
          : undefined;
      const racer = abortRejection(nodeController.signal);

      const startedAt = Date.now();
      try {
        const result: NodeResult = await Promise.race([
          plugin.run(input, {
            signal: request.signal,
            config: node.config ?? {},
            logger: this.logger,
            abort: nodeController.signal,
          }),
          racer.promise,
        ]);
        const durationMs = Date.now() - startedAt;
        state.attempts = attempt;
        state.durationMs += durationMs;
        this.validateIo(manifest?.outputSchemaRef, result.output, "output", node.id);
        state.output = result.output;
        state.degradations = result.degradations ?? [];
        const status = state.degradations.length > 0 ? "degraded" : "executed";
        this.onNodeEvent?.({ nodeId: node.id, status: "success", durationMs, attempt });
        this.logger.info("node settled", { nodeId: node.id, status, durationMs, attempt });
        return status;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        state.attempts = attempt;
        state.durationMs += durationMs;
        lastError = error;

        const isTimeout = error instanceof NodeTimeoutError;
        const isExternalAbort =
          error instanceof PipelineAbortedError ||
          (root.signal.aborted && !isTimeout);
        this.onNodeEvent?.({
          nodeId: node.id,
          status: isTimeout ? "timeout" : "failure",
          durationMs,
          attempt,
        });

        // NO retry on configuration errors or aborts (spec section 2).
        if (error instanceof NodeConfigurationError) throw error;
        if (isExternalAbort) {
          throw error instanceof PipelineAbortedError
            ? error
            : new PipelineAbortedError(root.signal.reason);
        }

        if (attempt <= maxRetries) {
          const delay =
            backoff === "none"
              ? 0
              : backoff === "exponential"
                ? retryDelayMs * 2 ** (attempt - 1)
                : retryDelayMs;
          this.onNodeEvent?.({ nodeId: node.id, status: "retry", durationMs: delay, attempt });
          this.logger.warn("node attempt failed; retrying", {
            nodeId: node.id,
            attempt,
            delay,
            error: error instanceof Error ? error.message : String(error),
          });
          if (delay > 0) await this.sleep(delay, root.signal);
          continue;
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        racer.dispose();
        root.signal.removeEventListener("abort", onRootAbort);
      }

      break; // retries exhausted
    }

    // Policy application: degrade only when explicitly declared (D-FCP-8).
    const critical = state.node.critical !== false;
    const policy = state.node.failurePolicy ?? "abort";
    if (!critical && policy === "degrade") {
      this.logger.warn("node failed under declared degrade policy (recorded)", {
        nodeId: node.id,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      });
      state.error = lastError;
      state.degradations = [
        {
          class: "node-failure",
          detail: lastError instanceof Error ? lastError.message : String(lastError),
        },
      ];
      return "failed-optional";
    }
    throw lastError;
  }

  private validateIo(
    schemaRef: string | undefined,
    value: unknown,
    direction: "input" | "output",
    nodeId: string
  ): void {
    if (!schemaRef || !this.ioValidator) return;
    const verdict = this.ioValidator(schemaRef, value, direction, nodeId);
    if (verdict === undefined) return; // unresolvable ref — recorded as unvalidated
    if (!verdict.ok) {
      throw new Error(
        `node '${nodeId}' ${direction} failed schema validation against '${schemaRef}': ${
          (verdict.errors ?? []).join("; ") || "schema violation"
        }`
      );
    }
  }
}
