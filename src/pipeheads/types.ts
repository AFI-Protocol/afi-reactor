/**
 * Mission-local contracts for the AFI Signal Evaluation Pipehead System
 * (non-production POC). These mirror architecture.md §4 verbatim in shape and
 * are intentionally distinct from the existing `src/dag` `Pipehead` type.
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
  | "scoring"
  | "reputation"
  | "audit";

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
 * Binds an AnalysisBundle to the validated input it was derived from so
 * downstream artifacts can tie output to a specific input (validation-contract
 * VAL-BUNDLE-008). `inputHash` equals the canonical hash of the validated
 * rawUss (the schema-validation step's inputHash).
 */
export interface BundleProvenance {
  signalId: string;
  inputHash: string;
}

export interface AnalysisBundle {
  signalId: string;
  symbol: string;
  market: string;
  timeframe: string;
  lanes: Record<AnalysisLaneId, AnalysisLaneResult>; // all 5 keys ALWAYS present
  provisionalLanes: AnalysisLaneId[]; // explicit, e.g. ['news','social','ai-ml']
  enrichedView: unknown; // FroggyEnrichedView projection consumed by afi-core scorer
  provenance?: BundleProvenance; // binds the bundle to the validated input (signalId + inputHash)
}

export interface DemoScoredSignal {
  signalId: string;
  uwrScore: number;
  uwrAxes: { structure: number; execution: number; risk: number; insight: number };
  analystScore: unknown; // afi-core AnalystScoreTemplate (verbatim)
  provisional: true;
  demoOnly: true;
  scoredAt: string; // EXCLUDED from hashes
}

export interface DemoReputationReceipt {
  signalId: string;
  uwrScore: number;
  receiptKind: "demo-only";
  provisionalLanes: AnalysisLaneId[];
  mutatesReputationState: false; // invariant: never true
  note: string; // e.g. "non-canonical; does not mutate reputation state"
  issuedAt: string; // EXCLUDED from hashes
}

export interface AuditRecord {
  signalId: string;
  algo: "sha256";
  inputHash: string; // canonical hash of rawUss
  bundleHash: string; // canonical hash of bundle (timestamps stripped)
  outputHash: string; // canonical hash of deterministic scoring projection
  uwrScore: number;
  uwrAxes: { structure: number; execution: number; risk: number; insight: number };
  provisionalLanes: AnalysisLaneId[];
  scoredAtExcluded: true; // invariant marker
  demoOnly: true;
}
