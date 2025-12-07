/**
 * Reactor DAG node contract (orchestration-only).
 *
 * This is the reactor-side TypeScript view of DAG nodes and is meant to mirror
 * `config/dag.codex.json`. Keep this aligned with the codex shape used by the
 * orchestrator and avoid token/TSSD/schema payload concerns here — those live
 * in infra/core, not in the reactor.
 */
export interface DAGNode {
  id: string;
  type: string;
  plugin: string;
  input: string[];
  output: string;
  description?: string;
  config?: Record<string, any>;
  schemaRef?: string;
  maintainedBy?: string[];
  codexVersion?: string;
  agentReady?: boolean;
  tags?: string[];
}
