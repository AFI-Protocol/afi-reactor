/**
 * AFI Reactor - Scout Node
 *
 * This node is responsible for:
 * - Scouting for new signals from external sources or AFI-native models
 * - Discovering potential trading opportunities
 * - Submitting signals to the enrichment pipeline
 * - Tracking signal submissions for reward attribution
 * - Adding trace entries for execution tracking
 *
 * Scout nodes are independent signal sources that execute BEFORE the enrichment stage.
 * They do NOT perform scoring, enrichment, or validation - those are handled by other nodes.
 *
 * Scout nodes have NO dependencies on enrichment nodes and must be configured as independent.
 *
 * @module afi-reactor/src/dag/plugins/ScoutNode
 */

import type { Pipehead, PipelineState } from '../../types/dag.js';

/**
 * Scout Node - Ingress Node
 *
 * The Scout node is an independent signal source that discovers and submits trading opportunities.
 * This is an optional ingress node that can be configured by analysts.
 *
 * Key characteristics:
 * - Executes BEFORE enrichment stage (no dependencies)
 * - Discovers signals from external sources or AFI-native models
 * - Does NOT perform scoring (that's Analyst's responsibility)
 * - Does NOT enrich signals (that's Enrichers' responsibility)
 * - Tracks submissions for reward attribution (important for third-party Scouts)
 */
export class ScoutNode implements Pipehead {
  /** Node ID. Must be unique within the DAG. */
  id = 'scout';

  /** Node type. Ingress nodes execute before enrichment stage. */
  type = 'ingress' as const;

  /** Plugin ID that implements this node. */
  plugin = 'scout';

  /** Whether this node can run in parallel with other nodes. */
  parallel = true;

  /** Node dependencies. Scout nodes must have NO dependencies - they are independent signal sources. */
  dependencies: string[] = [];

  /**
   * Executes the Scout node.
   *
   * This method:
   * 1. Scans market data for potential signals
   * 2. Identifies trading opportunities
   * 3. Stores discovered signals (NO SCORING - scoring is done by Analyst)
   * 4. Tracks signal submission for reward attribution
   * 5. Adds trace entries for execution tracking
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
   * @throws Error if scouting fails
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
      // Extract asset information from raw signal
      const assetInfo = this.extractAssetInfo(state.rawSignal);

      // Scout for signals (discover opportunities)
      const discoveredSignals = await this.scoutForSignals(assetInfo);

      // Store discovered signals (NO SCORING - scoring is done by Analyst node)
      state.enrichmentResults.set(this.id, {
        signals: discoveredSignals,
        totalSignals: discoveredSignals.length,
        discoveredAt: new Date().toISOString(),
        scoutId: this.getScoutId(),  // For reward attribution
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
   * Extracts asset information from the raw signal.
   *
   * @param rawSignal - The raw signal data
   * @returns Asset information
   * @private
   */
  private extractAssetInfo(rawSignal: unknown): {
    symbol?: string;
    assetId?: string;
  } {
    // Placeholder implementation
    // In a real implementation, this would extract asset information from the signal
    if (typeof rawSignal === 'object' && rawSignal !== null) {
      const signal = rawSignal as Record<string, unknown>;
      return {
        symbol: signal.symbol as string,
        assetId: signal.assetId as string,
      };
    }

    return { symbol: 'BTC', assetId: 'bitcoin' };
  }

  /**
   * Scouts for new signals.
   *
   * @param assetInfo - The asset information
   * @returns Promise<DiscoveredSignal[]> - The discovered signals
   * @private
   */
  private async scoutForSignals(assetInfo: {
    symbol?: string;
    assetId?: string;
  }): Promise<
    Array<{
      type: string;
      description: string;
      timestamp: string;
      metadata: Record<string, unknown>;
    }>
  > {
    // Placeholder implementation
    // In a real implementation, this would scan market data for signals

    // Simulate scouting delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Return mock discovered signals
    return [
      {
        type: 'price-breakout',
        description: 'Price broke above resistance level',
        timestamp: new Date().toISOString(),
        metadata: {
          resistanceLevel: 50000,
          currentPrice: 50500,
          volume: 1000000,
        },
      },
      {
        type: 'volume-spike',
        description: 'Unusual volume spike detected',
        timestamp: new Date().toISOString(),
        metadata: {
          averageVolume: 500000,
          currentVolume: 1000000,
          spikeRatio: 2.0,
        },
      },
    ];
  }

  /**
   * Gets the Scout ID for reward attribution.
   *
   * This ID is used to track which Scout submitted a signal for potential rewards.
   * Third-party Scouts earn tokens by submitting qualifying signals.
   *
   * @returns The Scout ID
   * @private
   */
  private getScoutId(): string {
    // In a real implementation, this would be configured or derived from credentials
    // For now, return a default Scout ID
    return 'scout:afi-native:v1';
  }
}
