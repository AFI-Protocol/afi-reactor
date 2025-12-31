/**
 * Unit tests for SentimentNode
 *
 * @module afi-reactor/src/langgraph/plugins/__tests__/SentimentNode.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SentimentNode } from '../SentimentNode.js';
import type { PipelineState } from '../../../types/pipeline.js';

describe('SentimentNode', () => {
  let sentimentNode: SentimentNode;
  let mockState: PipelineState;

  beforeEach(() => {
    sentimentNode = new SentimentNode();

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
      expect(sentimentNode.id).toBe('sentiment');
    });

    it('should have correct type', () => {
      expect(sentimentNode.type).toBe('enrichment');
    });

    it('should have correct plugin', () => {
      expect(sentimentNode.plugin).toBe('sentiment');
    });

    it('should have parallel set to true', () => {
      expect(sentimentNode.parallel).toBe(true);
    });

    it('should have empty dependencies', () => {
      expect(sentimentNode.dependencies).toEqual([]);
    });
  });

  describe('execute', () => {
    it('should successfully execute and return updated state', async () => {
      const result = await sentimentNode.execute(mockState);

      expect(result).toBeDefined();
      expect(result.signalId).toBe('test-signal-123');
      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('sentiment');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.metadata.trace[0].duration).toBeGreaterThan(0);
    });

    it('should add trace entry with correct structure', async () => {
      const result = await sentimentNode.execute(mockState);

      const traceEntry = result.metadata.trace[0];
      expect(traceEntry).toHaveProperty('nodeId', 'sentiment');
      expect(traceEntry).toHaveProperty('nodeType', 'enrichment');
      expect(traceEntry).toHaveProperty('startTime');
      expect(traceEntry).toHaveProperty('endTime');
      expect(traceEntry).toHaveProperty('duration');
      expect(traceEntry).toHaveProperty('status', 'completed');
    });

    it('should store sentiment results in enrichment results', async () => {
      const result = await sentimentNode.execute(mockState);

      const sentimentResults = result.enrichmentResults.get('sentiment');
      expect(sentimentResults).toBeDefined();
      expect(typeof sentimentResults).toBe('object');
      expect(sentimentResults).toHaveProperty('overallScore');
      expect(sentimentResults).toHaveProperty('overallConfidence');
      expect(sentimentResults).toHaveProperty('newsSentiment');
      expect(sentimentResults).toHaveProperty('socialSentiment');
      expect(sentimentResults).toHaveProperty('sentiment');
      expect(sentimentResults).toHaveProperty('analyzedAt');
    });

    it('should calculate overall sentiment score', async () => {
      const result = await sentimentNode.execute(mockState);

      const sentimentResults = result.enrichmentResults.get('sentiment') as {
        overallScore: number;
      };
      expect(typeof sentimentResults.overallScore).toBe('number');
      expect(sentimentResults.overallScore).toBeGreaterThanOrEqual(0);
      expect(sentimentResults.overallScore).toBeLessThanOrEqual(1);
    });

    it('should calculate overall confidence', async () => {
      const result = await sentimentNode.execute(mockState);

      const sentimentResults = result.enrichmentResults.get('sentiment') as {
        overallConfidence: number;
      };
      expect(typeof sentimentResults.overallConfidence).toBe('number');
      expect(sentimentResults.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(sentimentResults.overallConfidence).toBeLessThanOrEqual(1);
    });

    it('should include news sentiment data', async () => {
      const result = await sentimentNode.execute(mockState);

      const sentimentResults = result.enrichmentResults.get('sentiment') as {
        newsSentiment: {
          score: number;
          confidence: number;
          sourceCount: number;
          sources: string[];
        };
      };
      expect(typeof sentimentResults.newsSentiment).toBe('object');
      expect(sentimentResults.newsSentiment).toHaveProperty('score');
      expect(sentimentResults.newsSentiment).toHaveProperty('confidence');
      expect(sentimentResults.newsSentiment).toHaveProperty('sourceCount');
      expect(sentimentResults.newsSentiment).toHaveProperty('sources');
      expect(Array.isArray(sentimentResults.newsSentiment.sources)).toBe(true);
    });

    it('should include social sentiment data', async () => {
      const result = await sentimentNode.execute(mockState);

      const sentimentResults = result.enrichmentResults.get('sentiment') as {
        socialSentiment: {
          score: number;
          confidence: number;
          sourceCount: number;
          sources: string[];
        };
      };
      expect(typeof sentimentResults.socialSentiment).toBe('object');
      expect(sentimentResults.socialSentiment).toHaveProperty('score');
      expect(sentimentResults.socialSentiment).toHaveProperty('confidence');
      expect(sentimentResults.socialSentiment).toHaveProperty('sourceCount');
      expect(sentimentResults.socialSentiment).toHaveProperty('sources');
      expect(Array.isArray(sentimentResults.socialSentiment.sources)).toBe(true);
    });

    it('should determine sentiment label correctly', async () => {
      const result = await sentimentNode.execute(mockState);

      const sentimentResults = result.enrichmentResults.get('sentiment') as {
        sentiment: 'bullish' | 'bearish' | 'neutral';
      };
      expect(['bullish', 'bearish', 'neutral']).toContain(sentimentResults.sentiment);
    });

    it('should include analyzedAt timestamp', async () => {
      const result = await sentimentNode.execute(mockState);

      const sentimentResults = result.enrichmentResults.get('sentiment') as {
        analyzedAt: string;
      };
      expect(typeof sentimentResults.analyzedAt).toBe('string');
      expect(new Date(sentimentResults.analyzedAt)).toBeInstanceOf(Date);
    });

    it('should extract asset info from raw signal', async () => {
      const result = await sentimentNode.execute(mockState);

      const sentimentResults = result.enrichmentResults.get('sentiment');
      expect(sentimentResults).toBeDefined();
    });

    it('should handle raw signal without asset info', async () => {
      const stateWithoutAssetInfo = {
        ...mockState,
        rawSignal: { price: 50000 },
      };

      const result = await sentimentNode.execute(stateWithoutAssetInfo);

      const sentimentResults = result.enrichmentResults.get('sentiment');
      expect(sentimentResults).toBeDefined();
    });

    it('should add failed trace entry on error', async () => {
      // Mock a scenario that would cause an error
      const stateWithInvalidSignal = {
        ...mockState,
        rawSignal: null,
      };

      await expect(sentimentNode.execute(stateWithInvalidSignal)).rejects.toThrow();

      const traceEntry = mockState.metadata.trace[0];
      expect(traceEntry).toHaveProperty('status', 'failed');
      expect(traceEntry).toHaveProperty('error');
    });
  });
});
