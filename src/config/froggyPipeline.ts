/**
 * Froggy Pipeline Configuration
 *
 * Single source of truth for Froggy's trend-pullback pipeline stages.
 * This config defines the DAG (Directed Acyclic Graph) of stages that process a signal
 * from TradingView webhook → TSSD vault persistence.
 *
 * The pipeline uses parallel enrichment branches:
 * - Tech+Pattern enrichment and Sentiment+News enrichment run in parallel after structuring
 * - Both branches join at the enrichment adapter, which merges their outputs
 *
 * @module froggyPipeline
 */

/**
 * Pipeline stage definition.
 * Each stage represents a discrete step in the signal processing pipeline.
 */
export interface PipelineStage {
  /** Unique stage identifier */
  id: string;

  /** Human-readable label for this stage */
  label?: string;

  /** Stage type: plugin (external module) or internal (inline function) */
  kind: "plugin" | "internal";

  /** Plugin path (relative to project root, without .ts extension) */
  pluginPath?: string;

  /** Stage description */
  description?: string;

  /** Persona/agent responsible for this stage (for demo summaries) */
  persona?: "Alpha" | "Pixel Rick" | "Froggy" | "Val Dook" | "Execution Sim" | "TSSD Vault";

  /** Stage category (for grouping in UI/logs) */
  category?: "scout" | "structurer" | "enrichment" | "analyst" | "validator" | "execution" | "persistence";

  // ========== Orchestration Metadata (Future DAG Features) ==========
  // These fields are metadata-only and do not affect runtime behavior yet.
  // They will be used by future DAG engine features (parallel groups, retries, etc.)

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

  /** Arbitrary tags for filtering/grouping (e.g., ["enrichment", "external-api"]) */
  tags?: string[];
}

/**
 * Froggy Trend-Pullback Pipeline (v1)
 *
 * DAG pipeline for processing TradingView signals through the full
 * Froggy analyst workflow: scout → structure → parallel enrichment → analyze → validate → execute → persist.
 *
 * This is the canonical stage order used by:
 * - src/services/froggyDemoService.ts
 * - test/froggyPipeline.test.ts
 * - scripts/pipeline-smoke.ts
 *
 * Stage sequence (with parallel enrichment branches):
 * 1. alpha-scout-ingest: Convert TradingView payload to reactor signal envelope
 * 2. signal-structurer: Normalize to USS (Universal Signal Schema)
 * 3. froggy-enrichment-tech-pattern: Add technical + pattern enrichment (OHLCV-based) [parallel branch 1]
 * 4. froggy-enrichment-sentiment-news: Add sentiment + news enrichment (external APIs) [parallel branch 2]
 * 5. froggy-enrichment-adapter: Merge enrichment legos + add AI/ML [joins both branches]
 * 6. froggy-analyst: Run trend_pullback_v1 strategy, compute UWR score
 * 7. validator-decision: Evaluate UWR score → approve/reject/flag/abstain
 * 8. execution-sim: Simulate trade execution based on validator decision
 * 9. tssd-vault-write: Persist final result to MongoDB (internal stage)
 *
 * Dependency graph:
 * - tech-pattern and sentiment-news both depend on signal-structurer (parallel execution)
 * - enrichment-adapter depends on both tech-pattern and sentiment-news (multi-parent join)
 */
export const FROGGY_TREND_PULLBACK_PIPELINE: PipelineStage[] = [
  {
    id: "alpha-scout-ingest",
    label: "Alpha Scout Ingest",
    kind: "plugin",
    pluginPath: "plugins/alpha-scout-ingest.plugin",
    description: "Convert TradingView alert payload to reactor signal envelope",
    persona: "Alpha",
    category: "scout",
    // No dependsOn: root stage
  },
  {
    id: "signal-structurer",
    label: "Signal Structurer",
    kind: "plugin",
    pluginPath: "plugins/signal-structurer.plugin",
    description: "Normalize signal to USS (Universal Signal Schema) format",
    persona: "Pixel Rick",
    category: "structurer",
    dependsOn: ["alpha-scout-ingest"],
  },
  {
    id: "froggy-enrichment-tech-pattern",
    label: "Froggy Enrichment (Tech + Pattern)",
    kind: "plugin",
    pluginPath: "plugins/froggy-enrichment-tech-pattern.plugin",
    description: "Add technical indicators and pattern recognition (OHLCV-based enrichment)",
    persona: "Pixel Rick",
    category: "enrichment",
    tags: ["froggy", "enrichment", "technical", "pattern"],
    dependsOn: ["signal-structurer"], // Parallel branch 1: runs in parallel with sentiment-news
  },
  {
    id: "froggy-enrichment-sentiment-news",
    label: "Froggy Enrichment (Sentiment + News)",
    kind: "plugin",
    pluginPath: "plugins/froggy-enrichment-sentiment-news.plugin",
    description: "Add sentiment and news enrichment (Coinalyze, NewsData.io)",
    persona: "Pixel Rick",
    category: "enrichment",
    tags: ["froggy", "enrichment", "external-api", "sentiment", "news"],
    dependsOn: ["signal-structurer"], // Parallel branch 2: runs in parallel with tech-pattern
  },
  {
    id: "froggy-enrichment-adapter",
    label: "Froggy Enrichment Adapter (Merger + AI/ML)",
    kind: "plugin",
    pluginPath: "plugins/froggy-enrichment-adapter.plugin",
    description: "Merge enrichment legos and add AI/ML predictions (Tiny Brains)",
    persona: "Pixel Rick",
    category: "enrichment",
    tags: ["froggy", "enrichment", "external-api", "aiMl"],
    dependsOn: ["froggy-enrichment-tech-pattern", "froggy-enrichment-sentiment-news"], // Multi-parent join
  },
  {
    id: "froggy-analyst",
    label: "Froggy Analyst",
    kind: "plugin",
    pluginPath: "plugins/froggy.trend_pullback_v1.plugin",
    description: "Run trend_pullback_v1 strategy from afi-core, compute UWR score",
    persona: "Froggy",
    category: "analyst",
    dependsOn: ["froggy-enrichment-adapter"],
  },
  {
    id: "validator-decision",
    label: "Validator Decision Evaluator",
    kind: "plugin",
    pluginPath: "plugins/validator-decision-evaluator.plugin",
    description: "Evaluate UWR score and produce validator decision (approve/reject/flag/abstain)",
    persona: "Val Dook",
    category: "validator",
    critical: true,
    tags: ["froggy", "validator", "decision"],
    dependsOn: ["froggy-analyst"],
  },
  {
    id: "execution-sim",
    label: "Execution Agent Sim",
    kind: "plugin",
    pluginPath: "plugins/execution-agent-sim.plugin",
    description: "Simulate trade execution based on validator decision (dev/demo only)",
    persona: "Execution Sim",
    category: "execution",
    dependsOn: ["validator-decision"],
  },
  {
    id: "tssd-vault-write",
    label: "TSSD Vault Write",
    kind: "internal",
    description: "Persist final scored + validated signal to MongoDB TSSD vault",
    persona: "TSSD Vault",
    category: "persistence",
    dependsOn: ["execution-sim"],
  },
];

/**
 * Get pipeline stage by ID.
 * 
 * @param stageId - Stage identifier
 * @returns Pipeline stage or undefined if not found
 */
export function getPipelineStage(stageId: string): PipelineStage | undefined {
  return FROGGY_TREND_PULLBACK_PIPELINE.find((stage) => stage.id === stageId);
}

/**
 * Get all plugin stages (excludes internal stages).
 * 
 * @returns Array of plugin stages
 */
export function getPluginStages(): PipelineStage[] {
  return FROGGY_TREND_PULLBACK_PIPELINE.filter((stage) => stage.kind === "plugin");
}

/**
 * Get all internal stages.
 * 
 * @returns Array of internal stages
 */
export function getInternalStages(): PipelineStage[] {
  return FROGGY_TREND_PULLBACK_PIPELINE.filter((stage) => stage.kind === "internal");
}

