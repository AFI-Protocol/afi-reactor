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
import type { ValidatorDecisionBase } from "afi-core/validators/ValidatorDecision.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";

/**
 * Input schema: analyzed signal with Froggy score + ensemble score.
 */
const inputSchema = z.object({
  signalId: z.string(),
  analysis: z.object({
    analystId: z.literal("froggy"),
    strategyId: z.literal("trend_pullback_v1"),
    uwrScore: z.number(),
    uwrAxes: z.object({
      structureAxis: z.number(),
      executionAxis: z.number(),
      riskAxis: z.number(),
      insightAxis: z.number(),
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
}

const defaultConfig: ValidatorConfig = {
  approveThreshold: 0.7,
  rejectThreshold: 0.3,
};

/**
 * Evaluate validator decision based on UWR score.
 * 
 * @param signal - Scored signal with Froggy analysis
 * @param config - Decision thresholds
 * @returns ValidatorDecisionBase envelope
 */
async function run(
  signal: ScoredSignal,
  config: ValidatorConfig = defaultConfig
): Promise<ValidatorDecisionBase> {
  // Validate input
  const validatedInput = inputSchema.parse(signal);

  // Use UWR score as primary decision input
  const uwrScore = validatedInput.analysis.uwrScore;
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

  // Add axis-specific reason codes
  const axes = validatedInput.analysis.uwrAxes;
  if (axes.structureAxis < 0.4) {
    reasonCodes.push("weak-structure");
  }
  if (axes.executionAxis < 0.4) {
    reasonCodes.push("weak-execution");
  }
  if (axes.riskAxis < 0.4) {
    reasonCodes.push("weak-risk-profile");
  }
  if (axes.insightAxis < 0.4) {
    reasonCodes.push("weak-insight");
  }

  // Build validator decision envelope
  const validatorDecision: ValidatorDecisionBase = {
    signalId: validatedInput.signalId,
    validatorId: "val-dook-dev", // Dev-only validator ID
    decision,
    uwrConfidence,
    reasonCodes,
    notes: validatedInput.analysis.notes?.join("; "),
    createdAt: new Date().toISOString(),
  };

  return validatorDecision;
}

export default {
  run,
  inputSchema,
};

