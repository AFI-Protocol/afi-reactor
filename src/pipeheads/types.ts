/**
 * Contracts for the AFI Signal Evaluation Pipehead System — a pre-live
 * REFERENCE IMPLEMENTATION / implementation profile of one signal-evaluation
 * path. These types are intentionally distinct from the existing `src/dag`
 * `Pipehead` type.
 *
 * Outward artifacts are D2-native (District 2 M2): AnalystInputEnvelope v1,
 * ScoredSignal v1 projection, ProvenanceRecord v1, ReplayProfile v1 (see
 * `./provenance/types.js`). The types below marked INTERNAL are in-process
 * intermediates and test surfaces only — they are never emitted outward.
 *
 * ESM: relative imports use `.js`; afi-core imports use the `afi-core/...`
 * package name.
 */

export type AnalysisLaneId =
  | "technical-indicators"
  | "pattern-recognition"
  | "news"
  | "social"
  | "ai-ml";

export const ANALYSIS_LANE_IDS: readonly AnalysisLaneId[] = [
  "technical-indicators",
  "pattern-recognition",
  "news",
  "social",
  "ai-ml",
] as const; // length MUST be 5, order stable

export type PipeheadKind =
  | "validation"
  | "analysis-lane"
  | "normalize"
  | "envelope"
  | "scoring"
  | "provenance";

export interface PipeheadContext {
  signalId: string;
  rawUss: unknown; // canonical USS v1.1 fixture input
  clock: () => string; // injectable; default returns a FROZEN ISO string
  metadata?: Record<string, unknown>;
}

export interface PipeheadExecutionResult<O = unknown> {
  pipeheadId: string;
  kind: PipeheadKind;
  status: "ok" | "skipped" | "failed";
  provisional: boolean; // true for provisional lanes / provisional outputs
  output: O;
  notes?: string[];
  startedAt: string; // timestamp; EXCLUDED from all hashes
  finishedAt: string; // timestamp; EXCLUDED from all hashes
}

export interface Pipehead<I, O> {
  id: string;
  kind: PipeheadKind;
  lane?: AnalysisLaneId; // present iff kind === 'analysis-lane'
  execute(input: I, ctx: PipeheadContext): Promise<PipeheadExecutionResult<O>>;
}

export interface AnalysisLaneResult<P = unknown> {
  lane: AnalysisLaneId;
  provisional: boolean; // MUST be true for news/social/ai-ml in this POC
  payload: P; // lane-specific deterministic payload
  confidence?: number;
  notes?: string[];
}

/**
 * INTERNAL: binds an AnalysisBundle to the validated input it was derived
 * from so downstream artifacts can tie output to a specific input
 * (validation-contract VAL-BUNDLE-008). `inputHash` equals the afi.hash.v1
 * signal-input digest of the validated rawUss.
 */
export interface BundleProvenance {
  signalId: string;
  inputHash: string;
}

/**
 * INTERNAL intermediate: the normalized fan-in of the five lane results.
 * Never emitted outward — the outward analyst-input surface is the
 * AnalystInputEnvelope v1 (which carries `enrichedView` as an OPAQUE,
 * declared, hash-pinned strategy-local view).
 */
export interface AnalysisBundle {
  signalId: string;
  symbol: string;
  market: string;
  timeframe: string;
  lanes: Record<AnalysisLaneId, AnalysisLaneResult>; // all 5 keys ALWAYS present
  provisionalLanes: AnalysisLaneId[]; // explicit, e.g. ['news','social','ai-ml']
  enrichedView: unknown; // strategy-local view consumed by the afi-core scorer
  provenance?: BundleProvenance; // binds the bundle to the validated input (signalId + inputHash)
}

/**
 * INTERNAL scoring carrier: holds the afi-core scorer output VERBATIM between
 * the scoring step and the D2 projection builders. Never emitted outward —
 * the outward scored surface is the ScoredSignal v1 projection.
 * `scoredAt` comes from the injected clock and is volatile runtime metadata,
 * excluded from every content hash and never emitted.
 *
 * @internal
 */
export interface InternalScoringResult {
  signalId: string;
  uwrScore: number;
  uwrAxes: { structure: number; execution: number; risk: number; insight: number };
  analystScore: unknown; // afi-core AnalystScoreTemplate (verbatim)
  scoredAt: string; // volatile; EXCLUDED from all hashes; never emitted
}
