/**
 * AFI Reactor - Signal Ingress Node
 *
 * This node is responsible for:
 * - Ingesting signals from external sources
 * - Validating incoming signals
 * - Normalizing signal data
 * - Storing signal ingress results in enrichment results
 * - Adding trace entries for execution tracking
 *
 * @module afi-reactor/src/dag/plugins/SignalIngressNode
 */

import type { Pipehead, PipelineState } from '../../types/dag.js';

/**
 * Signal Ingress Node - Ingress Node
 *
 * The Signal Ingress node ingests signals from external sources.
 * This is an optional ingress node that can be configured by analysts.
 */
export class SignalIngressNode implements Pipehead {
  /** Node ID. Must be unique within the DAG. */
  id = 'signal-ingress';

  /** Node type. Ingress nodes are analyst-configurable. */
  type = 'ingress' as const;

  /** Plugin ID that implements this node. */
  plugin = 'signal-ingress';

  /** Whether this node can run in parallel with other nodes. */
  parallel = true;

  /** Node dependencies. The DAG will ensure all dependencies complete before executing this node. */
  dependencies: string[] = [];

  /**
   * Executes the Signal Ingress node.
   *
   * This method:
   * 1. Ingests signals from external sources
   * 2. Validates incoming signals
   * 3. Normalizes signal data
   * 4. Stores signal ingress results in enrichment results
   * 5. Adds trace entries for execution tracking
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
   * @throws Error if signal ingestion fails
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
      // Ingest signals from external sources
      const ingestedSignals = await this.ingestSignals();

      // Validate incoming signals
      const validatedSignals = this.validateSignals(ingestedSignals);

      // Normalize signal data
      const normalizedSignals = this.normalizeSignals(validatedSignals);

      // Store signal ingress results in enrichment results
      state.enrichmentResults.set(this.id, {
        signals: normalizedSignals,
        totalSignals: ingestedSignals.length,
        validSignals: validatedSignals.length,
        normalizedSignals: normalizedSignals.length,
        ingestedAt: new Date().toISOString(),
      });

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
   * Ingests signals from external sources.
   *
   * @returns Promise<IngestedSignal[]> - The ingested signals
   * @private
   */
  private async ingestSignals(): Promise<
    Array<{
      source: string;
      signalId: string;
      timestamp: string;
      data: Record<string, unknown>;
    }>
  > {
    // Placeholder implementation
    // In a real implementation, this would ingest signals from external APIs

    // Simulate ingestion delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Return mock ingested signals
    return [
      {
        source: 'external-api-1',
        signalId: 'ext-signal-001',
        timestamp: new Date().toISOString(),
        data: {
          type: 'price-alert',
          symbol: 'BTC',
          price: 50500,
          threshold: 50000,
        },
      },
      {
        source: 'external-api-2',
        signalId: 'ext-signal-002',
        timestamp: new Date().toISOString(),
        data: {
          type: 'volume-alert',
          symbol: 'ETH',
          volume: 5000000,
          threshold: 4000000,
        },
      },
    ];
  }

  /**
   * Validates incoming signals.
   *
   * @param signals - The signals to validate
   * @returns Validated signals
   * @private
   */
  private validateSignals(
    signals: Array<{
      source: string;
      signalId: string;
      timestamp: string;
      data: Record<string, unknown>;
    }>
  ): Array<{
    source: string;
    signalId: string;
    timestamp: string;
    data: Record<string, unknown>;
    valid: boolean;
    validationErrors: string[];
  }> {
    return signals.map(signal => {
      const validationErrors: string[] = [];

      // Validate signal ID
      if (!signal.signalId || typeof signal.signalId !== 'string') {
        validationErrors.push('Invalid or missing signalId');
      }

      // Validate timestamp
      if (!signal.timestamp || typeof signal.timestamp !== 'string') {
        validationErrors.push('Invalid or missing timestamp');
      }

      // Validate data
      if (!signal.data || typeof signal.data !== 'object') {
        validationErrors.push('Invalid or missing data');
      }

      // Validate source
      if (!signal.source || typeof signal.source !== 'string') {
        validationErrors.push('Invalid or missing source');
      }

      return {
        ...signal,
        valid: validationErrors.length === 0,
        validationErrors,
      };
    });
  }

  /**
   * Normalizes signal data.
   *
   * @param signals - The signals to normalize
   * @returns Normalized signals
   * @private
   */
  private normalizeSignals(
    signals: Array<{
      source: string;
      signalId: string;
      timestamp: string;
      data: Record<string, unknown>;
      valid: boolean;
      validationErrors: string[];
    }>
  ): Array<{
    source: string;
    signalId: string;
    timestamp: string;
    data: Record<string, unknown>;
    valid: boolean;
    validationErrors: string[];
    normalized: boolean;
    normalizedAt: string;
  }> {
    return signals
      .filter(signal => signal.valid)
      .map(signal => {
        // Placeholder normalization logic
        // In a real implementation, this would normalize signal data to a standard format

        return {
          ...signal,
          normalized: true,
          normalizedAt: new Date().toISOString(),
        };
      });
  }
}
