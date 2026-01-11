/**
 * AFI Reactor - AI/ML Node
 *
 * This node is responsible for:
 * - Interfacing with ML providers through the provider abstraction layer
 * - Building MLProviderInput from enrichment results
 * - Storing AI/ML predictions in enrichment results
 * - Maintaining fail-soft behavior
 *
 * @module afi-reactor/src/dag/plugins/AiMlNode
 */

import type { Pipehead, PipelineState } from '../../types/dag.js';
import { MLProviderRegistry } from '../../aiMl/providers/MLProviderRegistry.js';
import type { MLProviderInput, MLProviderOutput, MLProviderFactory } from '../../aiMl/providers/types.js';
import { TinyBrainsProvider } from '../../aiMl/providers/TinyBrainsProvider.js';

/**
 * AI/ML Node - Enrichment Node
 *
 * The AI/ML node interfaces with ML providers through the provider abstraction layer.
 * This is an optional enrichment node that can be configured by analysts.
 * It depends on technical-indicators, pattern-recognition, sentiment, and news nodes.
 *
 * The node uses the MLProviderRegistry to select the best available provider
 * for each prediction request, enabling support for multiple ML providers
 * through a unified interface.
 */
export class AiMlNode implements Pipehead {
  /** Node ID. Must be unique within the DAG. */
  id = 'ai-ml';

  /** Node type. Enrichment nodes are analyst-configurable. */
  type = 'enrichment' as const;

  /** Plugin ID that implements this node. */
  plugin = 'ai-ml';

  /** Whether this node can run in parallel with other nodes. */
  parallel = true;

  /** Node dependencies. Configured dynamically based on enabled enrichment nodes. */
  dependencies: string[] = [];

  /** ML Provider Registry for managing and selecting ML providers */
  private providerRegistry: MLProviderRegistry;

  /**
   * Creates a new AiMlNode instance.
   *
   * @param providerRegistry - Optional ML provider registry. If not provided,
   *                          a default registry will be created with Tiny Brains
   *                          provider auto-registered for backward compatibility.
   */
  constructor(providerRegistry?: MLProviderRegistry) {
    if (providerRegistry) {
      this.providerRegistry = providerRegistry;
    } else {
      // Create default registry with Tiny Brains provider for backward compatibility
      this.providerRegistry = new MLProviderRegistry();
      this.registerDefaultProviders();
    }
  }

  /**
   * Resolve dependencies dynamically based on enabled enrichment nodes.
   *
   * @param enabledNodeIds - Enabled enrichment node IDs
   * @returns Filtered dependency list
   */
  static resolveDependencies(enabledNodeIds: string[]): string[] {
    const baseDeps = ['technical-indicators', 'pattern-recognition', 'sentiment', 'news'];
    const enabled = new Set(enabledNodeIds);
    return baseDeps.filter((dep) => enabled.has(dep));
  }

  /**
   * Registers default ML providers for backward compatibility.
   *
   * This method registers the Tiny Brains provider with the default registry
   * to maintain backward compatibility with existing code that doesn't
   * provide a custom provider registry.
   *
   * @private
   */
  private registerDefaultProviders(): void {
    // Create a factory for Tiny Brains provider
    const tinyBrainsFactory: MLProviderFactory = {
      create: (providerId: string, config: unknown) => {
        return new TinyBrainsProvider();
      },
      getSupportedProviders: () => ['tiny-brains'],
    };

    // Register the factory
    this.providerRegistry.registerProvider('tiny-brains', tinyBrainsFactory);

    // Load default configuration from environment
    const tinyBrainsUrl = process.env.TINY_BRAINS_URL;
    if (tinyBrainsUrl) {
      this.providerRegistry.loadConfigs([
        {
          providerId: 'tiny-brains',
          enabled: true,
          priority: 100,
          config: { tinyBrainsUrl },
        },
      ]);
    } else {
      // Register as disabled if no URL configured
      this.providerRegistry.loadConfigs([
        {
          providerId: 'tiny-brains',
          enabled: false,
          priority: 100,
          config: {},
        },
      ]);
    }
  }

  /**
   * Executes the AI/ML node.
   *
   * This method:
   * 1. Builds MLProviderInput from enrichment results
   * 2. Gets the best available ML provider from the registry
   * 3. Calls provider's predict() method for ML predictions
   * 4. Stores AI/ML prediction in enrichment results
   * 5. Adds trace entries for execution tracking
   * 6. Maintains fail-soft behavior (doesn't throw on error)
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
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
      // Build MLProviderInput from enrichment results
      const input = this.buildProviderInput(state);

      // Get the best available provider
      const provider = await this.providerRegistry.getBestProvider(input);

      // If no provider is available, return gracefully
      if (!provider) {
        console.warn('[AiMlNode] No ML provider available for prediction');

        // Store result indicating service unavailable
        state.enrichmentResults.set(this.id, {
          aiMl: undefined,
          serviceAvailable: false,
          timestamp: new Date().toISOString(),
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
      }

      // Call provider's predict() method
      const mlProviderOutput = await provider.predict(input);

      // Convert MLProviderOutput to existing enrichment result format
      const aiMlPrediction = mlProviderOutput
        ? {
            convictionScore: mlProviderOutput.convictionScore,
            direction: mlProviderOutput.direction,
            regime: mlProviderOutput.regime,
            riskFlag: mlProviderOutput.riskFlag,
            notes: mlProviderOutput.notes,
          }
        : undefined;

      // Store AI/ML prediction in enrichment results
      state.enrichmentResults.set(this.id, {
        aiMl: aiMlPrediction,
        serviceAvailable: aiMlPrediction !== undefined,
        timestamp: new Date().toISOString(),
        providerId: provider.providerId,
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

      // Don't throw - fail-soft behavior
      return state;
    }
  }

  /**
   * Builds MLProviderInput from enrichment results.
   *
   * This method extracts relevant features from the enrichment results
   * of technical-indicators, pattern-recognition, sentiment, and news nodes
   * and formats them according to the MLProviderInput interface.
   *
   * @param state - The current pipeline state
   * @returns MLProviderInput - The standardized input for ML providers
   * @private
   */
  private buildProviderInput(state: PipelineState): MLProviderInput {
    const technical = state.enrichmentResults.get('technical-indicators') as any;
    const pattern = state.enrichmentResults.get('pattern-recognition') as any;
    const sentiment = state.enrichmentResults.get('sentiment') as any;
    const news = state.enrichmentResults.get('news') as any;

    return {
      signalId: state.signalId,
      symbol: this.extractSymbol(state.rawSignal),
      timeframe: this.extractTimeframe(state.rawSignal),
      traceId: state.signalId,
      technical: {
        emaDistancePct: this.extractTechnicalFeatures(technical).emaDistancePct ?? null,
        isInValueSweetSpot: this.extractTechnicalFeatures(technical).isInValueSweetSpot ?? null,
        brokeEmaWithBody: this.extractTechnicalFeatures(technical).brokeEmaWithBody ?? null,
        indicators: this.extractTechnicalFeatures(technical).indicators ?? null,
      },
      pattern: {
        patternName: this.extractPatternFeatures(pattern).patternName ?? null,
        patternConfidence: this.extractPatternFeatures(pattern).patternConfidence ?? null,
        regime: this.extractPatternFeatures(pattern).regime ?? null,
      },
      sentiment: {
        score: this.extractSentimentFeatures(sentiment).score ?? null,
        tags: this.extractSentimentFeatures(sentiment).tags ?? null,
      },
      newsFeatures: this.extractNewsFeatures(news),
    };
  }

  /**
   * Extracts symbol from raw signal.
   *
   * @param rawSignal - The raw signal data
   * @returns The symbol (defaults to 'BTC' if not found)
   * @private
   */
  private extractSymbol(rawSignal: unknown): string {
    if (typeof rawSignal === 'object' && rawSignal !== null) {
      const signal = rawSignal as Record<string, unknown>;
      if (typeof signal.symbol === 'string') {
        return signal.symbol;
      }
    }
    return 'BTC';
  }

  /**
   * Extracts timeframe from raw signal.
   *
   * @param rawSignal - The raw signal data
   * @returns The timeframe (defaults to '1h' if not found)
   * @private
   */
  private extractTimeframe(rawSignal: unknown): string {
    if (typeof rawSignal === 'object' && rawSignal !== null) {
      const signal = rawSignal as Record<string, unknown>;
      if (typeof signal.timeframe === 'string') {
        return signal.timeframe;
      }
    }
    return '1h';
  }

  /**
   * Extracts technical features from enrichment result.
   *
   * @param technical - The technical indicators enrichment result
   * @returns Technical features object
   * @private
   */
  private extractTechnicalFeatures(technical: any): any {
    if (!technical || typeof technical !== 'object') {
      return {};
    }

    return {
      emaDistancePct: technical.emaDistancePct ?? null,
      isInValueSweetSpot: technical.isInValueSweetSpot ?? null,
      brokeEmaWithBody: technical.brokeEmaWithBody ?? null,
      indicators: technical.indicators ?? null,
    };
  }

  /**
   * Extracts pattern features from enrichment result.
   *
   * @param pattern - The pattern recognition enrichment result
   * @returns Pattern features object
   * @private
   */
  private extractPatternFeatures(pattern: any): any {
    if (!pattern || typeof pattern !== 'object') {
      return {};
    }

    return {
      patternName: pattern.patternName ?? null,
      patternConfidence: pattern.patternConfidence ?? null,
      regime: pattern.regime ?? null,
    };
  }

  /**
   * Extracts sentiment features from enrichment result.
   *
   * @param sentiment - The sentiment enrichment result
   * @returns Sentiment features object
   * @private
   */
  private extractSentimentFeatures(sentiment: any): any {
    if (!sentiment || typeof sentiment !== 'object') {
      return {};
    }

    return {
      score: sentiment.score ?? null,
      tags: sentiment.tags ?? null,
    };
  }

  /**
   * Extracts news features from enrichment result.
   *
   * @param news - The news enrichment result
   * @returns News features object
   * @private
   */
  private extractNewsFeatures(news: any): any {
    if (!news || typeof news !== 'object') {
      return {
        hasNewsShock: false,
        headlineCount: 0,
        mostRecentMinutesAgo: null,
        oldestMinutesAgo: null,
        hasExchangeEvent: false,
        hasRegulatoryEvent: false,
        hasMacroEvent: false,
      };
    }

    return {
      hasNewsShock: news.hasNewsShock ?? false,
      headlineCount: news.headlineCount ?? 0,
      mostRecentMinutesAgo: news.mostRecentMinutesAgo ?? null,
      oldestMinutesAgo: news.oldestMinutesAgo ?? null,
      hasExchangeEvent: news.hasExchangeEvent ?? false,
      hasRegulatoryEvent: news.hasRegulatoryEvent ?? false,
      hasMacroEvent: news.hasMacroEvent ?? false,
    };
  }
}
