// codexReplay.ts

import fs from 'fs';
import path from 'path';
import { CodexReplayResult } from '../types/CodexReplayResult';

function loadJSON(relativePath: string): any {
  const fullPath = path.resolve(__dirname, '..', 'codex', relativePath);
  console.log(`🔍 Loading JSON from: ${fullPath}`);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`❌ File not found: ${fullPath}`);
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (err) {
  throw new Error(`❌ Failed to parse JSON at ${fullPath} — ${(err as Error).message}`);
}
}

function replayCodex(): CodexReplayResult[] {
  const root = loadJSON('.afi-codex.json');
  const dag = loadJSON(root.manifest.dag);
  const schemas = loadJSON(root.manifest.schemas);
  const agents = loadJSON(root.manifest.agents);
  const ops = loadJSON(root.manifest.ops);

  const results: CodexReplayResult[] = [];

  dag.forEach((node: any) => {
    const id = node.nodeId ?? node.id;
    const messages: string[] = [];
    let status: CodexReplayResult['status'] = 'ok';

    if (!id) {
      results.push({
        nodeId: 'undefined',
        status: 'missing-agent',
        messages: ['Node is missing a nodeId or id field'],
      });
      return;
    }

    const hasSchema = schemas.some((s: any) =>
      s.linkedDAGNode === id || s.schemaRef === node.output
    );
    if (!hasSchema) {
      status = 'missing-schema';
      messages.push(`No schema linked to node '${id}' (output: ${node.output})`);
    }

    const hasAgent = agents.some((a: any) =>
      (a.linkedNodes || a.linkedModules || []).includes(id)
    );
    if (!hasAgent) {
      if (status === 'ok') status = 'missing-agent';
      messages.push(`No agent assigned to DAG node '${id}'`);
    }

    const usedInPipeline = ops.pipelines?.some((p: any) =>
      p.entry === id || p.exit === id || (p.flow || []).includes(id)
    );
    if (!usedInPipeline) {
      if (status === 'ok') status = 'unlinked-pipeline';
      messages.push(`Node '${id}' is not referenced in any pipeline`);
    }

    results.push({ nodeId: id, status, messages });
  });

  return results;
}

// Execute replay
const results = replayCodex();
const logPath = path.resolve(__dirname, '..', 'codex', 'codex.replay.log.json');
fs.writeFileSync(logPath, JSON.stringify(results, null, 2));

console.log(`✅ Codex Replay complete. Log written to: ${logPath}\n`);

results.forEach((r) => {
  if (r.status !== 'ok') {
    console.warn(`⚠️  ${r.nodeId}: [${r.status}] → ${r.messages.join(' | ')}`);
  }
});