/**
 * AFI Reactor - Observer Node
 *
 * This node is responsible for:
 * - Observing the final scored signal
 * - Logging execution metrics
 * - Publishing the signal to downstream consumers
 * - Adding trace entries for execution tracking
 *
 * @module afi-reactor/src/dag/nodes/ObserverNode
 */

import type { Pipehead, PipelineState } from '../../types/dag.js';

/**
 * Observer Node - Required Node
 *
 * The Observer node is the third and final required node in the DAG.
 * It observes the final scored signal and publishes it to downstream consumers.
 */
export class ObserverNode implements Pipehead {
  /** Node ID. Must be unique within the DAG. */
  id = 'observer';

  /** Node type. Required nodes are always present in the DAG. */
  type = 'required' as const;

  /** Plugin ID that implements this node. */
  plugin = 'observer';

  /** Whether this node can run in parallel with other nodes. */
  parallel = false;

  /** Node dependencies. The DAG will ensure all dependencies complete before executing this node. */
  dependencies: string[] = [];

  /**
   * Executes the Observer node.
   *
   * This method:
   * 1. Retrieves the scored signal from the state
   * 2. Validates the scored signal
   * 3. Logs execution metrics
   * 4. Publishes the signal to downstream consumers
   * 5. Adds trace entries for execution tracking
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
   * @throws Error if scored signal is missing or publishing fails
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
      // Get scored signal from state
      const scoredSignal = this.getScoredSignal(state);

      // Validate scored signal
      this.validateScoredSignal(scoredSignal);

      // Log execution metrics
      this.logExecutionMetrics(state);

      // Publish signal to downstream consumers
      await this.publishSignal(scoredSignal);

      // Store publication metadata in the state
      this.storePublicationMetadata(state, scoredSignal);

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
   * Retrieves the scored signal from the state.
   *
   * @param state - The current pipeline state
   * @returns unknown - The scored signal
   * @throws Error if scored signal is missing
   * @private
   */
  private getScoredSignal(state: PipelineState): unknown {
    const scoredSignal = state.enrichmentResults.get('scored-signal');

    if (!scoredSignal) {
      throw new Error('No scored signal found in state');
    }

    return scoredSignal;
  }

  /**
   * Validates the scored signal.
   *
   * This method:
   * 1. Checks that the scored signal is an object
   * 2. Checks for required fields (signalId, analystId, score, confidence)
   * 3. Validates the score and confidence values
   *
   * @param scoredSignal - The scored signal to validate
   * @throws Error if scored signal is invalid
   * @private
   */
  private validateScoredSignal(scoredSignal: unknown): void {
    if (!scoredSignal || typeof scoredSignal !== 'object') {
      throw new Error('Invalid scored signal: must be an object');
    }

    const signal = scoredSignal as Record<string, unknown>;

    // Check for required fields
    if (!signal.signalId || typeof signal.signalId !== 'string') {
      throw new Error('Invalid scored signal: missing or invalid signalId');
    }

    if (!signal.analystId || typeof signal.analystId !== 'string') {
      throw new Error('Invalid scored signal: missing or invalid analystId');
    }

    if (typeof signal.score !== 'number') {
      throw new Error('Invalid scored signal: missing or invalid score');
    }

    if (typeof signal.confidence !== 'number') {
      throw new Error('Invalid scored signal: missing or invalid confidence');
    }

    // Validate score range
    if (signal.score < 0 || signal.score > 1) {
      throw new Error('Invalid scored signal: score must be between 0 and 1');
    }

    // Validate confidence range
    if (signal.confidence < 0 || signal.confidence > 1) {
      throw new Error('Invalid scored signal: confidence must be between 0 and 1');
    }
  }

  /**
   * Logs execution metrics.
   *
   * This method:
   * 1. Calculates total execution time
   * 2. Counts executed and failed nodes
   * 3. Logs the execution metrics to console
   *
   * @param state - The current pipeline state
   * @private
   */
  private logExecutionMetrics(state: PipelineState): void {
    const metrics = this.calculateExecutionMetrics(state);

    // Log execution metrics
    console.log({
      signalId: state.signalId,
      analystId: state.analystConfig.analystId,
      executionMetrics: metrics,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Calculates execution metrics from the state.
   *
   * @param state - The current pipeline state
   * @returns Execution metrics
   * @private
   */
  private calculateExecutionMetrics(state: PipelineState): {
    totalTime: number;
    nodesExecuted: number;
    nodesFailed: number;
    nodesPending: number;
    nodesRunning: number;
  } {
    const startTime = new Date(state.metadata.startTime).getTime();
    const endTime = Date.now();
    const totalTime = endTime - startTime;

    const nodesExecuted = state.metadata.trace.filter(
      entry => entry.status === 'completed'
    ).length;

    const nodesFailed = state.metadata.trace.filter(
      entry => entry.status === 'failed'
    ).length;

    const nodesPending = state.metadata.trace.filter(
      entry => entry.status === 'pending'
    ).length;

    const nodesRunning = state.metadata.trace.filter(
      entry => entry.status === 'running'
    ).length;

    return {
      totalTime,
      nodesExecuted,
      nodesFailed,
      nodesPending,
      nodesRunning,
    };
  }

  /**
   * Publishes the signal to downstream consumers.
   *
   * This is a placeholder implementation. In a real implementation,
   * this would publish the signal to downstream consumers such as:
   * - Message queues (e.g., RabbitMQ, Kafka)
   * - Webhooks
   * - Databases
   * - External APIs
   *
   * @param scoredSignal - The scored signal to publish
   * @returns Promise<void>
   * @throws Error if publishing fails
   * @private
   */
  private async publishSignal(scoredSignal: unknown): Promise<void> {
    try {
      // Placeholder implementation
      // In a real implementation, this would publish the signal to downstream consumers

      // Example: Log that the signal would be published
      console.log('Publishing scored signal to downstream consumers:', {
        signalId: (scoredSignal as Record<string, unknown>).signalId,
        analystId: (scoredSignal as Record<string, unknown>).analystId,
        score: (scoredSignal as Record<string, unknown>).score,
        confidence: (scoredSignal as Record<string, unknown>).confidence,
        publishedAt: new Date().toISOString(),
      });

      // Example: Publish to a message queue
      // await messageQueue.publish('afi-signals', scoredSignal);

      // Example: Send webhook
      // await webhookClient.send(scoredSignal);

      // Example: Store in database
      // await database.insert('scored_signals', scoredSignal);
    } catch (error) {
      throw new Error(
        `Failed to publish signal: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Stores publication metadata in the state.
   *
   * This method:
   * 1. Creates publication metadata
   * 2. Stores it in the state for later reference
   *
   * @param state - The current pipeline state
   * @param scoredSignal - The scored signal that was published
   * @private
   */
  private storePublicationMetadata(state: PipelineState, scoredSignal: unknown): void {
    const publicationMetadata = {
      publishedAt: new Date().toISOString(),
      signalId: (scoredSignal as Record<string, unknown>).signalId as string,
      analystId: (scoredSignal as Record<string, unknown>).analystId as string,
      score: (scoredSignal as Record<string, unknown>).score as number,
      confidence: (scoredSignal as Record<string, unknown>).confidence as number,
      status: 'published',
    };

    // Store the publication metadata in the state
    state.enrichmentResults.set('publication-metadata', publicationMetadata);
  }
}
