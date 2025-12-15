/**
 * Validator Decision Evaluator Plugin - Dev/Demo Only
 * 
 * Purpose: Transform scored signal into ValidatorDecision envelope (afi-core contract).
 * 
 * This plugin imports afi-core's ValidatorDecisionBase type and produces
 * a decision envelope compatible with the protocol's validator contracts.
 * 
 * For demo purposes, uses simple threshold-based logic:
 * - score >= 0.7 → approve
 * - score <= 0.3 → reject
 * - else → flag
 * 
 * Part of: froggy-trend-pullback-v1 pipeline (Alpha → Pixel Rick → Froggy → Val Dook → Execution Sim)
 */

import { z } from "zod";
import { createHash } from "crypto";
import type { ValidatorDecisionBase } from "afi-core/validators/ValidatorDecision.js";
import type { NoveltyResult } from "afi-core/validators/NoveltyTypes.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import { computeNoveltyScore, type NoveltySignalInput } from "afi-core/validators/NoveltyScorer.js";
import type { CanonicalNovelty } from "../src/novelty/canonicalNovelty.js";
import { canonicalizeNovelty, deriveCohortId, extractCohortAttributesFromUss } from "../src/novelty/canonicalNovelty.js";
import { fetchBaselineSignals } from "../src/novelty/baselineFetch.js";
import type { PipelineContext } from "../src/services/pipelineRunner.js";

/**
 * Extended validator decision with audit/replay metadata.
 *
 * Extends ValidatorDecisionBase with:
 * - validatorConfigId: Deterministic hash of validator config (for replay comparison)
 * - validatorVersion: Validator plugin version (for logic drift detection)
 * - canonicalNovelty: Replay-stable novelty fields (for deterministic comparison)
 *
 * These fields enable "holy" audit/replay by detecting config and logic changes.
 */
export interface ValidatorDecisionWithAudit extends ValidatorDecisionBase {
  /** Deterministic config ID (sha256 hash of config) */
  validatorConfigId: string;
  /** Validator version identifier (plugin-name@semver) */
  validatorVersion: string;
  /** Canonical novelty (replay-stable fields only) */
  canonicalNovelty?: CanonicalNovelty;
}

/**
 * Input schema: analyzed signal with Froggy score + ensemble score.
 *
 * Updated to use AnalystScoreTemplate as canonical source for scoring data.
 */
const inputSchema = z.object({
  signalId: z.string(),
  analysis: z.object({
    analystScore: z.object({
      analystId: z.string(),
      strategyId: z.string(),
      uwrScore: z.number(),
      uwrAxes: z.object({
        structure: z.number(),
        execution: z.number(),
        risk: z.number(),
        insight: z.number(),
      }),
    }),
    notes: z.array(z.string()).optional(),
  }),
  score: z.number().optional(), // From ensemble scorer
  confidence: z.number().optional(),
  // Optional context for novelty scoring (passed through from pipeline)
  _context: z.any().optional(),
});

type ScoredSignal = z.infer<typeof inputSchema>;

/**
 * Configuration for decision thresholds.
 */
interface ValidatorConfig {
  approveThreshold: number;
  rejectThreshold: number;
  weakAxisThreshold: number;
}

/**
 * Validator Config v0 (Canonical)
 *
 * This is the canonical configuration for the validator decision evaluator.
 * Any changes to these thresholds will result in a new validatorConfigId,
 * enabling audit/replay to detect configuration drift.
 */
const VALIDATOR_CONFIG_V0: ValidatorConfig = {
  approveThreshold: 0.7,
  rejectThreshold: 0.3,
  weakAxisThreshold: 0.4,
};

/**
 * Validator version identifier (for audit/replay)
 *
 * Format: plugin-name@semver
 * Increment when logic changes (not just config changes).
 */
const VALIDATOR_VERSION = "validator-decision-evaluator@v0.1";

/**
 * Compute deterministic validator config ID from config object.
 *
 * Uses SHA-256 hash of stable JSON stringify (sorted keys) to ensure
 * the same config always produces the same ID.
 *
 * @param config - Validator configuration object
 * @returns Deterministic config ID (sha256 hash)
 */
function computeValidatorConfigId(config: ValidatorConfig): string {
  // Sort keys for deterministic JSON stringify
  const sortedConfig = {
    approveThreshold: config.approveThreshold,
    rejectThreshold: config.rejectThreshold,
    weakAxisThreshold: config.weakAxisThreshold,
  };

  const configJson = JSON.stringify(sortedConfig);
  const hash = createHash("sha256").update(configJson).digest("hex");

  return `val-config-${hash.substring(0, 16)}`;
}

/**
 * Evaluate validator decision based on UWR score.
 *
 * @param signal - Scored signal with Froggy analysis (may include _context field)
 * @param config - Decision thresholds (defaults to VALIDATOR_CONFIG_V0)
 * @returns ValidatorDecisionWithAudit envelope with audit/replay metadata
 */
async function run(
  signal: ScoredSignal,
  config: ValidatorConfig = VALIDATOR_CONFIG_V0
): Promise<ValidatorDecisionWithAudit> {
  // Validate input
  const validatedInput = inputSchema.parse(signal);

  // Extract context from payload (if passed through from pipeline)
  const context = (signal as any)._context as PipelineContext | undefined;

  // Use UWR score from analystScore (canonical source)
  const uwrScore = validatedInput.analysis.analystScore.uwrScore;
  const uwrConfidence = Math.min(1, Math.max(0, uwrScore));

  // ═══════════════════════════════════════════════════════════════
  // NOVELTY SCORING (Phase: Real Novelty + Replay Canonical)
  // ═══════════════════════════════════════════════════════════════

  let novelty: NoveltyResult | undefined;
  let canonicalNovelty: CanonicalNovelty | undefined;

  if (context?.rawUss) {
    try {
      // Step 1: Derive deterministic cohortId from USS provenance
      const { market, timeframe, strategy } = extractCohortAttributesFromUss(context.rawUss);
      const cohortId = deriveCohortId(market, timeframe, strategy);

      // Step 2: Fetch baseline signals from TSSD vault (deterministic ordering)
      const currentTimestamp = context.rawUss.provenance.ingestedAt || new Date().toISOString();
      const baselineSignals = await fetchBaselineSignals(
        cohortId,
        validatedInput.signalId,
        currentTimestamp
      );

      // Step 3: Build current signal input for novelty scorer
      const currentSignal: NoveltySignalInput = {
        signalId: validatedInput.signalId,
        cohortId,
        market,
        timeframe,
        strategy,
        direction: validatedInput.analysis.analystScore.strategyId.includes("long") ? "long" :
                   validatedInput.analysis.analystScore.strategyId.includes("short") ? "short" : "neutral",
        structureAxis: validatedInput.analysis.analystScore.uwrAxes.structure,
        executionAxis: validatedInput.analysis.analystScore.uwrAxes.execution,
        riskAxis: validatedInput.analysis.analystScore.uwrAxes.risk,
        insightAxis: validatedInput.analysis.analystScore.uwrAxes.insight,
        createdAt: currentTimestamp,
      };

      // Step 4: Compute novelty score using afi-core scorer
      novelty = computeNoveltyScore(currentSignal, baselineSignals);

      // Step 5: Canonicalize for replay comparison (exclude computedAt)
      canonicalNovelty = canonicalizeNovelty(novelty);

      console.info(`✅ Novelty scored: ${novelty.noveltyClass} (score=${novelty.noveltyScore.toFixed(2)}, cohort=${cohortId}, baseline=${baselineSignals.length} signals)`);
    } catch (error: any) {
      console.warn(`⚠️  Novelty scoring failed:`, error.message || String(error));
      // Continue without novelty (graceful degradation)
    }
  } else {
    console.info("ℹ️  Novelty scoring skipped: context.rawUss not available");
  }

  // ═══════════════════════════════════════════════════════════════
  // DECISION LOGIC (with novelty-based flagging)
  // ═══════════════════════════════════════════════════════════════

  let decision: "approve" | "reject" | "flag";
  const reasonCodes: string[] = [];

  if (uwrScore >= config.approveThreshold) {
    decision = "approve";
    reasonCodes.push("score-high", "froggy-demo");
  } else if (uwrScore <= config.rejectThreshold) {
    decision = "reject";
    reasonCodes.push("score-low", "froggy-demo");
  } else {
    decision = "flag";
    reasonCodes.push("score-medium", "needs-review", "froggy-demo");
  }

  // Decision policy v0: Flag redundant signals with low confidence
  // If signal is redundant AND uwrConfidence < approveThreshold → flag
  if (canonicalNovelty?.noveltyClass === "redundant" && uwrConfidence < config.approveThreshold) {
    decision = "flag";
    if (!reasonCodes.includes("needs-review")) {
      reasonCodes.push("needs-review");
    }
  }

  // Add axis-specific reason codes (read from analystScore.uwrAxes)
  const axes = validatedInput.analysis.analystScore.uwrAxes;
  if (axes.structure < config.weakAxisThreshold) {
    reasonCodes.push("weak-structure");
  }
  if (axes.execution < config.weakAxisThreshold) {
    reasonCodes.push("weak-execution");
  }
  if (axes.risk < config.weakAxisThreshold) {
    reasonCodes.push("weak-risk-profile");
  }
  if (axes.insight < config.weakAxisThreshold) {
    reasonCodes.push("weak-insight");
  }

  // Add novelty-based reason codes
  if (canonicalNovelty) {
    switch (canonicalNovelty.noveltyClass) {
      case "breakthrough":
        reasonCodes.push("NOVELTY_BREAKTHROUGH");
        break;
      case "incremental":
        reasonCodes.push("NOVELTY_INCREMENTAL");
        break;
      case "redundant":
        reasonCodes.push("NOVELTY_REDUNDANT");
        break;
      // "contradictory" reserved for future use
    }
  }

  // Compute deterministic config ID for audit/replay
  const validatorConfigId = computeValidatorConfigId(config);

  // Build validator decision envelope with audit/replay metadata
  const validatorDecision: ValidatorDecisionWithAudit = {
    signalId: validatedInput.signalId,
    validatorId: "val-dook-dev", // Dev-only validator ID
    decision,
    uwrConfidence,
    reasonCodes,
    notes: validatedInput.analysis.notes?.join("; "),
    createdAt: new Date().toISOString(),

    // Audit/replay metadata (Phase: Validator v0 → Holy)
    validatorConfigId,
    validatorVersion: VALIDATOR_VERSION,

    // Novelty evaluation (Phase: Real Novelty + Replay Canonical)
    // - novelty: Full NoveltyResult with computedAt (for observability)
    // - canonicalNovelty: Replay-stable fields only (for deterministic comparison)
    novelty,
    canonicalNovelty,
  };

  return validatorDecision;
}

export default {
  run,
  inputSchema,
};

