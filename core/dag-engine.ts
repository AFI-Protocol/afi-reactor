import { fileURLToPath } from "url";
import path from "path";
import { executePipeline } from "../ops/runner/executePipeline.js";

// ✅ Resolve the directory name for any needed paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DAGSignal {
  signalId: string;
  score: number;
  confidence: number;
  timestamp: string;
  meta: Record<string, any>;
}

export async function runDAG(dagType: string, signal: DAGSignal): Promise<DAGSignal & { processed: true; dagType: string; processedAt: string }> {
  console.log(`🔄 Running DAG: ${dagType}`);
  console.log(`📊 Processing signal: ${signal.signalId}`);
  
  // Simulate DAG processing with realistic delay
  await new Promise(resolve => setTimeout(resolve, 200));
  
  return {
    ...signal,
    processed: true,
    dagType,
    processedAt: new Date().toISOString()
  };
}
