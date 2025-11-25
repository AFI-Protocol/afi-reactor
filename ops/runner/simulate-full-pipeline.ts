import { runDAG, DAGSignal } from "../../core/dag-engine.js";
import { VaultService } from "../../src/core/VaultService.js";
import { writeFileSync } from "fs";
import path from "path";
import process from "process";

const isReplay = process.argv.includes("--replay");
const fromVault = process.argv.includes("--from-vault");
const startTime = new Date();

console.log(`🚀 DAG ${isReplay ? "Replay" : "Simulation"} started at ${startTime.toISOString()}`);

let signals: DAGSignal[] = [];

// Define mockSignal at top level for use in telemetry
const mockSignal: DAGSignal = {
  signalId: "mock-signal-afi-0001",
  score: Math.random(),
  confidence: 0.95,
  timestamp: new Date().toISOString(),
  meta: { source: "simulator", strategy: "backtest" }
};

if (fromVault) {
  console.log(`📦 Loading signals from vault...`);
  const vaultedSignals = VaultService.getVaultedSignals();

  signals = vaultedSignals.map(entry => ({
    signalId: entry.signalId,
    score: entry.signal?.score || Math.random(),
    confidence: entry.signal?.confidence || 0.95,
    timestamp: entry.timestamp,
    meta: {
      source: "vault-replay",
      originalStage: entry.metadata?.lifecycleStage,
      vaultedAt: entry.vaultedAt,
      ...entry.signal?.meta
    }
  }));

  console.log(`📊 Loaded ${signals.length} signals from vault`);
} else {
  signals = [mockSignal];
}

(async () => {
  try {
    const results = await runDAG("signal-to-vault", mockSignal);
    const endTime = new Date();
    const duration = (endTime.getTime() - startTime.getTime()) / 1000;

    // Agent-friendly telemetry log
    const telemetryLog = {
      simulation: {
        type: isReplay ? "replay" : "simulation",
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        duration,
        status: "success"
      },
      signal: {
        input: mockSignal,
        output: results,
        processed: results.processed
      },
      metrics: {
        signalId: results.signalId,
        dagType: results.dagType,
        confidence: results.confidence,
        score: results.score
      }
    };

    // Write telemetry for agents
    const logPath = path.resolve("tmp", "dag-simulation.log.json");
    writeFileSync(logPath, JSON.stringify(telemetryLog, null, 2));

    console.log(`✅ DAG ${isReplay ? "Replay" : "Simulation"} complete`);
    console.log(`📊 Signal processed: ${results.signalId}`);
    console.log(`⏱️ Duration: ${duration}s`);
    console.log(`📝 Telemetry logged: ${logPath}`);
    console.log(`🏁 Finished at ${endTime.toISOString()}`);
  } catch (err) {
    console.error("💥 DAG execution failed:", err);
    process.exit(1);
  }
})();
