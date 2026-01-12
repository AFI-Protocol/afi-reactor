import type { Pipehead, PipelineState } from '../src/types/dag.js';

/**
 * Starter Enrichment Plugin
 *
 * Minimal no-op example deployers can copy to build custom enrichment steps.
 * Keeps state unchanged while proving the Pipehead contract.
 */
class StarterEnrichmentPlugin implements Pipehead {
  id = 'starter-enrichment';
  type = 'enrichment' as const;
  plugin = 'starter-enrichment';
  parallel = true;
  dependencies: string[] = [];

  async execute(state: PipelineState): Promise<PipelineState> {
    return state;
  }
}

export default new StarterEnrichmentPlugin();
