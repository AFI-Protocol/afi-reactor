import path from "path";
import { fileURLToPath } from "url";
import dagCodex from "../config/dag.codex.json" assert { type: "json" };

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runDAG(pipelineName: string, signal: any) {
  console.log(`⚙️ Executing pipeline: ${pipelineName}`);

  const dagNodes = dagCodex;
  let currentData = signal;

  for (const node of dagNodes) {
    console.log(`🔧 Running plugin [${node.plugin}] for node [${node.id}]`);

    try {
      const pluginPath = path.resolve(__dirname, `../tools/${node.plugin}.mcp.ts`);
      const pluginModule = await import(pluginPath);
      const result = await pluginModule.analyze(currentData);
      currentData = { ...currentData, ...result };
    } catch (err: any) {
      console.warn(`⚠️ Failed to load plugin for ${node.id}:`, err.message);
      continue;
    }
  }

  return currentData;
}