/**
 * Unit tests for NewsNode
 *
 * @module afi-reactor/src/langgraph/plugins/__tests__/NewsNode.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NewsNode } from '../NewsNode.js';
import type { DAGState } from '../../../types/dag.js';

describe('NewsNode', () => {
  let newsNode: NewsNode;
  let mockState: DAGState;

  beforeEach(() => {
    newsNode = new NewsNode();

    // Create a mock state
    mockState = {
      signalId: 'test-signal-123',
      rawSignal: { symbol: 'BTC', assetId: 'bitcoin', price: 50000 },
      enrichmentResults: new Map(),
      analystConfig: {
        analystId: 'test-analyst',
        enrichmentNodes: [],
      },
      metadata: {
        startTime: '2024-12-26T10:00:00Z',
        trace: [],
      },
    };
  });

  describe('Node properties', () => {
    it('should have correct id', () => {
      expect(newsNode.id).toBe('news');
    });

    it('should have correct type', () => {
      expect(newsNode.type).toBe('enrichment');
    });

    it('should have correct plugin', () => {
      expect(newsNode.plugin).toBe('news');
    });

    it('should have parallel set to false', () => {
      expect(newsNode.parallel).toBe(false);
    });

    it('should have correct dependencies', () => {
      expect(newsNode.dependencies).toEqual(['sentiment']);
    });
  });

  describe('execute', () => {
    it('should successfully execute and return updated state', async () => {
      // Pre-populate sentiment data
      mockState.enrichmentResults.set('sentiment', {
        overallScore: 0.68,
        overallConfidence: 0.78,
        newsSentiment: {
          score: 0.65,
          confidence: 0.8,
          sourceCount: 5,
          sources: ['Bloomberg', 'Reuters', 'CoinDesk', 'CryptoSlate', 'The Block'],
        },
        socialSentiment: {
          score: 0.72,
          confidence: 0.75,
          sourceCount: 3,
          sources: ['Twitter', 'Reddit', 'Telegram'],
        },
        sentiment: 'bullish',
        analyzedAt: new Date().toISOString(),
      });

      const result = await newsNode.execute(mockState);

      expect(result).toBeDefined();
      expect(result.signalId).toBe('test-signal-123');
      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('news');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.metadata.trace[0].duration).toBeGreaterThan(0);
    });

    it('should add trace entry with correct structure', async () => {
      mockState.enrichmentResults.set('sentiment', {
        overallScore: 0.68,
        overallConfidence: 0.78,
        newsSentiment: {
          score: 0.65,
          confidence: 0.8,
          sourceCount: 5,
          sources: ['Bloomberg', 'Reuters', 'CoinDesk', 'CryptoSlate', 'The Block'],
        },
        socialSentiment: {
          score: 0.72,
          confidence: 0.75,
          sourceCount: 3,
          sources: ['Twitter', 'Reddit', 'Telegram'],
        },
        sentiment: 'bullish',
        analyzedAt: new Date().toISOString(),
      });

      const result = await newsNode.execute(mockState);

      const traceEntry = result.metadata.trace[0];
      expect(traceEntry).toHaveProperty('nodeId', 'news');
      expect(traceEntry).toHaveProperty('nodeType', 'enrichment');
      expect(traceEntry).toHaveProperty('startTime');
      expect(traceEntry).toHaveProperty('endTime');
      expect(traceEntry).toHaveProperty('duration');
      expect(traceEntry).toHaveProperty('status', 'completed');
    });

    it('should store news results in enrichment results', async () => {
      mockState.enrichmentResults.set('sentiment', {
        overallScore: 0.68,
        overallConfidence: 0.78,
        newsSentiment: {
          score: 0.65,
          confidence: 0.8,
          sourceCount: 5,
          sources: ['Bloomberg', 'Reuters', 'CoinDesk', 'CryptoSlate', 'The Block'],
        },
        socialSentiment: {
          score: 0.72,
          confidence: 0.75,
          sourceCount: 3,
          sources: ['Twitter', 'Reddit', 'Telegram'],
        },
        sentiment: 'bullish',
        analyzedAt: new Date().toISOString(),
      });

      const result = await newsNode.execute(mockState);

      const newsResults = result.enrichmentResults.get('news');
      expect(newsResults).toBeDefined();
      expect(typeof newsResults).toBe('object');
      expect(newsResults).toHaveProperty('articles');
      expect(newsResults).toHaveProperty('totalArticles');
      expect(newsResults).toHaveProperty('relevantArticles');
      expect(newsResults).toHaveProperty('fetchedAt');
    });

    it('should return articles array', async () => {
      mockState.enrichmentResults.set('sentiment', {
        overallScore: 0.68,
        overallConfidence: 0.78,
        newsSentiment: {
          score: 0.65,
          confidence: 0.8,
          sourceCount: 5,
          sources: ['Bloomberg', 'Reuters', 'CoinDesk', 'CryptoSlate', 'The Block'],
        },
        socialSentiment: {
          score: 0.72,
          confidence: 0.75,
          sourceCount: 3,
          sources: ['Twitter', 'Reddit', 'Telegram'],
        },
        sentiment: 'bullish',
        analyzedAt: new Date().toISOString(),
      });

      const result = await newsNode.execute(mockState);

      const newsResults = result.enrichmentResults.get('news') as {
        articles: unknown[];
      };
      expect(Array.isArray(newsResults.articles)).toBe(true);
    });

    it('should include totalArticles count', async () => {
      mockState.enrichmentResults.set('sentiment', {
        overallScore: 0.68,
        overallConfidence: 0.78,
        newsSentiment: {
          score: 0.65,
          confidence: 0.8,
          sourceCount: 5,
          sources: ['Bloomberg', 'Reuters', 'CoinDesk', 'CryptoSlate', 'The Block'],
        },
        socialSentiment: {
          score: 0.72,
          confidence: 0.75,
          sourceCount: 3,
          sources: ['Twitter', 'Reddit', 'Telegram'],
        },
        sentiment: 'bullish',
        analyzedAt: new Date().toISOString(),
      });

      const result = await newsNode.execute(mockState);

      const newsResults = result.enrichmentResults.get('news') as {
        totalArticles: number;
      };
      expect(typeof newsResults.totalArticles).toBe('number');
      expect(newsResults.totalArticles).toBeGreaterThan(0);
    });

    it('should include relevantArticles count', async () => {
      mockState.enrichmentResults.set('sentiment', {
        overallScore: 0.68,
        overallConfidence: 0.78,
        newsSentiment: {
          score: 0.65,
          confidence: 0.8,
          sourceCount: 5,
          sources: ['Bloomberg', 'Reuters', 'CoinDesk', 'CryptoSlate', 'The Block'],
        },
        socialSentiment: {
          score: 0.72,
          confidence: 0.75,
          sourceCount: 3,
          sources: ['Twitter', 'Reddit', 'Telegram'],
        },
        sentiment: 'bullish',
        analyzedAt: new Date().toISOString(),
      });

      const result = await newsNode.execute(mockState);

      const newsResults = result.enrichmentResults.get('news') as {
        totalArticles: number;
        relevantArticles: number;
      };
      expect(typeof newsResults.relevantArticles).toBe('number');
      expect(newsResults.relevantArticles).toBeGreaterThan(0);
      expect(newsResults.relevantArticles).toBeLessThanOrEqual(newsResults.totalArticles);
    });

    it('should include fetchedAt timestamp', async () => {
      mockState.enrichmentResults.set('sentiment', {
        overallScore: 0.68,
        overallConfidence: 0.78,
        newsSentiment: {
          score: 0.65,
          confidence: 0.8,
          sourceCount: 5,
          sources: ['Bloomberg', 'Reuters', 'CoinDesk', 'CryptoSlate', 'The Block'],
        },
        socialSentiment: {
          score: 0.72,
          confidence: 0.75,
          sourceCount: 3,
          sources: ['Twitter', 'Reddit', 'Telegram'],
        },
        sentiment: 'bullish',
        analyzedAt: new Date().toISOString(),
      });

      const result = await newsNode.execute(mockState);

      const newsResults = result.enrichmentResults.get('news') as {
        fetchedAt: string;
      };
      expect(typeof newsResults.fetchedAt).toBe('string');
      expect(new Date(newsResults.fetchedAt)).toBeInstanceOf(Date);
    });

    it('should extract asset info from raw signal', async () => {
      mockState.enrichmentResults.set('sentiment', {
        overallScore: 0.68,
        overallConfidence: 0.78,
        newsSentiment: {
          score: 0.65,
          confidence: 0.8,
          sourceCount: 5,
          sources: ['Bloomberg', 'Reuters', 'CoinDesk', 'CryptoSlate', 'The Block'],
        },
        socialSentiment: {
          score: 0.72,
          confidence: 0.75,
          sourceCount: 3,
          sources: ['Twitter', 'Reddit', 'Telegram'],
        },
        sentiment: 'bullish',
        analyzedAt: new Date().toISOString(),
      });

      const result = await newsNode.execute(mockState);

      const newsResults = result.enrichmentResults.get('news');
      expect(newsResults).toBeDefined();
    });

    it('should handle raw signal without asset info', async () => {
      const stateWithoutAssetInfo: DAGState = {
        ...mockState,
        rawSignal: { price: 50000 },
      };

      stateWithoutAssetInfo.enrichmentResults.set('sentiment', {
        overallScore: 0.68,
        overallConfidence: 0.78,
        newsSentiment: {
          score: 0.65,
          confidence: 0.8,
          sourceCount: 5,
          sources: ['Bloomberg', 'Reuters', 'CoinDesk', 'CryptoSlate', 'The Block'],
        },
        socialSentiment: {
          score: 0.72,
          confidence: 0.75,
          sourceCount: 3,
          sources: ['Twitter', 'Reddit', 'Telegram'],
        },
        sentiment: 'bullish',
        analyzedAt: new Date().toISOString(),
      });

      const result = await newsNode.execute(stateWithoutAssetInfo);

      const newsResults = result.enrichmentResults.get('news');
      expect(newsResults).toBeDefined();
    });

    it('should add failed trace entry on error', async () => {
      // Mock a scenario that would cause an error
      const stateWithInvalidSignal: DAGState = {
        ...mockState,
        rawSignal: null,
      };

      await expect(newsNode.execute(stateWithInvalidSignal)).rejects.toThrow();

      const traceEntry = mockState.metadata.trace[0];
      expect(traceEntry).toHaveProperty('status', 'failed');
      expect(traceEntry).toHaveProperty('error');
    });
  });
});
