import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function loadJSON(relativePath) {
    const fullPath = path.resolve(__dirname, '..', 'codex', relativePath);
    console.log(`🔍 Loading JSON from: ${fullPath}`);
    if (!fs.existsSync(fullPath)) {
        if (relativePath === '.afi-codex.json') {
            console.log(`ℹ️  No .afi-codex.json found - this is normal for new projects`);
            // Return minimal structure for codex root
            return {
                manifest: {
                    dag: 'dag.codex.json',
                    schemas: 'schemas.codex.json',
                    agents: 'agents.codex.json',
                    ops: 'ops.codex.json'
                }
            };
        }
        throw new Error(`❌ File not found: ${fullPath}`);
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    try {
        return JSON.parse(content);
    }
    catch (err) {
        throw new Error(`❌ Failed to parse JSON at ${fullPath} — ${err.message}`);
    }
}
function validateNode(node, schemas, agents, ops) {
    const id = node.nodeId ?? node.id;
    const messages = [];
    let status = 'ok';
    if (!id) {
        return {
            nodeId: 'undefined',
            status: 'missing-agent',
            messages: ['Node is missing a nodeId or id field'],
        };
    }
    // Schema validation
    const hasSchema = schemas.some(s => s.linkedDAGNode === id || s.schemaRef === node.output);
    if (!hasSchema) {
        status = 'missing-schema';
        messages.push(`No schema linked to node '${id}' (output: ${node.output})`);
    }
    // Agent validation
    const hasAgent = agents.some(a => (a.linkedNodes || a.linkedModules || []).includes(id));
    if (!hasAgent) {
        if (status === 'ok')
            status = 'missing-agent';
        messages.push(`No agent assigned to DAG node '${id}'`);
    }
    // Pipeline validation
    const usedInPipeline = ops.pipelines?.some(p => p.entry === id || p.exit === id || (p.flow || []).includes(id));
    if (!usedInPipeline) {
        if (status === 'ok')
            status = 'unlinked-pipeline';
        messages.push(`Node '${id}' is not referenced in any pipeline`);
    }
    return { nodeId: id, status, messages };
}
function replayCodex() {
    try {
        const root = loadJSON('.afi-codex.json');
        const dag = loadJSON(root.manifest.dag);
        const schemas = loadJSON(root.manifest.schemas);
        const agents = loadJSON(root.manifest.agents);
        const ops = loadJSON(root.manifest.ops);
        return dag.map(node => validateNode(node, schemas, agents, ops));
    }
    catch (error) {
        console.error('💥 Codex replay failed:', error);
        return [{
                nodeId: 'system-error',
                status: 'missing-agent',
                messages: [`System error: ${error.message}`]
            }];
    }
}
// Execute replay with enhanced logging
const results = replayCodex();
const logPath = path.resolve(__dirname, '..', 'codex', 'codex.replay.log.json');
// Agent-friendly structured output
const summary = {
    timestamp: new Date().toISOString(),
    totalNodes: results.length,
    healthyNodes: results.filter(r => r.status === 'ok').length,
    issues: results.filter(r => r.status !== 'ok').length,
    results
};
fs.writeFileSync(logPath, JSON.stringify(summary, null, 2));
console.log(`✅ Codex Replay complete. Log written to: ${logPath}`);
console.log(`📊 Summary: ${summary.healthyNodes}/${summary.totalNodes} nodes healthy`);
// Agent-friendly console output
results.forEach(r => {
    if (r.status !== 'ok') {
        console.warn(`⚠️  ${r.nodeId}: [${r.status}] → ${r.messages.join(' | ')}`);
    }
});
if (summary.issues === 0) {
    console.log('🎉 All DAG nodes are properly configured!');
}
else {
    console.log(`🔧 ${summary.issues} issues found - see log for details`);
}
//# sourceMappingURL=codexLint.js.map