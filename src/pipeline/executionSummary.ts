/**
 * Execution summary — the canonical, TIMESTAMP-FREE record of which nodes ran
 * and how (W3 spec section 2).
 *
 * The summary is an ordered array of { nodeId, pluginId, pluginVersion,
 * status } entries in topological completion order with a deterministic
 * tie-break by nodeId (the executor settles nodes wave by wave and records
 * each wave's settlements in nodeId order — branch completion order can never
 * reorder the summary). Operational metrics (durations, attempts, timestamps)
 * are NEVER part of the summary or its hash.
 *
 * executionSummaryHash = canonical hash (canonical-json-hashing.v1) of
 *   { schema: 'afi.execution-summary.v1', nodes: [...] }
 * under domain tag afi.d2.execution-summary.
 */
import { canonicalHashOf, DOMAIN_TAGS, type CanonicalHashRef } from "./hashing.js";

export const EXECUTION_SUMMARY_SCHEMA = "afi.execution-summary.v1";

/** The four governed node outcomes (W3 spec sections 1-2). */
export type NodeExecutionStatus = "executed" | "skipped" | "degraded" | "failed-optional";

export interface ExecutionSummaryEntry {
  nodeId: string;
  pluginId: string;
  pluginVersion: string;
  status: NodeExecutionStatus;
}

export interface ExecutionSummary {
  schema: typeof EXECUTION_SUMMARY_SCHEMA;
  nodes: ExecutionSummaryEntry[];
}

/**
 * Builds the canonical summary object from already-ordered entries. The
 * executor guarantees ordering (wave order, then nodeId); this constructor
 * only shapes and freezes the object and strips anything beyond the four
 * governed fields, so operational extras can never leak into hash material.
 */
export function buildExecutionSummary(
  entries: ReadonlyArray<ExecutionSummaryEntry>
): ExecutionSummary {
  return Object.freeze({
    schema: EXECUTION_SUMMARY_SCHEMA,
    nodes: entries.map((e) =>
      Object.freeze({
        nodeId: e.nodeId,
        pluginId: e.pluginId,
        pluginVersion: e.pluginVersion,
        status: e.status,
      })
    ),
  });
}

/** Canonical hash of the summary (domain tag afi.d2.execution-summary). */
export function computeExecutionSummaryHash(summary: ExecutionSummary): CanonicalHashRef {
  return canonicalHashOf(summary, DOMAIN_TAGS.executionSummary);
}
