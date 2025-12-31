/**
 * AFI Reactor - Execution Node
 *
 * This node is responsible for:
 * - Aggregating enrichment results from all enrichment nodes
 * - Generating the final scored signal
 * - Preparing the signal for the observer
 * - Adding trace entries for execution tracking
 *
 * @module afi-reactor/src/dag/nodes/ExecutionNode
 */

import type { Pipehead, PipelineState } from '../../types/dag.js';

/**
 * Execution Node - Required Node
 *
 * The Execution node is the second required node in the DAG.
 * It aggregates enrichment results and generates the final scored signal.
 */
export class ExecutionNode implements Pipehead {
  /** Node ID. Must be unique within the DAG. */
  id = 'execution';

  /** Node type. Required nodes are always present in the DAG. */
  type = 'required' as const;

  /** Plugin ID that implements this node. */
  plugin = 'execution';

  /** Whether this node can run in parallel with other nodes. */
  parallel = false;

  /** Node dependencies. The DAG will ensure all dependencies complete before executing this node. */
  dependencies: string[] = [];

  /**
   * Executes the Execution node.
   *
   * This method:
   * 1. Aggregates enrichment results from all enrichment nodes
   * 2. Validates enrichment results
   * 3. Generates the final scored signal
   * 4. Prepares the signal for the observer
   * 5. Adds trace entries for execution tracking
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
   * @throws Error if enrichment results are invalid or signal generation fails
   */
  async execute(state: PipelineState): Promise<PipelineState> {
    const startTime = Date.now();
    const startTimeIso = new Date(startTime).toISOString();

    // Create a trace entry for the start of execution
    const traceEntry = {
      nodeId: this.id,
      nodeType: this.type,
      startTime: startTimeIso,
      status: 'running' as const,
    };

    try {
      // Aggregate enrichment results
      const aggregatedResults = this.aggregateEnrichmentResults(state);

      // Validate enrichment results
      this.validateEnrichmentResults(aggregatedResults);

      // Generate scored signal
      const scoredSignal = await this.generateScoredSignal(state, aggregatedResults);

      // Store the scored signal in the state
      state.enrichmentResults.set('scored-signal', scoredSignal);

      // Prepare signal for observer
      this.prepareSignalForObserver(state, scoredSignal);

      // Update trace entry with completion status
      const endTime = Date.now();
      const endTimeIso = new Date(endTime).toISOString();
      const duration = endTime - startTime;

      const completedTraceEntry = {
        ...traceEntry,
        endTime: endTimeIso,
        duration,
        status: 'completed' as const,
      };

      state.metadata.trace.push(completedTraceEntry);

      return state;
    } catch (error) {
      // Update trace entry with failure status
      const endTime = Date.now();
      const endTimeIso = new Date(endTime).toISOString();
      const duration = endTime - startTime;

      const failedTraceEntry = {
        ...traceEntry,
        endTime: endTimeIso,
        duration,
        status: 'failed' as const,
        error: error instanceof Error ? error.message : String(error),
      };

      state.metadata.trace.push(failedTraceEntry);

      throw error;
    }
  }

  /**
   * Aggregates enrichment results from all enrichment nodes.
   *
   * This method:
   * 1. Collects all enrichment results from the state
   * 2. Filters out internal metadata entries
   * 3. Returns a map of node ID to enrichment result
   *
   * @param state - The current pipeline state
   * @returns Map<string, unknown> - The aggregated enrichment results
   * @private
   */
  private aggregateEnrichmentResults(state: PipelineState): Map<string, unknown> {
    const aggregated = new Map<string, unknown>();

    // Internal keys to exclude from aggregation
    const internalKeys = new Set([
      'enabled-nodes',
      'node-execution-order',
      'signal-metadata',
      'scored-signal',
    ]);

    // Collect all enrichment results
    for (const [nodeId, result] of state.enrichmentResults) {
      // Skip internal metadata entries
      if (!internalKeys.has(nodeId)) {
        aggregated.set(nodeId, result);
      }
    }

    return aggregated;
  }

  /**
   * Validates enrichment results.
   *
   * This method:
   * 1. Checks that enrichment results are not empty
   * 2. Validates each enrichment result
   * 3. Checks for failed enrichment nodes
   *
   * @param results - The enrichment results to validate
   * @throws Error if enrichment results are invalid
   * @private
   */
  private validateEnrichmentResults(results: Map<string, unknown>): void {
    if (results.size === 0) {
      throw new Error('No enrichment results found');
    }

    // Check for failed enrichment nodes
    const failedNodes: string[] = [];
    for (const [nodeId, result] of results) {
      if (result === null || result === undefined) {
        failedNodes.push(nodeId);
      }
    }

    if (failedNodes.length > 0) {
      throw new Error(`Enrichment nodes failed: ${failedNodes.join(', ')}`);
    }
  }

  /**
   * Generates the final scored signal.
   *
   * This method:
   * 1. Combines the raw signal with enrichment results
   * 2. Calculates the final score
   * 3. Generates confidence metrics
   * 4. Creates the scored signal envelope
   *
   * @param state - The current pipeline state
   * @param enrichmentResults - The aggregated enrichment results
   * @returns Promise<unknown> - The scored signal
   * @throws Error if signal generation fails
   * @private
   */
  private async generateScoredSignal(
    state: PipelineState,
    enrichmentResults: Map<string, unknown>
  ): Promise<unknown> {
    try {
      // Calculate the final score based on enrichment results
      const score = this.calculateScore(state, enrichmentResults);

      // Calculate confidence metrics
      const confidence = this.calculateConfidence(state, enrichmentResults);

      // Create the scored signal envelope
      const scoredSignal = {
        signalId: state.signalId,
        analystId: state.analystConfig.analystId,
        rawSignal: state.rawSignal,
        score,
        confidence,
        enrichmentResults: Object.fromEntries(enrichmentResults),
        metadata: {
          generatedAt: new Date().toISOString(),
          enrichmentNodesExecuted: Array.from(enrichmentResults.keys()),
          executionTrace: state.metadata.trace,
        },
      };

      return scoredSignal;
    } catch (error) {
      throw new Error(
        `Failed to generate scored signal: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Calculates the final score based on enrichment results.
   *
   * This is a placeholder implementation. In a real implementation,
   * this would use a scoring algorithm based on the enrichment results.
   *
   * @param state - The current pipeline state
   * @param enrichmentResults - The aggregated enrichment results
   * @returns number - The calculated score
   * @private
   */
  private calculateScore(state: PipelineState, enrichmentResults: Map<string, unknown>): number {
    // Placeholder implementation
    // In a real implementation, this would use a scoring algorithm
    // based on the enrichment results and analyst configuration

    let score = 0.5; // Default neutral score

    // Example: Adjust score based on enrichment results
    for (const [nodeId, result] of enrichmentResults) {
      if (typeof result === 'object' && result !== null) {
        const resultObj = result as Record<string, unknown>;
        if (typeof resultObj.score === 'number') {
          score = (score + resultObj.score) / 2;
        }
      }
    }

    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculates confidence metrics based on enrichment results.
   *
   * This is a placeholder implementation. In a real implementation,
   * this would use a confidence calculation algorithm based on
   * the enrichment results and their quality.
   *
   * @param state - The current pipeline state
   * @param enrichmentResults - The aggregated enrichment results
   * @returns number - The calculated confidence
   * @private
   */
  private calculateConfidence(
    state: PipelineState,
    enrichmentResults: Map<string, unknown>
  ): number {
    // Placeholder implementation
    // In a real implementation, this would use a confidence calculation
    // algorithm based on the enrichment results and their quality

    let confidence = 0.5; // Default confidence

    // Example: Adjust confidence based on number of enrichment results
    const resultCount = enrichmentResults.size;
    confidence = Math.min(1, confidence + (resultCount * 0.05));

    // Example: Adjust confidence based on execution trace
    const completedNodes = state.metadata.trace.filter(
      entry => entry.status === 'completed'
    ).length;
    const totalNodes = state.metadata.trace.length;
    if (totalNodes > 0) {
      confidence = confidence * (completedNodes / totalNodes);
    }

    // Ensure confidence is between 0 and 1
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Prepares the signal for the observer.
   *
   * This method:
   * 1. Validates the scored signal
   * 2. Adds observer metadata
   * 3. Stores the prepared signal in the state
   *
   * @param state - The current pipeline state
   * @param scoredSignal - The scored signal to prepare
   * @private
   */
  private prepareSignalForObserver(state: PipelineState, scoredSignal: unknown): void {
    // Validate scored signal
    if (!scoredSignal || typeof scoredSignal !== 'object') {
      throw new Error('Invalid scored signal');
    }

    // Add observer metadata
    const observerMetadata = {
      preparedAt: new Date().toISOString(),
      signalId: state.signalId,
      analystId: state.analystConfig.analystId,
      readyForObserver: true,
    };

    // Store the observer metadata in the state
    state.enrichmentResults.set('observer-metadata', observerMetadata);
  }
}
