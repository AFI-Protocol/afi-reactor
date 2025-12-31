/**
 * AFI Reactor - News Node
 *
 * This node is responsible for:
 * - Fetching relevant news articles
 * - Filtering news by relevance to the asset
 * - Storing news results in enrichment results
 * - Adding trace entries for execution tracking
 *
 * @module afi-reactor/src/dag/plugins/NewsNode
 */

import type { Pipehead, PipelineState } from '../../types/dag.js';

/**
 * News Node - Enrichment Node
 *
 * The News node fetches relevant news articles.
 * This is an optional enrichment node that can be configured by analysts.
 */
export class NewsNode implements Pipehead {
  /** Node ID. Must be unique within the DAG. */
  id = 'news';

  /** Node type. Enrichment nodes are analyst-configurable. */
  type = 'enrichment' as const;

  /** Plugin ID that implements this node. */
  plugin = 'news';

  /** Whether this node can run in parallel with other nodes. */
  parallel = false;

  /** Node dependencies. The DAG will ensure all dependencies complete before executing this node. */
  dependencies: string[] = ['sentiment'];

  /**
   * Executes the News node.
   *
   * This method:
   * 1. Retrieves sentiment data from enrichment results
   * 2. Fetches relevant news articles
   * 3. Filters news by relevance
   * 4. Stores news results in enrichment results
   * 5. Adds trace entries for execution tracking
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
   * @throws Error if news data cannot be fetched
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
      // Retrieve sentiment data from enrichment results
      const sentimentData = state.enrichmentResults.get('sentiment');

      // Extract asset information from raw signal
      const assetInfo = this.extractAssetInfo(state.rawSignal);

      // Fetch news articles
      const newsArticles = await this.fetchNewsArticles(assetInfo);

      // Filter news by relevance
      const relevantNews = this.filterNewsByRelevance(newsArticles, assetInfo);

      // Store news results in enrichment results
      state.enrichmentResults.set(this.id, {
        articles: relevantNews,
        totalArticles: newsArticles.length,
        relevantArticles: relevantNews.length,
        fetchedAt: new Date().toISOString(),
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
   * Fetches news articles from news sources.
   *
   * @param assetInfo - The asset information
   * @returns Promise<NewsArticle[]> - The fetched news articles
   * @private
   */
  private async fetchNewsArticles(assetInfo: {
    symbol?: string;
    assetId?: string;
  }): Promise<
    Array<{
      title: string;
      url: string;
      source: string;
      publishedAt: string;
      summary: string;
      relevanceScore: number;
    }>
  > {
    // Placeholder implementation
    // In a real implementation, this would fetch news from news APIs

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Return mock news articles
    return [
      {
        title: 'Bitcoin Surges Past $50,000 as Institutional Interest Grows',
        url: 'https://example.com/bitcoin-surges',
        source: 'CoinDesk',
        publishedAt: new Date(Date.now() - 3600000).toISOString(),
        summary: 'Bitcoin has broken through the $50,000 resistance level as more institutional investors enter the market.',
        relevanceScore: 0.9,
      },
      {
        title: 'Crypto Market Shows Signs of Recovery',
        url: 'https://example.com/crypto-recovery',
        source: 'CryptoSlate',
        publishedAt: new Date(Date.now() - 7200000).toISOString(),
        summary: 'The broader cryptocurrency market is showing signs of recovery after recent volatility.',
        relevanceScore: 0.75,
      },
      {
        title: 'Ethereum 2.0 Staking Reaches New Highs',
        url: 'https://example.com/ethereum-staking',
        source: 'The Block',
        publishedAt: new Date(Date.now() - 10800000).toISOString(),
        summary: 'Ethereum 2.0 staking has reached new highs as more validators join the network.',
        relevanceScore: 0.6,
      },
    ];
  }

  /**
   * Filters news articles by relevance.
   *
   * @param newsArticles - The news articles to filter
   * @param assetInfo - The asset information
   * @returns Filtered news articles
   * @private
   */
  private filterNewsByRelevance(
    newsArticles: Array<{
      title: string;
      url: string;
      source: string;
      publishedAt: string;
      summary: string;
      relevanceScore: number;
    }>,
    assetInfo: {
      symbol?: string;
      assetId?: string;
    }
  ): Array<{
    title: string;
    url: string;
    source: string;
    publishedAt: string;
    summary: string;
    relevanceScore: number;
  }> {
    // Filter articles with relevance score above threshold
    const relevanceThreshold = 0.5;

    return newsArticles.filter(article => article.relevanceScore >= relevanceThreshold);
  }
}
