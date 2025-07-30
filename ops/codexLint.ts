import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CodexReplayResult } from '../types/CodexReplayResult.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Strong typing for Codex manifest structures
interface CodexManifest {
  dag: string;
  schemas: string;
  agents: string;
  ops: string;
}

interface CodexRoot {
  manifest: CodexManifest;
}

interface DAGNode {
  nodeId?: string;
  id?: string;
  output?: string;
}

interface Schema {
  linkedDAGNode?: string;
  schemaRef?: string;
}

interface Agent {
  linkedNodes?: string[];
  linkedModules?: string[];
}

interface Pipeline {
  entry?: string;
  exit?: string;
  flow?: string[];
}

interface Ops {
  pipelines?: Pipeline[];
}

function loadJSON<T>(relativePath: string): T {
  const fullPath = path.resolve(__dirname, '..', 'codex', relativePath);
  console.log(`🔍 Loading JSON from: ${fullPath}`);
  
  if (!fs.existsSync(fullPath)) {
    throw new Error(`❌ File not found: ${fullPath}`);
  }
  
  const content = fs.readFileSync(fullPath, 'utf-8');
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    throw new Error(`❌ Failed to parse JSON at ${fullPath} — ${(err as Error).message}`);
  }
}

function validateNode(
  node: DAGNode, 
  schemas: Schema[], 
  agents: Agent[], 
  ops: Ops
): CodexReplayResult {
  const id = node.nodeId ?? node.id;
  const messages: string[] = [];
  let status: CodexReplayResult['status'] = 'ok';

  if (!id) {
    return {
      nodeId: 'undefined',
      status: 'missing-agent',
      messages: ['Node is missing a nodeId or id field'],
    };
  }

  // Schema validation
  const hasSchema = schemas.some(s => 
    s.linkedDAGNode === id || s.schemaRef === node.output
  );
  if (!hasSchema) {
    status = 'missing-schema';
    messages.push(`No schema linked to node '${id}' (output: ${node.output})`);
  }

  // Agent validation
  const hasAgent = agents.some(a => 
    (a.linkedNodes || a.linkedModules || []).includes(id)
  );
  if (!hasAgent) {
    if (status === 'ok') status = 'missing-agent';
    messages.push(`No agent assigned to DAG node '${id}'`);
  }

  // Pipeline validation
  const usedInPipeline = ops.pipelines?.some(p =>
    p.entry === id || p.exit === id || (p.flow || []).includes(id)
  );
  if (!usedInPipeline) {
    if (status === 'ok') status = 'unlinked-pipeline';
    messages.push(`Node '${id}' is not referenced in any pipeline`);
  }

  return { nodeId: id, status, messages };
}

function replayCodex(): CodexReplayResult[] {
  try {
    const root = loadJSON<CodexRoot>('.afi-codex.json');
    const dag = loadJSON<DAGNode[]>(root.manifest.dag);
    const schemas = loadJSON<Schema[]>(root.manifest.schemas);
    const agents = loadJSON<Agent[]>(root.manifest.agents);
    const ops = loadJSON<Ops>(root.manifest.ops);

    return dag.map(node => validateNode(node, schemas, agents, ops));
  } catch (error) {
    console.error('💥 Codex replay failed:', error);
    return [{
      nodeId: 'system-error',
      status: 'missing-agent',
      messages: [`System error: ${(error as Error).message}`]
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
} else {
  console.log(`🔧 ${summary.issues} issues found - see log for details`);
}
