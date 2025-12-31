/**
 * Integration tests for enrichment nodes
 *
 * @module afi-reactor/src/langgraph/plugins/__tests__/plugins-integration.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TechnicalIndicatorsNode } from '../TechnicalIndicatorsNode.js';
import { PatternRecognitionNode } from '../PatternRecognitionNode.js';
import { SentimentNode } from '../SentimentNode.js';
import { NewsNode } from '../NewsNode.js';
import { ScoutNode } from '../ScoutNode.js';
import { SignalIngressNode } from '../SignalIngressNode.js';
import type { PipelineState } from '../../types/dag.js';

describe('Enrichment Nodes Integration', () => {
  let mockState: PipelineState;

  beforeEach(() => {
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

  describe('TechnicalIndicatorsNode execution', () => {
    it('should execute TechnicalIndicatorsNode successfully', async () => {
      const node = new TechnicalIndicatorsNode();
      const result = await node.execute(mockState);

      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('technical-indicators');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.enrichmentResults.has('technical-indicators')).toBe(true);
    });

    it('should produce valid technical indicators', async () => {
      const node = new TechnicalIndicatorsNode();
      const result = await node.execute(mockState);

      const indicators = result.enrichmentResults.get('technical-indicators');
      expect(indicators).toBeDefined();
      expect(typeof indicators).toBe('object');
    });
  });

  describe('PatternRecognitionNode execution', () => {
    it('should execute PatternRecognitionNode successfully with technical indicators', async () => {
      // First execute TechnicalIndicatorsNode
      const technicalNode = new TechnicalIndicatorsNode();
      await technicalNode.execute(mockState);

      // Then execute PatternRecognitionNode
      const patternNode = new PatternRecognitionNode();
      const result = await patternNode.execute(mockState);

      expect(result.metadata.trace).toHaveLength(2);
      expect(result.metadata.trace[1].nodeId).toBe('pattern-recognition');
      expect(result.metadata.trace[1].status).toBe('completed');
      expect(result.enrichmentResults.has('pattern-recognition')).toBe(true);
    });

    it('should fail PatternRecognitionNode without technical indicators', async () => {
      const patternNode = new PatternRecognitionNode();

      await expect(patternNode.execute(mockState)).rejects.toThrow(
        'Technical indicators are missing'
      );
    });
  });

  describe('SentimentNode execution', () => {
    it('should execute SentimentNode successfully', async () => {
      const node = new SentimentNode();
      const result = await node.execute(mockState);

      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('sentiment');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.enrichmentResults.has('sentiment')).toBe(true);
    });

    it('should produce valid sentiment results', async () => {
      const node = new SentimentNode();
      const result = await node.execute(mockState);

      const sentiment = result.enrichmentResults.get('sentiment');
      expect(sentiment).toBeDefined();
      expect(typeof sentiment).toBe('object');
      expect(sentiment).toHaveProperty('overallScore');
      expect(sentiment).toHaveProperty('sentiment');
    });
  });

  describe('NewsNode execution', () => {
    it('should execute NewsNode successfully with sentiment data', async () => {
      // First execute SentimentNode
      const sentimentNode = new SentimentNode();
      await sentimentNode.execute(mockState);

      // Then execute NewsNode
      const newsNode = new NewsNode();
      const result = await newsNode.execute(mockState);

      expect(result.metadata.trace).toHaveLength(2);
      expect(result.metadata.trace[1].nodeId).toBe('news');
      expect(result.metadata.trace[1].status).toBe('completed');
      expect(result.enrichmentResults.has('news')).toBe(true);
    });

    it('should produce valid news results', async () => {
      // First execute SentimentNode
      const sentimentNode = new SentimentNode();
      await sentimentNode.execute(mockState);

      // Then execute NewsNode
      const newsNode = new NewsNode();
      const result = await newsNode.execute(mockState);

      const news = result.enrichmentResults.get('news');
      expect(news).toBeDefined();
      expect(typeof news).toBe('object');
      expect(news).toHaveProperty('articles');
      expect(news).toHaveProperty('totalArticles');
    });
  });

  describe('ScoutNode execution', () => {
    it('should execute ScoutNode successfully', async () => {
      const node = new ScoutNode();
      const result = await node.execute(mockState);

      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('scout');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.enrichmentResults.has('scout')).toBe(true);
    });

    it('should produce valid scout results', async () => {
      const node = new ScoutNode();
      const result = await node.execute(mockState);

      const scout = result.enrichmentResults.get('scout');
      expect(scout).toBeDefined();
      expect(typeof scout).toBe('object');
      expect(scout).toHaveProperty('signals');
      expect(scout).toHaveProperty('totalSignals');
    });
  });

  describe('SignalIngressNode execution', () => {
    it('should execute SignalIngressNode successfully', async () => {
      const node = new SignalIngressNode();
      const result = await node.execute(mockState);

      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('signal-ingress');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.enrichmentResults.has('signal-ingress')).toBe(true);
    });

    it('should produce valid signal ingress results', async () => {
      const node = new SignalIngressNode();
      const result = await node.execute(mockState);

      const ingress = result.enrichmentResults.get('signal-ingress');
      expect(ingress).toBeDefined();
      expect(typeof ingress).toBe('object');
      expect(ingress).toHaveProperty('signals');
      expect(ingress).toHaveProperty('totalSignals');
    });
  });

  describe('Multi-node execution pipeline', () => {
    it('should execute multiple enrichment nodes in sequence', async () => {
      // Execute TechnicalIndicatorsNode
      const technicalNode = new TechnicalIndicatorsNode();
      await technicalNode.execute(mockState);

      // Execute PatternRecognitionNode (depends on technical-indicators)
      const patternNode = new PatternRecognitionNode();
      await patternNode.execute(mockState);

      // Execute SentimentNode (parallel, no dependencies)
      const sentimentNode = new SentimentNode();
      await sentimentNode.execute(mockState);

      // Execute NewsNode (depends on sentiment)
      const newsNode = new NewsNode();
      await newsNode.execute(mockState);

      // Verify all nodes executed successfully
      expect(mockState.metadata.trace).toHaveLength(4);
      expect(mockState.enrichmentResults.has('technical-indicators')).toBe(true);
      expect(mockState.enrichmentResults.has('pattern-recognition')).toBe(true);
      expect(mockState.enrichmentResults.has('sentiment')).toBe(true);
      expect(mockState.enrichmentResults.has('news')).toBe(true);

      // Verify all trace entries have completed status
      mockState.metadata.trace.forEach(entry => {
        expect(entry.status).toBe('completed');
      });
    });

    it('should execute ingress nodes independently', async () => {
      // Execute ScoutNode
      const scoutNode = new ScoutNode();
      await scoutNode.execute(mockState);

      // Execute SignalIngressNode
      const signalIngressNode = new SignalIngressNode();
      await signalIngressNode.execute(mockState);

      // Verify both nodes executed successfully
      expect(mockState.metadata.trace).toHaveLength(2);
      expect(mockState.enrichmentResults.has('scout')).toBe(true);
      expect(mockState.enrichmentResults.has('signal-ingress')).toBe(true);

      // Verify all trace entries have completed status
      mockState.metadata.trace.forEach(entry => {
        expect(entry.status).toBe('completed');
      });
    });

    it('should execute all enrichment and ingress nodes', async () => {
      // Execute enrichment nodes
      const technicalNode = new TechnicalIndicatorsNode();
      await technicalNode.execute(mockState);

      const patternNode = new PatternRecognitionNode();
      await patternNode.execute(mockState);

      const sentimentNode = new SentimentNode();
      await sentimentNode.execute(mockState);

      const newsNode = new NewsNode();
      await newsNode.execute(mockState);

      // Execute ingress nodes
      const scoutNode = new ScoutNode();
      await scoutNode.execute(mockState);

      const signalIngressNode = new SignalIngressNode();
      await signalIngressNode.execute(mockState);

      // Verify all nodes executed successfully
      expect(mockState.metadata.trace).toHaveLength(6);
      expect(mockState.enrichmentResults.has('technical-indicators')).toBe(true);
      expect(mockState.enrichmentResults.has('pattern-recognition')).toBe(true);
      expect(mockState.enrichmentResults.has('sentiment')).toBe(true);
      expect(mockState.enrichmentResults.has('news')).toBe(true);
      expect(mockState.enrichmentResults.has('scout')).toBe(true);
      expect(mockState.enrichmentResults.has('signal-ingress')).toBe(true);

      // Verify all trace entries have completed status
      mockState.metadata.trace.forEach(entry => {
        expect(entry.status).toBe('completed');
      });
    });
  });

  describe('Error handling', () => {
    it('should handle errors gracefully and add failed trace entries', async () => {
      const patternNode = new PatternRecognitionNode();

      await expect(patternNode.execute(mockState)).rejects.toThrow();

      expect(mockState.metadata.trace).toHaveLength(1);
      expect(mockState.metadata.trace[0].status).toBe('failed');
      expect(mockState.metadata.trace[0]).toHaveProperty('error');
    });

    it('should continue execution after one node fails', async () => {
      // Try to execute PatternRecognitionNode without technical indicators (will fail)
      const patternNode = new PatternRecognitionNode();
      await expect(patternNode.execute(mockState)).rejects.toThrow();

      // Execute SentimentNode (should succeed)
      const sentimentNode = new SentimentNode();
      const result = await sentimentNode.execute(mockState);

      expect(result.metadata.trace).toHaveLength(2);
      expect(result.metadata.trace[0].status).toBe('failed');
      expect(result.metadata.trace[1].status).toBe('completed');
    });
  });

  describe('State immutability', () => {
    it('should preserve original signal data after node execution', async () => {
      const originalSignalId = mockState.signalId;
      const originalRawSignal = mockState.rawSignal;

      const technicalNode = new TechnicalIndicatorsNode();
      await technicalNode.execute(mockState);

      expect(mockState.signalId).toBe(originalSignalId);
      expect(mockState.rawSignal).toBe(originalRawSignal);
    });

    it('should accumulate enrichment results across node executions', async () => {
      const technicalNode = new TechnicalIndicatorsNode();
      await technicalNode.execute(mockState);

      const sentimentNode = new SentimentNode();
      await sentimentNode.execute(mockState);

      expect(mockState.enrichmentResults.size).toBe(2);
      expect(mockState.enrichmentResults.has('technical-indicators')).toBe(true);
      expect(mockState.enrichmentResults.has('sentiment')).toBe(true);
    });
  });
});
