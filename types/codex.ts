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