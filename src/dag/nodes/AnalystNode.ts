/**
 * AFI Reactor - Analyst Node
 *
 * This node is responsible for:
 * - Loading the analyst configuration from afi-factory
 * - Initializing the enrichment pipeline
 * - Preparing the signal for enrichment
 * - Aggregating all enrichment results (including AI/ML predictions)
 * - Scoring signals from Scout nodes using ensemble ML models and AI/ML predictions
 * - Generating narratives and interpretations based on enriched signals
 * - Adding trace entries for execution tracking
 *
 * @module afi-reactor/src/dag/nodes/AnalystNode
 */

import type { Pipehead, PipelineState } from '../../types/dag.js';
import type { AnalystConfig } from 'afi-factory/schemas/index.js';

/**
 * Analyst Node - Required Node
 *
 * The Analyst node is the final required node in the DAG.
 * It aggregates all enrichment results, scores signals, and generates narratives.
 *
 * Key responsibilities:
 * - Load analyst configuration
 * - Aggregate enrichment results from all enrichment nodes (including AI/ML)
 * - Score signals using ensemble ML models and AI/ML predictions
 * - Generate narratives and interpretations
 * - Propose trading actions
 */
export class AnalystNode implements Pipehead {
  /** Node ID. Must be unique within the DAG. */
  id = 'analyst';

  /** Node type. Required nodes are always present in the DAG. */
  type = 'required' as const;

  /** Plugin ID that implements this node. */
  plugin = 'analyst';

  /** Whether this node can run in parallel with other nodes. */
  parallel = false;

  /** Node dependencies. The DAG will ensure all dependencies complete before executing this node. */
  dependencies: string[] = [];

  /**
   * Executes the Analyst node.
   *
   * This method:
   * 1. Loads the analyst configuration from afi-factory
   * 2. Validates the configuration
   * 3. Initializes the enrichment pipeline
   * 4. Prepares the signal for enrichment
   * 5. Aggregates all enrichment results (including AI/ML predictions)
   * 6. Scores signals from Scout nodes using ensemble ML models and AI/ML predictions
   * 7. Generates narratives based on enriched signals
   * 8. Stores scored signals and narratives in state
   * 9. Adds trace entries for execution tracking
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
   * @throws Error if analyst configuration cannot be loaded or is invalid
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
      // Load analyst configuration
      const analystConfig = await this.loadAnalystConfig(state.analystConfig.analystId);

      // Validate analyst configuration
      this.validateAnalystConfig(analystConfig);

      // Update state with loaded configuration
      state.analystConfig = analystConfig;

      // Initialize enrichment pipeline
      this.initializeEnrichmentPipeline(state);

      // Prepare signal for enrichment
      this.prepareSignalForEnrichment(state);

      // Aggregate all enrichment results (including AI/ML)
      const aggregatedResults = this.aggregateEnrichmentResults(state);

      // Get AI/ML predictions if available
      const aiMlPrediction = state.enrichmentResults.get('ai-ml') as any;

      // Score signals (incorporating AI/ML predictions)
      const scoredSignals = this.scoreSignals(aggregatedResults, aiMlPrediction);

      // Generate narratives
      const narratives = this.generateNarratives(scoredSignals, aiMlPrediction);

      // Store results
      state.enrichmentResults.set('scored-signal', scoredSignals);
      state.enrichmentResults.set('narratives', narratives);

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
   * Loads the analyst configuration from afi-factory.
   *
   * @param analystId - The analyst ID to load configuration for
   * @returns Promise<AnalystConfig> - The loaded analyst configuration
   * @throws Error if configuration cannot be loaded
   * @private
   */
  private async loadAnalystConfig(analystId: string): Promise<AnalystConfig> {
    try {
      // Import loadAnalystConfig from afi-factory
      // Note: This is a placeholder implementation
      // In a real implementation, this would call loadAnalystConfig from afi-factory/template_registry.ts
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      const config = await loadAnalystConfig(analystId);

      // Return the configuration (without validation fields)
      const { valid, errors, warnings, ...analystConfig } = config;
      return analystConfig as AnalystConfig;
    } catch (error) {
      throw new Error(
        `Failed to load analyst configuration for analyst '${analystId}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Validates the analyst configuration.
   *
   * @param config - The analyst configuration to validate
   * @throws Error if configuration is invalid
   * @private
   */
  private validateAnalystConfig(config: AnalystConfig): void {
    if (!config.analystId) {
      throw new Error('Analyst configuration missing analystId');
    }

    if (!config.enrichmentNodes || !Array.isArray(config.enrichmentNodes)) {
      throw new Error('Analyst configuration missing or invalid enrichmentNodes');
    }

    // Validate each enrichment node
    for (const node of config.enrichmentNodes) {
      if (!node.id) {
        throw new Error('Enrichment node missing id');
      }

      if (!node.type || !['enrichment', 'ingress'].includes(node.type)) {
        throw new Error(`Enrichment node '${node.id}' has invalid type`);
      }

      if (!node.plugin) {
        throw new Error(`Enrichment node '${node.id}' missing plugin`);
      }

      if (typeof node.enabled !== 'boolean') {
        throw new Error(`Enrichment node '${node.id}' missing or invalid enabled field`);
      }
    }
  }

  /**
   * Initializes the enrichment pipeline.
   *
   * This method prepares the enrichment pipeline by:
   * 1. Filtering enabled enrichment nodes
   * 2. Sorting nodes by dependencies
   * 3. Preparing node execution order
   *
   * @param state - The current pipeline state
   * @private
   */
  private initializeEnrichmentPipeline(state: PipelineState): void {
    // Filter enabled enrichment nodes
    const enabledNodes = state.analystConfig.enrichmentNodes.filter(node => node.enabled);

    // Store the enabled nodes in the state for later use
    state.enrichmentResults.set('enabled-nodes', enabledNodes);

    // Sort nodes by dependencies (topological sort)
    const sortedNodes = this.topologicalSort(enabledNodes);

    // Store the sorted nodes in the state
    state.enrichmentResults.set('node-execution-order', sortedNodes);
  }

  /**
   * Prepares the signal for enrichment.
   *
   * This method prepares the signal by:
   * 1. Validating the raw signal
   * 2. Adding metadata to the signal
   * 3. Storing the prepared signal in the state
   *
   * @param state - The current pipeline state
   * @private
   */
  private prepareSignalForEnrichment(state: PipelineState): void {
    // Validate raw signal
    if (!state.rawSignal) {
      throw new Error('Raw signal is missing');
    }

    // Prepare signal metadata
    const signalMetadata = {
      signalId: state.signalId,
      analystId: state.analystConfig.analystId,
      timestamp: new Date().toISOString(),
      preparedAt: new Date().toISOString(),
    };

    // Store the prepared signal metadata in the state
    state.enrichmentResults.set('signal-metadata', signalMetadata);
  }

  /**
   * Performs topological sort on enrichment nodes based on dependencies.
   *
   * @param nodes - The enrichment nodes to sort
   * @returns Array<EnrichmentNodeConfig> - The sorted nodes
   * @private
   */
  private topologicalSort(nodes: Array<{ id: string; dependencies?: string[] }>): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (nodeId: string): void => {
      if (visiting.has(nodeId)) {
        throw new Error(`Circular dependency detected involving node '${nodeId}'`);
      }

      if (visited.has(nodeId)) {
        return;
      }

      visiting.add(nodeId);

      const node = nodes.find(n => n.id === nodeId);
      if (node && node.dependencies) {
        for (const depId of node.dependencies) {
          visit(depId);
        }
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
      sorted.push(nodeId);
    };

    for (const node of nodes) {
      visit(node.id);
    }

    return sorted;
  }

  /**
   * Aggregates all enrichment results from the enrichment stage.
   *
   * This method collects results from all enrichment nodes including:
   * - Technical indicators
   * - Pattern recognition
   * - Sentiment analysis
   * - News analysis
   * - AI/ML predictions
   * - Scout signals
   *
   * @param state - The current pipeline state
   * @returns Aggregated enrichment results
   * @private
   */
  private aggregateEnrichmentResults(state: PipelineState): Record<string, unknown> {
    const aggregated: Record<string, unknown> = {};

    // Collect results from all enrichment nodes
    const enrichmentNodeIds = [
      'technical-indicators',
      'pattern-recognition',
      'sentiment',
      'news',
      'ai-ml',
      'scout',
    ];

    for (const nodeId of enrichmentNodeIds) {
      const result = state.enrichmentResults.get(nodeId);
      if (result) {
        aggregated[nodeId] = result;
      }
    }

    return aggregated;
  }

  /**
   * Scores signals from Scout nodes using ensemble ML models and AI/ML predictions.
   *
   * This method:
   * 1. Extracts signals from Scout nodes
   * 2. Applies ensemble ML scoring
   * 3. Incorporates AI/ML predictions from the AiMlNode
   * 4. Returns scored signals with confidence levels and priorities
   *
   * @param aggregatedResults - The aggregated enrichment results
   * @param aiMlPrediction - The AI/ML predictions from AiMlNode (optional)
   * @returns Scored signals
   * @private
   */
  private scoreSignals(
    aggregatedResults: Record<string, unknown>,
    aiMlPrediction?: unknown
  ): Array<{
    type: string;
    description: string;
    timestamp: string;
    metadata: Record<string, unknown>;
    confidence: number;
    priority: 'high' | 'medium' | 'low';
    aiMlInsights?: unknown;
  }> {
    // Extract Scout signals
    const scoutResult = aggregatedResults['scout'] as any;
    const scoutSignals = scoutResult?.signals || [];

    // Score each signal
    return scoutSignals.map((signal: any) => {
      // Placeholder scoring logic
      // In a real implementation, this would use sophisticated ensemble ML models
      let confidence = 0.5;
      let priority: 'high' | 'medium' | 'low' = 'medium';

      // Base scoring based on signal type
      if (signal.type === 'price-breakout') {
        confidence = 0.7;
        priority = 'medium';
      } else if (signal.type === 'volume-spike') {
        confidence = 0.6;
        priority = 'medium';
      }

      // Incorporate AI/ML predictions if available
      if (aiMlPrediction && typeof aiMlPrediction === 'object') {
        const prediction = aiMlPrediction as any;
        if (prediction.aiMl && prediction.aiMl.convictionScore !== undefined) {
          // Adjust confidence based on AI/ML conviction score
          const convictionScore = prediction.aiMl.convictionScore;
          confidence = (confidence + convictionScore) / 2;

          // Adjust priority based on conviction score
          if (convictionScore >= 0.8) {
            priority = 'high';
          } else if (convictionScore >= 0.6) {
            priority = 'medium';
          } else {
            priority = 'low';
          }
        }
      }

      return {
        ...signal,
        confidence,
        priority,
        aiMlInsights: aiMlPrediction,
      };
    });
  }

  /**
   * Generates narratives based on scored signals and AI/ML insights.
   *
   * This method creates human-readable interpretations of the signals,
   * incorporating insights from AI/ML predictions.
   *
   * @param scoredSignals - The scored signals
   * @param aiMlPrediction - The AI/ML predictions from AiMlNode (optional)
   * @returns Generated narratives
   * @private
   */
  private generateNarratives(
    scoredSignals: Array<{
      type: string;
      description: string;
      timestamp: string;
      metadata: Record<string, unknown>;
      confidence: number;
      priority: 'high' | 'medium' | 'low';
      aiMlInsights?: unknown;
    }>,
    aiMlPrediction?: unknown
  ): Array<{
    signalType: string;
    narrative: string;
    confidence: number;
    priority: 'high' | 'medium' | 'low';
    aiMlInsights?: string;
  }> {
    return scoredSignals.map(signal => {
      let narrative = signal.description;

      // Add AI/ML insights to narrative if available
      let aiMlInsights: string | undefined;
      if (signal.aiMlInsights && typeof signal.aiMlInsights === 'object') {
        const prediction = signal.aiMlInsights as any;
        if (prediction.aiMl) {
          const { convictionScore, direction, regime, riskFlag } = prediction.aiMl;
          aiMlInsights = `AI/ML conviction: ${convictionScore?.toFixed(2)}, direction: ${direction}, regime: ${regime}, risk: ${riskFlag}`;
          narrative += ` ${aiMlInsights}`;
        }
      }

      return {
        signalType: signal.type,
        narrative,
        confidence: signal.confidence,
        priority: signal.priority,
        aiMlInsights,
      };
    });
  }
}
