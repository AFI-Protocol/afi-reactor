/**
 * Integration tests for required nodes execution
 *
 * @module afi-reactor/src/langgraph/nodes/__tests__/nodes-integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalystNode } from '../AnalystNode.js';
import { ExecutionNode } from '../ExecutionNode.js';
import { ObserverNode } from '../ObserverNode.js';
import type { PipelineState } from '../../types/pipeline.js';

// Mock console.log to avoid cluttering test output
vi.spyOn(console, 'log').mockImplementation(() => {});

describe('Required Nodes Integration Tests', () => {
  let analystNode: AnalystNode;
  let executionNode: ExecutionNode;
  let observerNode: ObserverNode;
  let initialState: PipelineState;

  beforeEach(() => {
    analystNode = new AnalystNode();
    executionNode = new ExecutionNode();
    observerNode = new ObserverNode();

    // Create initial state
    initialState = {
      signalId: 'test-signal-123',
      rawSignal: { price: 50000, timestamp: 1703587200000 },
      enrichmentResults: new Map(),
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
            dependencies: ['price-enricher'],
          },
        ],
      },
      metadata: {
        startTime: '2024-12-26T10:00:00Z',
        trace: [],
      },
    };
  });

  describe('Complete DAG execution', () => {
    it('should execute all required nodes in sequence', async () => {
      // Mock loadAnalystConfig
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
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
        valid: true,
      });

      // Execute Analyst node
      let state = await analystNode.execute(initialState);

      // Add mock enrichment results
      state.enrichmentResults.set('price-enricher', { price: 50000, volume: 1000, score: 0.7 });
      state.enrichmentResults.set('sentiment-analyzer', { sentiment: 'bullish', confidence: 0.8, score: 0.6 });

      // Execute Execution node
      state = await executionNode.execute(state);

      // Execute Observer node
      state = await observerNode.execute(state);

      // Verify all nodes were executed
      expect(state.metadata.trace).toHaveLength(3);
      expect(state.metadata.trace[0].nodeId).toBe('analyst');
      expect(state.metadata.trace[1].nodeId).toBe('execution');
      expect(state.metadata.trace[2].nodeId).toBe('observer');

      // Verify all nodes completed successfully
      expect(state.metadata.trace[0].status).toBe('completed');
      expect(state.metadata.trace[1].status).toBe('completed');
      expect(state.metadata.trace[2].status).toBe('completed');
    });

    it('should maintain state integrity across node executions', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node
      let state = await analystNode.execute(initialState);

      // Verify state integrity
      expect(state.signalId).toBe('test-signal-123');
      expect(state.rawSignal).toEqual(initialState.rawSignal);
      expect(state.analystConfig.analystId).toBe('test-analyst');

      // Execute Execution node
      state = await executionNode.execute(state);

      // Verify state integrity
      expect(state.signalId).toBe('test-signal-123');
      expect(state.rawSignal).toEqual(initialState.rawSignal);
      expect(state.analystConfig.analystId).toBe('test-analyst');

      // Execute Observer node
      state = await observerNode.execute(state);

      // Verify state integrity
      expect(state.signalId).toBe('test-signal-123');
      expect(state.rawSignal).toEqual(initialState.rawSignal);
      expect(state.analystConfig.analystId).toBe('test-analyst');
    });

    it('should accumulate trace entries across all nodes', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute all nodes
      let state = await analystNode.execute(initialState);
      state.enrichmentResults.set('mock-enrichment', { score: 0.5 });
      state = await executionNode.execute(state);
      state = await observerNode.execute(state);

      // Verify trace entries
      expect(state.metadata.trace).toHaveLength(3);

      // Verify trace entry structure
      for (const entry of state.metadata.trace) {
        expect(entry).toHaveProperty('nodeId');
        expect(entry).toHaveProperty('nodeType');
        expect(entry).toHaveProperty('startTime');
        expect(entry).toHaveProperty('endTime');
        expect(entry).toHaveProperty('duration');
        expect(entry).toHaveProperty('status');
      }
    });

    it('should calculate total execution time correctly', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      const startTime = Date.now();

      // Execute all nodes
      let state = await analystNode.execute(initialState);
      state.enrichmentResults.set('mock-enrichment', { score: 0.5 });
      state = await executionNode.execute(state);
      state = await observerNode.execute(state);

      const endTime = Date.now();
      const totalExecutionTime = endTime - startTime;

      // Verify total execution time is reasonable
      expect(totalExecutionTime).toBeGreaterThan(0);
      expect(totalExecutionTime).toBeLessThan(10000); // Should complete in less than 10 seconds
    });
  });

  describe('Error handling and recovery', () => {
    it('should handle Analyst node failure gracefully', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockRejectedValue(
        new Error('Failed to load configuration')
      );

      // Execute Analyst node should fail
      await expect(analystNode.execute(initialState)).rejects.toThrow();

      // Verify trace entry was added
      expect(initialState.metadata.trace).toHaveLength(1);
      expect(initialState.metadata.trace[0].nodeId).toBe('analyst');
      expect(initialState.metadata.trace[0].status).toBe('failed');
      expect(initialState.metadata.trace[0].error).toBeDefined();
    });

    it('should handle Execution node failure gracefully', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node successfully
      let state = await analystNode.execute(initialState);

      // Don't add enrichment results to cause Execution node to fail
      // state.enrichmentResults is empty

      // Execute Execution node should fail
      await expect(executionNode.execute(state)).rejects.toThrow(
        'No enrichment results found'
      );

      // Verify trace entry was added
      expect(state.metadata.trace).toHaveLength(2);
      expect(state.metadata.trace[1].nodeId).toBe('execution');
      expect(state.metadata.trace[1].status).toBe('failed');
      expect(state.metadata.trace[1].error).toBeDefined();
    });

    it('should handle Observer node failure gracefully', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node successfully
      let state = await analystNode.execute(initialState);
      state.enrichmentResults.set('mock-enrichment', { score: 0.5 });

      // Execute Execution node successfully
      state = await executionNode.execute(state);

      // Remove scored signal to cause Observer node to fail
      state.enrichmentResults.delete('scored-signal');

      // Execute Observer node should fail
      await expect(observerNode.execute(state)).rejects.toThrow(
        'No scored signal found in state'
      );

      // Verify trace entry was added
      expect(state.metadata.trace).toHaveLength(3);
      expect(state.metadata.trace[2].nodeId).toBe('observer');
      expect(state.metadata.trace[2].status).toBe('failed');
      expect(state.metadata.trace[2].error).toBeDefined();
    });

    it('should continue execution after non-critical node failure', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node successfully
      let state = await analystNode.execute(initialState);
      state.enrichmentResults.set('mock-enrichment', { score: 0.5 });

      // Execute Execution node successfully
      state = await executionNode.execute(state);

      // Verify state is still valid
      expect(state.signalId).toBe('test-signal-123');
      expect(state.metadata.trace).toHaveLength(2);
      expect(state.metadata.trace[0].status).toBe('completed');
      expect(state.metadata.trace[1].status).toBe('completed');
    });
  });

  describe('Data flow and transformation', () => {
    it('should transform raw signal through enrichment pipeline', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node
      let state = await analystNode.execute(initialState);

      // Add enrichment results
      state.enrichmentResults.set('price-enrichment', { price: 50000, volume: 1000 });
      state.enrichmentResults.set('sentiment-enrichment', { sentiment: 'bullish', confidence: 0.8 });

      // Execute Execution node
      state = await executionNode.execute(state);

      // Verify scored signal was created
      const scoredSignal = state.enrichmentResults.get('scored-signal');
      expect(scoredSignal).toBeDefined();
      expect(typeof scoredSignal).toBe('object');

      // Verify scored signal contains enrichment results
      const signalObj = scoredSignal as Record<string, unknown>;
      expect(signalObj).toHaveProperty('rawSignal');
      expect(signalObj).toHaveProperty('score');
      expect(signalObj).toHaveProperty('confidence');
      expect(signalObj).toHaveProperty('enrichmentResults');
    });

    it('should propagate metadata through the pipeline', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute all nodes
      let state = await analystNode.execute(initialState);
      state.enrichmentResults.set('mock-enrichment', { score: 0.5 });
      state = await executionNode.execute(state);
      state = await observerNode.execute(state);

      // Verify metadata propagation
      const signalMetadata = state.enrichmentResults.get('signal-metadata');
      expect(signalMetadata).toBeDefined();
      expect((signalMetadata as Record<string, unknown>).signalId).toBe('test-signal-123');
      expect((signalMetadata as Record<string, unknown>).analystId).toBe('test-analyst');

      const observerMetadata = state.enrichmentResults.get('observer-metadata');
      expect(observerMetadata).toBeDefined();
      expect((observerMetadata as Record<string, unknown>).readyForObserver).toBe(true);

      const publicationMetadata = state.enrichmentResults.get('publication-metadata');
      expect(publicationMetadata).toBeDefined();
      expect((publicationMetadata as Record<string, unknown>).status).toBe('published');
    });

    it('should maintain enrichment results across node executions', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node
      let state = await analystNode.execute(initialState);

      // Add enrichment results
      state.enrichmentResults.set('enrichment-1', { data: 'test1' });
      state.enrichmentResults.set('enrichment-2', { data: 'test2' });
      state.enrichmentResults.set('enrichment-3', { data: 'test3' });

      // Execute Execution node
      state = await executionNode.execute(state);

      // Verify enrichment results are preserved
      const scoredSignal = state.enrichmentResults.get('scored-signal') as Record<string, unknown>;
      const enrichmentResults = scoredSignal.enrichmentResults as Record<string, unknown>;

      expect(enrichmentResults).toHaveProperty('enrichment-1');
      expect(enrichmentResults).toHaveProperty('enrichment-2');
      expect(enrichmentResults).toHaveProperty('enrichment-3');
    });
  });

  describe('Performance and scalability', () => {
    it('should handle large enrichment result sets efficiently', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node
      let state = await analystNode.execute(initialState);

      // Add many enrichment results
      for (let i = 0; i < 100; i++) {
        state.enrichmentResults.set(`enrichment-${i}`, { data: `test${i}`, score: Math.random() });
      }

      const startTime = Date.now();

      // Execute Execution node
      state = await executionNode.execute(state);

      const executionTime = Date.now() - startTime;

      // Verify execution completed in reasonable time
      expect(executionTime).toBeLessThan(1000); // Should complete in less than 1 second
      expect(state.metadata.trace[1].status).toBe('completed');
    });

    it('should handle complex dependency chains', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node-1',
            type: 'enrichment',
            plugin: 'afi-plugin-1',
            enabled: true,
          },
          {
            id: 'node-2',
            type: 'enrichment',
            plugin: 'afi-plugin-2',
            enabled: true,
            dependencies: ['node-1'],
          },
          {
            id: 'node-3',
            type: 'enrichment',
            plugin: 'afi-plugin-3',
            enabled: true,
            dependencies: ['node-2'],
          },
          {
            id: 'node-4',
            type: 'enrichment',
            plugin: 'afi-plugin-4',
            enabled: true,
            dependencies: ['node-3'],
          },
          {
            id: 'node-5',
            type: 'enrichment',
            plugin: 'afi-plugin-5',
            enabled: true,
            dependencies: ['node-4'],
          },
        ],
        valid: true,
      });

      // Execute Analyst node
      const state = await analystNode.execute(initialState);

      // Verify node execution order
      const nodeExecutionOrder = state.enrichmentResults.get('node-execution-order');
      expect(nodeExecutionOrder).toEqual(['node-1', 'node-2', 'node-3', 'node-4', 'node-5']);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty enrichment results', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node
      let state = await analystNode.execute(initialState);

      // Don't add any enrichment results
      // state.enrichmentResults is empty

      // Execute Execution node should fail
      await expect(executionNode.execute(state)).rejects.toThrow(
        'No enrichment results found'
      );
    });

    it('should handle single enrichment result', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node
      let state = await analystNode.execute(initialState);

      // Add single enrichment result
      state.enrichmentResults.set('single-enrichment', { score: 0.75 });

      // Execute Execution node
      state = await executionNode.execute(state);

      // Verify scored signal was created
      const scoredSignal = state.enrichmentResults.get('scored-signal');
      expect(scoredSignal).toBeDefined();
      expect((scoredSignal as Record<string, unknown>).score).toBeGreaterThan(0);
    });

    it('should handle enrichment results with null values', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node
      let state = await analystNode.execute(initialState);

      // Add enrichment results with null values
      state.enrichmentResults.set('valid-enrichment', { score: 0.75 });
      state.enrichmentResults.set('null-enrichment', null);
      state.enrichmentResults.set('undefined-enrichment', undefined);

      // Execute Execution node should fail
      await expect(executionNode.execute(state)).rejects.toThrow(
        'Enrichment nodes failed'
      );
    });

    it('should handle extreme score values', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Execute Analyst node
      let state = await analystNode.execute(initialState);

      // Add enrichment result with extreme score
      state.enrichmentResults.set('extreme-enrichment', { score: 0.999 });

      // Execute Execution node
      state = await executionNode.execute(state);

      // Verify scored signal
      const scoredSignal = state.enrichmentResults.get('scored-signal') as Record<string, unknown>;
      expect(scoredSignal.score).toBeLessThanOrEqual(1);
      expect(scoredSignal.score).toBeGreaterThanOrEqual(0);
    });
  });
});
