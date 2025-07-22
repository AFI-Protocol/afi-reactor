import afiEnsembleScorer from './plugins/afi-ensemble-scorer';

/**
 * signalDAG: Directed Acyclic Graph configuration for signal processing.
 * Each node represents a processing stage. This config defines how signals
 * move through scoring using the AFI Ensemble Scorer plugin.
 */

export const signalDAG = [
  // ... other DAG nodes,

  {
    /**
     * Node ID — must be unique across the DAG.
     * Used to reference this node in `input`/`output` fields.
     */
    id: 'afi-ensemble-score',

    /**
     * Node Type — defines the functional role of this node.
     * 'scorer' indicates this stage evaluates and scores signals.
     */
    type: 'scorer',

    /**
     * Plugin — the module that actually performs the scoring logic.
     * Here, it uses our custom AFI ensemble scoring strategy.
     */
    plugin: afiEnsembleScorer,

    /**
     * Input — the DAG node(s) that this scorer consumes data from.
     * Ensure 'analyzed-signal' exists as a prior stage in your DAG.
     */
    input: ['analyzed-signal'],

    /**
     * Output — the name for the result of this scoring step.
     * Downstream nodes will refer to 'scored-signal' as input.
     */
    output: 'scored-signal',

    /**
     * Tags — optional metadata for filtering or visualization.
     * Useful for tooling, debugging, and contributor docs.
     */
    tags: ['ensemble', 'validator', 'afi'],

    /**
     * Config — custom weights for this scoring module.
     * Adjust these to tune the balance of proof-of-intelligence (PoI)
     * versus proof-of-insight (PoInsight).
     */
    config: {
      poiWeight: 0.6,
      insightWeight: 0.4,
    },
  },
];