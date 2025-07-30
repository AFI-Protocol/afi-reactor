import { pathToFileURL } from 'url';
import path from 'path';
import { loadCodexFile } from '../utils/loadCodex.js';
import { getSignal } from '../utils/signalInput.js';
export async function executePipeline(pipelineId, inputSignal) {
    const dag = await loadCodexFile('codex/dag.codex.json');
    const ops = await loadCodexFile('codex/ops.codex.json');
    const pipeline = ops.pipelines.find((p) => p.name === pipelineId);
    if (!pipeline) {
        console.error(`❌ Pipeline "${pipelineId}" not found.`);
        return;
    }
    let signal = inputSignal ?? await getSignal();
    if (!signal) {
        console.warn(`⚠️ No signal returned from entry node: ${pipeline.entry}`);
        return;
    }
    const pipelineNodes = [pipeline.entry, ...(pipeline.flow || [])];
    for (const nodeId of pipelineNodes) {
        const node = dag.find((n) => n.id === nodeId);
        if (!node) {
            console.warn(`⚠️ DAG node "${nodeId}" not found in codex.`);
            continue;
        }
        let plugin;
        try {
            // Try to load as traditional plugin
            const pluginPath = path.resolve(`plugins/${node.plugin}.ts`);
            const pluginUrl = pathToFileURL(pluginPath).href;
            const pluginModule = await import(pluginUrl);
            plugin = pluginModule.default;
        }
        catch (pluginErr) {
            console.warn(`🔄 Plugin "${node.plugin}" not found in /plugins — attempting MCP agent load...`);
            try {
                const mcpPath = path.resolve(`tools/${node.plugin}.mcp.ts`);
                const mcpUrl = pathToFileURL(mcpPath).href;
                const mcpModule = await import(mcpUrl);
                plugin = mcpModule.default;
            }
            catch (mcpErr) {
                console.error(`❌ Failed to load plugin "${node.plugin}" from both /plugins and /tools as MCP agent.`);
                throw mcpErr;
            }
        }
        if (typeof plugin?.run !== 'function') {
            console.warn(`⚠️ Plugin "${node.plugin}" does not export a valid 'run' function.`);
            continue;
        }
        console.log(`🔧 Running plugin [${node.plugin}] for node [${node.id}]`);
        signal = await plugin.run(signal);
    }
    console.log('✅ Pipeline execution complete. Final output:', signal);
    return signal;
}
//# sourceMappingURL=executePipeline.js.map