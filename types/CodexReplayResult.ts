// types/CodexReplayResult.ts
export interface CodexReplayResult {
  nodeId: string;
  status: 'ok' | 'missing-schema' | 'missing-agent' | 'unlinked-pipeline';
  messages: string[];
}
