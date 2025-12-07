/**
 * Execution Agent Simulation Plugin - Dev/Demo Only
 * 
 * Purpose: Dev-only execution simulation based on validator decision.
 * 
 * ⚠️ WARNING: This is SIMULATION ONLY. It does NOT:
 * - Connect to real exchanges
 * - Execute actual trades
 * - Handle real money or assets
 * 
 * It DOES:
 * - Simulate trade decisions based on validator approval
 * - Generate execution result envelopes for demo purposes
 * - Provide realistic-looking execution metadata
 * 
 * Part of: froggy-trend-pullback-v1 pipeline (Alpha → Pixel Rick → Froggy → Val Dook → Execution Sim)
 */

import { z } from "zod";
import type { ValidatorDecisionBase } from "afi-core/validators/ValidatorDecision.js";

/**
 * Input schema: validator decision from validator-decision-evaluator.
 */
const inputSchema = z.object({
  signalId: z.string(),
  validatorId: z.string(),
  decision: z.enum(["approve", "reject", "flag", "abstain"]),
  uwrConfidence: z.number(),
  reasonCodes: z.array(z.string()).optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
});

/**
 * Output schema: execution result envelope.
 */
const outputSchema = z.object({
  signalId: z.string(),
  validatorDecision: z.object({
    decision: z.enum(["approve", "reject", "flag", "abstain"]),
    uwrConfidence: z.number(),
  }),
  execution: z.object({
    status: z.enum(["simulated", "skipped"]),
    type: z.enum(["buy", "sell", "hold"]).optional(),
    asset: z.string().optional(),
    amount: z.number().optional(),
    simulatedPrice: z.number().optional(),
    timestamp: z.string(),
    notes: z.string().optional(),
  }),
});

type ValidatorDecision = z.infer<typeof inputSchema>;
type ExecutionResult = z.infer<typeof outputSchema>;

/**
 * Configuration for execution simulation.
 */
interface ExecutionConfig {
  mode: "simulation";
  defaultAsset: string;
  defaultAmount: number;
}

const defaultConfig: ExecutionConfig = {
  mode: "simulation",
  defaultAsset: "BTC/USDT",
  defaultAmount: 0.01,
};

/**
 * Simulate execution based on validator decision.
 * 
 * @param decision - Validator decision envelope
 * @param config - Execution configuration
 * @returns ExecutionResult with simulated trade details
 */
async function run(
  decision: ValidatorDecision,
  config: ExecutionConfig = defaultConfig
): Promise<ExecutionResult> {
  // Validate input
  const validatedDecision = inputSchema.parse(decision);

  // Determine execution action based on decision
  let executionStatus: "simulated" | "skipped";
  let executionType: "buy" | "sell" | "hold" | undefined;
  let executionNotes: string | undefined;

  if (validatedDecision.decision === "approve") {
    executionStatus = "simulated";
    executionType = "buy"; // For demo, always simulate buy on approval
    executionNotes = `Simulated BUY based on validator approval (confidence: ${validatedDecision.uwrConfidence.toFixed(2)})`;
  } else if (validatedDecision.decision === "reject") {
    executionStatus = "skipped";
    executionType = "hold";
    executionNotes = `Execution skipped due to validator rejection`;
  } else {
    // flag or abstain
    executionStatus = "skipped";
    executionType = "hold";
    executionNotes = `Execution skipped due to validator flag/abstain (needs review)`;
  }

  // Generate simulated price (for demo purposes)
  const simulatedPrice = executionStatus === "simulated" 
    ? 50000 + Math.random() * 10000 // BTC price range: 50k-60k
    : undefined;

  // Build execution result
  const result: ExecutionResult = {
    signalId: validatedDecision.signalId,
    validatorDecision: {
      decision: validatedDecision.decision,
      uwrConfidence: validatedDecision.uwrConfidence,
    },
    execution: {
      status: executionStatus,
      type: executionType,
      asset: executionStatus === "simulated" ? config.defaultAsset : undefined,
      amount: executionStatus === "simulated" ? config.defaultAmount : undefined,
      simulatedPrice,
      timestamp: new Date().toISOString(),
      notes: executionNotes,
    },
  };

  // Validate output
  return outputSchema.parse(result);
}

export default {
  run,
  inputSchema,
  outputSchema,
};

