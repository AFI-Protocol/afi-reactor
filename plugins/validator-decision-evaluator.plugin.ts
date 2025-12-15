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

/**
 * Extended validator decision with audit/replay metadata.
 *
 * Extends ValidatorDecisionBase with:
 * - validatorConfigId: Deterministic hash of validator config (for replay comparison)
 * - validatorVersion: Validator plugin version (for logic drift detection)
 *
 * These fields enable "holy" audit/replay by detecting config and logic changes.
 */
export interface ValidatorDecisionWithAudit extends ValidatorDecisionBase {
  /** Deterministic config ID (sha256 hash of config) */
  validatorConfigId: string;
  /** Validator version identifier (plugin-name@semver) */
  validatorVersion: string;
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
 * @param signal - Scored signal with Froggy analysis
 * @param config - Decision thresholds (defaults to VALIDATOR_CONFIG_V0)
 * @returns ValidatorDecisionWithAudit envelope with audit/replay metadata
 */
async function run(
  signal: ScoredSignal,
  config: ValidatorConfig = VALIDATOR_CONFIG_V0
): Promise<ValidatorDecisionWithAudit> {
  // Validate input
  const validatedInput = inputSchema.parse(signal);

  // Use UWR score from analystScore (canonical source)
  const uwrScore = validatedInput.analysis.analystScore.uwrScore;
  const uwrConfidence = Math.min(1, Math.max(0, uwrScore));

  // Determine decision based on thresholds
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

    // Novelty stub (optional, undefined for now)
    // Will be populated when novelty evaluation is wired in
    novelty: undefined,
  };

  return validatorDecision;
}

export default {
  run,
  inputSchema,
};

