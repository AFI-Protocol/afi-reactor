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