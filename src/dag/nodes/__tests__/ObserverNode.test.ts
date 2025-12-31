/**
 * Unit tests for ObserverNode
 *
 * @module afi-reactor/src/langgraph/nodes/__tests__/ObserverNode.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObserverNode } from '../ObserverNode.js';
import type { PipelineState } from '../../../types/pipeline.js';

describe('ObserverNode', () => {
  let observerNode: ObserverNode;
  let mockState: PipelineState;

  beforeEach(() => {
    observerNode = new ObserverNode();

    // Create a mock state with a scored signal
    mockState = {
      signalId: 'test-signal-123',
      rawSignal: { price: 50000, timestamp: 1703587200000 },
      enrichmentResults: new Map([
        ['scored-signal', {
          signalId: 'test-signal-123',
          analystId: 'test-analyst',
          rawSignal: { price: 50000, timestamp: 1703587200000 },
          score: 0.75,
          confidence: 0.85,
          enrichmentResults: {
            'price-enricher': { price: 50000, volume: 1000 },
            'sentiment-analyzer': { sentiment: 'bullish', confidence: 0.8 },
          },
          metadata: {
            generatedAt: '2024-12-26T10:00:05Z',
            enrichmentNodesExecuted: ['price-enricher', 'sentiment-analyzer'],
            executionTrace: [],
          },
        }],
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
            nodeId: 'execution',
            nodeType: 'required',
            startTime: '2024-12-26T10:00:01Z',
            endTime: '2024-12-26T10:00:05Z',
            duration: 4000,
            status: 'completed',
          },
        ],
      },
    };

    // Mock console.log to avoid cluttering test output
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('Node properties', () => {
    it('should have correct id', () => {
      expect(observerNode.id).toBe('observer');
    });

    it('should have correct type', () => {
      expect(observerNode.type).toBe('required');
    });

    it('should have correct plugin', () => {
      expect(observerNode.plugin).toBe('observer');
    });

    it('should have parallel set to false', () => {
      expect(observerNode.parallel).toBe(false);
    });

    it('should have empty dependencies', () => {
      expect(observerNode.dependencies).toEqual([]);
    });
  });

  describe('execute', () => {
    it('should successfully execute and return updated state', async () => {
      const result = await observerNode.execute(mockState);

      expect(result).toBeDefined();
      expect(result.signalId).toBe('test-signal-123');
      expect(result.metadata.trace).toHaveLength(3);
      expect(result.metadata.trace[2].nodeId).toBe('observer');
      expect(result.metadata.trace[2].status).toBe('completed');
      expect(result.metadata.trace[2].duration).toBeGreaterThan(0);
    });

    it('should add trace entry with correct structure', async () => {
      const result = await observerNode.execute(mockState);

      const traceEntry = result.metadata.trace[2];
      expect(traceEntry).toHaveProperty('nodeId', 'observer');
      expect(traceEntry).toHaveProperty('nodeType', 'required');
      expect(traceEntry).toHaveProperty('startTime');
      expect(traceEntry).toHaveProperty('endTime');
      expect(traceEntry).toHaveProperty('duration');
      expect(traceEntry).toHaveProperty('status', 'completed');
    });

    it('should store publication metadata in enrichment results', async () => {
      const result = await observerNode.execute(mockState);

      const publicationMetadata = result.enrichmentResults.get('publication-metadata');
      expect(publicationMetadata).toBeDefined();
      expect(typeof publicationMetadata).toBe('object');
      expect(publicationMetadata).toHaveProperty('publishedAt');
      expect(publicationMetadata).toHaveProperty('signalId', 'test-signal-123');
      expect(publicationMetadata).toHaveProperty('analystId', 'test-analyst');
      expect(publicationMetadata).toHaveProperty('score', 0.75);
      expect(publicationMetadata).toHaveProperty('confidence', 0.85);
      expect(publicationMetadata).toHaveProperty('status', 'published');
    });

    it('should log execution metrics', async () => {
      await observerNode.execute(mockState);

      expect(console.log).toHaveBeenCalledWith(
        expect.objectContaining({
          signalId: 'test-signal-123',
          analystId: 'test-analyst',
          executionMetrics: expect.any(Object),
          timestamp: expect.any(String),
        })
      );
    });

    it('should log signal publication', async () => {
      await observerNode.execute(mockState);

      expect(console.log).toHaveBeenCalledWith(
        'Publishing scored signal to downstream consumers:',
        expect.objectContaining({
          signalId: 'test-signal-123',
          analystId: 'test-analyst',
          score: 0.75,
          confidence: 0.85,
          publishedAt: expect.any(String),
        })
      );
    });

    it('should calculate correct execution metrics', async () => {
      const result = await observerNode.execute(mockState);

      const logCall = (console.log as any).mock.calls.find((call: any) =>
        call[0]?.executionMetrics
      );

      expect(logCall).toBeDefined();
      const metrics = logCall[0].executionMetrics;

      expect(metrics).toHaveProperty('totalTime');
      expect(metrics).toHaveProperty('nodesExecuted');
      expect(metrics).toHaveProperty('nodesFailed');
      expect(metrics).toHaveProperty('nodesPending');
      expect(metrics).toHaveProperty('nodesRunning');

      expect(metrics.nodesExecuted).toBe(2); // analyst and execution
      expect(metrics.nodesFailed).toBe(0);
      expect(metrics.nodesPending).toBe(0);
      expect(metrics.nodesRunning).toBe(0);
      expect(metrics.totalTime).toBeGreaterThan(0);
    });

    it('should throw error if scored signal is missing', async () => {
      const stateWithoutScoredSignal = {
        ...mockState,
        enrichmentResults: new Map(),
      };

      await expect(observerNode.execute(stateWithoutScoredSignal)).rejects.toThrow(
        'No scored signal found in state'
      );
    });

    it('should throw error if scored signal is not an object', async () => {
      const stateWithInvalidSignal = {
        ...mockState,
        enrichmentResults: new Map([['scored-signal', 'invalid']]),
      };

      await expect(observerNode.execute(stateWithInvalidSignal)).rejects.toThrow(
        'Invalid scored signal: must be an object'
      );
    });

    it('should throw error if scored signal is missing signalId', async () => {
      const stateWithMissingSignalId = {
        ...mockState,
        enrichmentResults: new Map([['scored-signal', { analystId: 'test-analyst', score: 0.75, confidence: 0.85 }]]),
      };

      await expect(observerNode.execute(stateWithMissingSignalId)).rejects.toThrow(
        'Invalid scored signal: missing or invalid signalId'
      );
    });

    it('should throw error if scored signal is missing analystId', async () => {
      const stateWithMissingAnalystId = {
        ...mockState,
        enrichmentResults: new Map([['scored-signal', { signalId: 'test-signal-123', score: 0.75, confidence: 0.85 }]]),
      };

      await expect(observerNode.execute(stateWithMissingAnalystId)).rejects.toThrow(
        'Invalid scored signal: missing or invalid analystId'
      );
    });

    it('should throw error if scored signal is missing score', async () => {
      const stateWithMissingScore = {
        ...mockState,
        enrichmentResults: new Map([['scored-signal', { signalId: 'test-signal-123', analystId: 'test-analyst', confidence: 0.85 }]]),
      };

      await expect(observerNode.execute(stateWithMissingScore)).rejects.toThrow(
        'Invalid scored signal: missing or invalid score'
      );
    });

    it('should throw error if scored signal is missing confidence', async () => {
      const stateWithMissingConfidence = {
        ...mockState,
        enrichmentResults: new Map([['scored-signal', { signalId: 'test-signal-123', analystId: 'test-analyst', score: 0.75 }]]),
      };

      await expect(observerNode.execute(stateWithMissingConfidence)).rejects.toThrow(
        'Invalid scored signal: missing or invalid confidence'
      );
    });

    it('should throw error if score is out of range (less than 0)', async () => {
      const stateWithInvalidScore = {
        ...mockState,
        enrichmentResults: new Map([['scored-signal', { signalId: 'test-signal-123', analystId: 'test-analyst', score: -0.1, confidence: 0.85 }]]),
      };

      await expect(observerNode.execute(stateWithInvalidScore)).rejects.toThrow(
        'Invalid scored signal: score must be between 0 and 1'
      );
    });

    it('should throw error if score is out of range (greater than 1)', async () => {
      const stateWithInvalidScore = {
        ...mockState,
        enrichmentResults: new Map([['scored-signal', { signalId: 'test-signal-123', analystId: 'test-analyst', score: 1.1, confidence: 0.85 }]]),
      };

      await expect(observerNode.execute(stateWithInvalidScore)).rejects.toThrow(
        'Invalid scored signal: score must be between 0 and 1'
      );
    });

    it('should throw error if confidence is out of range (less than 0)', async () => {
      const stateWithInvalidConfidence = {
        ...mockState,
        enrichmentResults: new Map([['scored-signal', { signalId: 'test-signal-123', analystId: 'test-analyst', score: 0.75, confidence: -0.1 }]]),
      };

      await expect(observerNode.execute(stateWithInvalidConfidence)).rejects.toThrow(
        'Invalid scored signal: confidence must be between 0 and 1'
      );
    });

    it('should throw error if confidence is out of range (greater than 1)', async () => {
      const stateWithInvalidConfidence = {
        ...mockState,
        enrichmentResults: new Map([['scored-signal', { signalId: 'test-signal-123', analystId: 'test-analyst', score: 0.75, confidence: 1.1 }]]),
      };

      await expect(observerNode.execute(stateWithInvalidConfidence)).rejects.toThrow(
        'Invalid scored signal: confidence must be between 0 and 1'
      );
    });

    it('should add failed trace entry on error', async () => {
      const stateWithError = {
        ...mockState,
        enrichmentResults: new Map(),
      };

      await expect(observerNode.execute(stateWithError)).rejects.toThrow();

      const traceEntry = stateWithError.metadata.trace[stateWithError.metadata.trace.length - 1];
      expect(traceEntry).toHaveProperty('status', 'failed');
      expect(traceEntry).toHaveProperty('error');
    });

    it('should handle failed nodes in execution trace', async () => {
      const stateWithFailedNodes = {
        ...mockState,
        metadata: {
          ...mockState.metadata,
          trace: [
            ...mockState.metadata.trace,
            {
              nodeId: 'failed-node',
              nodeType: 'enrichment',
              startTime: '2024-12-26T10:00:06Z',
              endTime: '2024-12-26T10:00:07Z',
              duration: 1000,
              status: 'failed',
              error: 'Test error',
            },
          ],
        },
      };

      const result = await observerNode.execute(stateWithFailedNodes);

      const logCall = (console.log as any).mock.calls.find((call: any) =>
        call[0]?.executionMetrics
      );

      expect(logCall).toBeDefined();
      const metrics = logCall[0].executionMetrics;

      expect(metrics.nodesFailed).toBe(1);
    });

    it('should handle pending nodes in execution trace', async () => {
      const stateWithPendingNodes = {
        ...mockState,
        metadata: {
          ...mockState.metadata,
          trace: [
            ...mockState.metadata.trace,
            {
              nodeId: 'pending-node',
              nodeType: 'enrichment',
              startTime: '2024-12-26T10:00:06Z',
              status: 'pending',
            },
          ],
        },
      };

      const result = await observerNode.execute(stateWithPendingNodes);

      const logCall = (console.log as any).mock.calls.find((call: any) =>
        call[0]?.executionMetrics
      );

      expect(logCall).toBeDefined();
      const metrics = logCall[0].executionMetrics;

      expect(metrics.nodesPending).toBe(1);
    });

    it('should handle running nodes in execution trace', async () => {
      const stateWithRunningNodes = {
        ...mockState,
        metadata: {
          ...mockState.metadata,
          trace: [
            ...mockState.metadata.trace,
            {
              nodeId: 'running-node',
              nodeType: 'enrichment',
              startTime: '2024-12-26T10:00:06Z',
              status: 'running',
            },
          ],
        },
      };

      const result = await observerNode.execute(stateWithRunningNodes);

      const logCall = (console.log as any).mock.calls.find((call: any) =>
        call[0]?.executionMetrics
      );

      expect(logCall).toBeDefined();
      const metrics = logCall[0].executionMetrics;

      expect(metrics.nodesRunning).toBe(1);
    });

    it('should calculate total execution time correctly', async () => {
      const startTime = new Date(mockState.metadata.startTime).getTime();
      const expectedMinTime = Date.now() - startTime;

      await observerNode.execute(mockState);

      const logCall = (console.log as any).mock.calls.find((call: any) =>
        call[0]?.executionMetrics
      );

      expect(logCall).toBeDefined();
      const metrics = logCall[0].executionMetrics;

      expect(metrics.totalTime).toBeGreaterThanOrEqual(expectedMinTime);
    });
  });
});
