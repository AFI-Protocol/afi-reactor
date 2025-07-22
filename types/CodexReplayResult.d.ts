// types/CodexReplayResult.d.ts

export type CodexReplayResult = {
  nodeId: string;
  status: 'ok' | 'missing-schema' | 'missing-agent' | 'unlinked-pipeline';
  messages: string[];
};