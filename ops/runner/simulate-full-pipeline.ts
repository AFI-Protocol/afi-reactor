import { runDAG } from "../../core/dag-engine"; // Or whatever your DAG engine is
import { writeFileSync } from "fs";

const mockSignal = {
  signalId: "mock-signal-afi-0001",
  score: Math.random(),
  confidence: 0.95,
  timestamp: new Date().toISOString(),
  meta: { source: "simulator", strategy: "backtest" }
};

(async () => {
  console.log("🚀 Simulating full AFI signal pipeline...");
  const result = await runDAG("signal-to-vault", mockSignal);
  writeFileSync("tmp/simulation-result.json", JSON.stringify(result, null, 2));
  console.log("✅ Final signal result stored in tmp/simulation-result.json");
})();