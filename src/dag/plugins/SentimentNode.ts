/**
 * AFI Reactor - Sentiment Node
 *
 * This node is responsible for:
 * - Analyzing sentiment from news and social media
 * - Computing sentiment scores for the asset
 * - Aggregating sentiment from multiple sources
 * - Storing sentiment results in enrichment results
 * - Adding trace entries for execution tracking
 *
 * @module afi-reactor/src/dag/plugins/SentimentNode
 */

import type { Pipehead, PipelineState } from '../../types/dag.js';

/**
 * Sentiment Node - Enrichment Node
 *
 * The Sentiment node analyzes sentiment from news and social media.
 * This is an optional enrichment node that can be configured by analysts.
 */
export class SentimentNode implements Pipehead {
  /** Node ID. Must be unique within the DAG. */
  id = 'sentiment';

  /** Node type. Enrichment nodes are analyst-configurable. */
  type = 'enrichment' as const;

  /** Plugin ID that implements this node. */
  plugin = 'sentiment';

  /** Whether this node can run in parallel with other nodes. */
  parallel = true;

  /** Node dependencies. The DAG will ensure all dependencies complete before executing this node. */
  dependencies: string[] = [];

  /**
   * Executes the Sentiment node.
   *
   * This method:
   * 1. Fetches sentiment data from news sources
   * 2. Fetches sentiment data from social media
   * 3. Computes aggregate sentiment score
   * 4. Stores sentiment results in enrichment results
   * 5. Adds trace entries for execution tracking
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
   * @throws Error if sentiment data cannot be fetched
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

      // Fetch sentiment from news sources
      const newsSentiment = await this.fetchNewsSentiment(assetInfo);

      // Fetch sentiment from social media
      const socialSentiment = await this.fetchSocialSentiment(assetInfo);

      // Compute aggregate sentiment
      const aggregateSentiment = this.computeAggregateSentiment(newsSentiment, socialSentiment);

      // Store sentiment results in enrichment results
      state.enrichmentResults.set(this.id, aggregateSentiment);

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
   * Fetches sentiment from news sources.
   *
   * @param assetInfo - The asset information
   * @returns Promise<NewsSentiment> - The news sentiment data
   * @private
   */
  private async fetchNewsSentiment(assetInfo: {
    symbol?: string;
    assetId?: string;
  }): Promise<{
    score: number;
    confidence: number;
    sourceCount: number;
    sources: string[];
  }> {
    // Placeholder implementation
    // In a real implementation, this would fetch sentiment from news APIs

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 10));

    return {
      score: 0.65,
      confidence: 0.8,
      sourceCount: 5,
      sources: ['Bloomberg', 'Reuters', 'CoinDesk', 'CryptoSlate', 'The Block'],
    };
  }

  /**
   * Fetches sentiment from social media.
   *
   * @param assetInfo - The asset information
   * @returns Promise<SocialSentiment> - The social sentiment data
   * @private
   */
  private async fetchSocialSentiment(assetInfo: {
    symbol?: string;
    assetId?: string;
  }): Promise<{
    score: number;
    confidence: number;
    sourceCount: number;
    sources: string[];
  }> {
    // Placeholder implementation
    // In a real implementation, this would fetch sentiment from social media APIs

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 10));

    return {
      score: 0.72,
      confidence: 0.75,
      sourceCount: 3,
      sources: ['Twitter', 'Reddit', 'Telegram'],
    };
  }

  /**
   * Computes aggregate sentiment from multiple sources.
   *
   * @param newsSentiment - The news sentiment data
   * @param socialSentiment - The social sentiment data
   * @returns Aggregate sentiment data
   * @private
   */
  private computeAggregateSentiment(
    newsSentiment: {
      score: number;
      confidence: number;
      sourceCount: number;
      sources: string[];
    },
    socialSentiment: {
      score: number;
      confidence: number;
      sourceCount: number;
      sources: string[];
    }
  ): {
    overallScore: number;
    overallConfidence: number;
    newsSentiment: typeof newsSentiment;
    socialSentiment: typeof socialSentiment;
    sentiment: 'bullish' | 'bearish' | 'neutral';
    analyzedAt: string;
  } {
    // Weighted average of sentiment scores
    const newsWeight = 0.6;
    const socialWeight = 0.4;

    const overallScore =
      newsSentiment.score * newsWeight + socialSentiment.score * socialWeight;

    // Weighted average of confidence
    const overallConfidence =
      newsSentiment.confidence * newsWeight + socialSentiment.confidence * socialWeight;

    // Determine sentiment label
    let sentiment: 'bullish' | 'bearish' | 'neutral';
    if (overallScore > 0.6) {
      sentiment = 'bullish';
    } else if (overallScore < 0.4) {
      sentiment = 'bearish';
    } else {
      sentiment = 'neutral';
    }

    return {
      overallScore,
      overallConfidence,
      newsSentiment,
      socialSentiment,
      sentiment,
      analyzedAt: new Date().toISOString(),
    };
  }
}
