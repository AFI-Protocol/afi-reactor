// DEV/OPS MANUAL PIPELINE RUNNER
// Helper for local/manual runs of executePipeline. Not a canonical protocol entrypoint.
// Canonical DAG orchestration entrypoints live under src/cli (e.g., src/cli/run-dag.ts).
import { executePipeline } from "./executePipeline.js";

const args = process.argv.slice(2);
const nameArg = args.find((arg) => arg.startsWith("--name="));
const pipelineName = nameArg ? nameArg.split("=")[1] : "signal-to-vault";

console.log(`🚀 Running pipeline: ${pipelineName}`);

try {
  const result = await executePipeline(pipelineName);
  console.log("✅ Final pipeline output:", result);
} catch (error) {
  console.error("❌ Pipeline execution failed:", error);
}
