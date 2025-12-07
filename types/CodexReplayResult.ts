/**
 * Codex replay result contract (v0.1).
 *
 * Used by codex lint / DAG integrity tooling to report node health inside the
 * reactor. This is reactor-internal only — not for signals, vault payloads, or
 * any token/TSSD schemas.
 */
export interface CodexReplayResult {
  nodeId: string;
  status: 'ok' | 'missing-schema' | 'missing-agent' | 'unlinked-pipeline';
  messages: string[];
}
