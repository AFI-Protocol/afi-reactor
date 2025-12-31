/**
 * Unit tests for ExecutionNode
 *
 * @module afi-reactor/src/langgraph/nodes/__tests__/ExecutionNode.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionNode } from '../ExecutionNode.js';
import type { PipelineState } from '../../../types/pipeline.js';

describe('ExecutionNode', () => {
  let executionNode: ExecutionNode;
  let mockState: PipelineState;

  beforeEach(() => {
    executionNode = new ExecutionNode();

    // Create a mock state with enrichment results
    mockState = {
      signalId: 'test-signal-123',
      rawSignal: { price: 50000, timestamp: 1703587200000 },
      enrichmentResults: new Map([
        ['price-enricher', { price: 50000, volume: 1000, score: 0.7 }],
        ['sentiment-analyzer', { sentiment: 'bullish', confidence: 0.8, score: 0.6 }],
        ['technical-indicators', { rsi: 65, macd: 0.5, score: 0.55 }],
      ]),
      analystConfig: {
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'price-enricher',
            type: 'enrichment',
            plugin: 'afi-price-enricher',
            enabled: true,
          },
          {
            id: 'sentiment-analyzer',
            type: 'enrichment',
            plugin: 'afi-sentiment-plugin',
            enabled: true,
          },
        ],
      },
      metadata: {
        startTime: '2024-12-26T10:00:00Z',
        trace: [
          {
            nodeId: 'analyst',
            nodeType: 'required',
            startTime: '2024-12-26T10:00:00Z',
            endTime: '2024-12-26T10:00:01Z',
            duration: 1000,
            status: 'completed',
          },
          {
            nodeId: 'price-enricher',
            nodeType: 'enrichment',
            startTime: '2024-12-26T10:00:01Z',
            endTime: '2024-12-26T10:00:02Z',
            duration: 1000,
            status: 'completed',
          },
          {
            nodeId: 'sentiment-analyzer',
            nodeType: 'enrichment',
            startTime: '2024-12-26T10:00:02Z',
            endTime: '2024-12-26T10:00:03Z',
            duration: 1000,
            status: 'completed',
          },
        ],
      },
    };
  });

  describe('Node properties', () => {
    it('should have correct id', () => {
      expect(executionNode.id).toBe('execution');
    });

    it('should have correct type', () => {
      expect(executionNode.type).toBe('required');
    });

    it('should have correct plugin', () => {
      expect(executionNode.plugin).toBe('execution');
    });

    it('should have parallel set to false', () => {
      expect(executionNode.parallel).toBe(false);
    });

    it('should have empty dependencies', () => {
      expect(executionNode.dependencies).toEqual([]);
    });
  });

  describe('execute', () => {
    it('should successfully execute and return updated state', async () => {
      const result = await executionNode.execute(mockState);

      expect(result).toBeDefined();
      expect(result.signalId).toBe('test-signal-123');
      expect(result.metadata.trace).toHaveLength(4);
      expect(result.metadata.trace[3].nodeId).toBe('execution');
      expect(result.metadata.trace[3].status).toBe('completed');
      expect(result.metadata.trace[3].duration).toBeGreaterThan(0);
    });

    it('should add trace entry with correct structure', async () => {
      const result = await executionNode.execute(mockState);

      const traceEntry = result.metadata.trace[3];
      expect(traceEntry).toHaveProperty('nodeId', 'execution');
      expect(traceEntry).toHaveProperty('nodeType', 'required');
      expect(traceEntry).toHaveProperty('startTime');
      expect(traceEntry).toHaveProperty('endTime');
      expect(traceEntry).toHaveProperty('duration');
      expect(traceEntry).toHaveProperty('status', 'completed');
    });

    it('should store scored signal in enrichment results', async () => {
      const result = await executionNode.execute(mockState);

      const scoredSignal = result.enrichmentResults.get('scored-signal');
      expect(scoredSignal).toBeDefined();
      expect(typeof scoredSignal).toBe('object');
      expect(scoredSignal).toHaveProperty('signalId', 'test-signal-123');
      expect(scoredSignal).toHaveProperty('analystId', 'test-analyst');
      expect(scoredSignal).toHaveProperty('score');
      expect(scoredSignal).toHaveProperty('confidence');
      expect(scoredSignal).toHaveProperty('rawSignal');
      expect(scoredSignal).toHaveProperty('enrichmentResults');
      expect(scoredSignal).toHaveProperty('metadata');
    });

    it('should store observer metadata in enrichment results', async () => {
      const result = await executionNode.execute(mockState);

      const observerMetadata = result.enrichmentResults.get('observer-metadata');
      expect(observerMetadata).toBeDefined();
      expect(typeof observerMetadata).toBe('object');
      expect(observerMetadata).toHaveProperty('preparedAt');
      expect(observerMetadata).toHaveProperty('signalId', 'test-signal-123');
      expect(observerMetadata).toHaveProperty('analystId', 'test-analyst');
      expect(observerMetadata).toHaveProperty('readyForObserver', true);
    });

    it('should calculate score between 0 and 1', async () => {
      const result = await executionNode.execute(mockState);

      const scoredSignal = result.enrichmentResults.get('scored-signal') as Record<string, unknown>;
      expect(scoredSignal.score).toBeGreaterThanOrEqual(0);
      expect(scoredSignal.score).toBeLessThanOrEqual(1);
    });

    it('should calculate confidence between 0 and 1', async () => {
      const result = await executionNode.execute(mockState);

      const scoredSignal = result.enrichmentResults.get('scored-signal') as Record<string, unknown>;
      expect(scoredSignal.confidence).toBeGreaterThanOrEqual(0);
      expect(scoredSignal.confidence).toBeLessThanOrEqual(1);
    });

    it('should include enrichment results in scored signal', async () => {
      const result = await executionNode.execute(mockState);

      const scoredSignal = result.enrichmentResults.get('scored-signal') as Record<string, unknown>;
      const enrichmentResults = scoredSignal.enrichmentResults as Record<string, unknown>;

      expect(enrichmentResults).toHaveProperty('price-enricher');
      expect(enrichmentResults).toHaveProperty('sentiment-analyzer');
      expect(enrichmentResults).toHaveProperty('technical-indicators');
    });

    it('should include execution trace in scored signal metadata', async () => {
      const result = await executionNode.execute(mockState);

      const scoredSignal = result.enrichmentResults.get('scored-signal') as Record<string, unknown>;
      const metadata = scoredSignal.metadata as Record<string, unknown>;

      expect(metadata).toHaveProperty('generatedAt');
      expect(metadata).toHaveProperty('enrichmentNodesExecuted');
      expect(metadata).toHaveProperty('executionTrace');
      expect(Array.isArray(metadata.enrichmentNodesExecuted)).toBe(true);
      expect(Array.isArray(metadata.executionTrace)).toBe(true);
    });

    it('should filter out internal keys from enrichment results', async () => {
      // Add internal keys to enrichment results
      mockState.enrichmentResults.set('enabled-nodes', []);
      mockState.enrichmentResults.set('node-execution-order', []);
      mockState.enrichmentResults.set('signal-metadata', {});

      const result = await executionNode.execute(mockState);

      const scoredSignal = result.enrichmentResults.get('scored-signal') as Record<string, unknown>;
      const enrichmentResults = scoredSignal.enrichmentResults as Record<string, unknown>;

      // Internal keys should not be in the scored signal
      expect(enrichmentResults).not.toHaveProperty('enabled-nodes');
      expect(enrichmentResults).not.toHaveProperty('node-execution-order');
      expect(enrichmentResults).not.toHaveProperty('signal-metadata');
      expect(enrichmentResults).not.toHaveProperty('scored-signal');
      expect(enrichmentResults).not.toHaveProperty('observer-metadata');
    });

    it('should throw error if no enrichment results found', async () => {
      const stateWithoutResults = {
        ...mockState,
        enrichmentResults: new Map(),
      };

      await expect(executionNode.execute(stateWithoutResults)).rejects.toThrow(
        'No enrichment results found'
      );
    });

    it('should throw error if enrichment results contain null values', async () => {
      const stateWithNullResults = {
        ...mockState,
        enrichmentResults: new Map([
          ['price-enricher', null],
          ['sentiment-analyzer', undefined],
        ]),
      };

      await expect(executionNode.execute(stateWithNullResults)).rejects.toThrow(
        'Enrichment nodes failed'
      );
    });

    it('should add failed trace entry on error', async () => {
      // Mock state that will cause an error
      const stateWithError = {
        ...mockState,
        enrichmentResults: new Map(),
      };

      await expect(executionNode.execute(stateWithError)).rejects.toThrow();

      const traceEntry = stateWithError.metadata.trace[stateWithError.metadata.trace.length - 1];
      expect(traceEntry).toHaveProperty('status', 'failed');
      expect(traceEntry).toHaveProperty('error');
    });

    it('should handle enrichment results with scores', async () => {
      const stateWithScores = {
        ...mockState,
        enrichmentResults: new Map([
          ['node-a', { score: 0.8 }],
          ['node-b', { score: 0.6 }],
          ['node-c', { score: 0.9 }],
        ]),
      };

      const result = await executionNode.execute(stateWithScores);

      const scoredSignal = result.enrichmentResults.get('scored-signal') as Record<string, unknown>;
      // The score should be influenced by the enrichment result scores
      expect(scoredSignal.score).toBeGreaterThan(0);
      expect(scoredSignal.score).toBeLessThanOrEqual(1);
    });

    it('should calculate confidence based on result count', async () => {
      const stateWithManyResults = {
        ...mockState,
        enrichmentResults: new Map([
          ['node-1', { data: 'test' }],
          ['node-2', { data: 'test' }],
          ['node-3', { data: 'test' }],
          ['node-4', { data: 'test' }],
          ['node-5', { data: 'test' }],
        ]),
      };

      const result = await executionNode.execute(stateWithManyResults);

      const scoredSignal = result.enrichmentResults.get('scored-signal') as Record<string, unknown>;
      // More results should increase confidence
      expect(scoredSignal.confidence).toBeGreaterThan(0.5);
    });

    it('should calculate confidence based on execution trace', async () => {
      const stateWithFailedNodes = {
        ...mockState,
        metadata: {
          ...mockState.metadata,
          trace: [
            ...mockState.metadata.trace,
            {
              nodeId: 'failed-node',
              nodeType: 'enrichment',
              startTime: '2024-12-26T10:00:04Z',
              endTime: '2024-12-26T10:00:05Z',
              duration: 1000,
              status: 'failed',
              error: 'Test error',
            },
          ],
        },
      };

      const result = await executionNode.execute(stateWithFailedNodes);

      const scoredSignal = result.enrichmentResults.get('scored-signal') as Record<string, unknown>;
      // Failed nodes should reduce confidence
      expect(scoredSignal.confidence).toBeLessThan(1);
    });
  });
});
