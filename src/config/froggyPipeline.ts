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

  /** Stage category (for grouping in UI/logs) */
  category?: "structurer" | "enrichment" | "analyst" | "persistence";

  /** Persona/agent responsible (optional, for logging/observability) */
  persona?: string;

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
 * DAG pipeline for processing canonical USS v1.1 signals through the
 * Froggy analyst workflow: derive telemetry → parallel enrichment → analyze → score → persist.
 *
 * This is the canonical stage order used by:
 * - src/services/froggyDemoService.ts
 *
 * Stage sequence (with parallel enrichment branches):
 * 1. uss-telemetry-deriver: Extract routing/debug fields from context.rawUss into context.telemetry
 * 2. froggy-enrichment-tech-pattern: Add technical + pattern enrichment (OHLCV-based) [parallel branch 1]
 * 3. froggy-enrichment-sentiment-news: Add sentiment + news enrichment (external APIs) [parallel branch 2]
 * 4. froggy-enrichment-adapter: Merge enrichment legos + add AI/ML (Tiny Brains optional) [joins both branches]
 * 5. froggy-analyst: Run trend_pullback_v1 strategy, compute UWR score
 * 6. tssd-vault-write: Persist scored signal to MongoDB (internal stage)
 *
 * Dependency graph:
 * - tech-pattern and sentiment-news both depend on uss-telemetry-deriver (parallel execution)
 * - enrichment-adapter depends on both tech-pattern and sentiment-news (multi-parent join)
 * - froggy-analyst depends on enrichment-adapter
 * - tssd-vault-write depends on froggy-analyst
 *
 * REMOVED STAGES:
 * - alpha-scout-ingest: Replaced by webhook-level USS validation
 * - signal-structurer: Replaced by canonical USS v1.1 schema enforcement
 * - validator-decision: Moved to external certification layer (not Reactor's responsibility)
 * - execution-sim: Moved to consumer/adapter layer (not Reactor's responsibility)
 */
export const FROGGY_TREND_PULLBACK_PIPELINE: PipelineStage[] = [
  {
    id: "uss-telemetry-deriver",
    label: "USS Telemetry Deriver",
    kind: "internal",
    description: "Extract routing/debug fields from context.rawUss into context.telemetry (does not mutate rawUss)",
    category: "structurer",
    // No dependsOn: root stage (reads from context.rawUss)
  },
  {
    id: "froggy-enrichment-tech-pattern",
    label: "Froggy Enrichment (Tech + Pattern)",
    kind: "plugin",
    pluginPath: "plugins/froggy-enrichment-tech-pattern.plugin",
    description: "Add technical indicators and pattern recognition (OHLCV-based enrichment)",
    category: "enrichment",
    tags: ["froggy", "enrichment", "technical", "pattern"],
    dependsOn: ["uss-telemetry-deriver"], // Parallel branch 1: runs in parallel with sentiment-news
  },
  {
    id: "froggy-enrichment-sentiment-news",
    label: "Froggy Enrichment (Sentiment + News)",
    kind: "plugin",
    pluginPath: "plugins/froggy-enrichment-sentiment-news.plugin",
    description: "Add sentiment and news enrichment (Coinalyze, NewsData.io)",
    category: "enrichment",
    tags: ["froggy", "enrichment", "external-api", "sentiment", "news"],
    dependsOn: ["uss-telemetry-deriver"], // Parallel branch 2: runs in parallel with tech-pattern
  },
  {
    id: "froggy-enrichment-adapter",
    label: "Froggy Enrichment Adapter (Merger + AI/ML)",
    kind: "plugin",
    pluginPath: "plugins/froggy-enrichment-adapter.plugin",
    description: "Merge enrichment legos and add AI/ML predictions (Tiny Brains optional, fail-soft)",
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
    category: "analyst",
    dependsOn: ["froggy-enrichment-adapter"],
  },
  {
    id: "tssd-vault-write",
    label: "Reactor Scored Signal Vault Write",
    kind: "internal",
    description: "Persist scored signal to MongoDB (Reactor-owned collection, isolated from afi-infra)",
    category: "persistence",
    dependsOn: ["froggy-analyst"],
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

