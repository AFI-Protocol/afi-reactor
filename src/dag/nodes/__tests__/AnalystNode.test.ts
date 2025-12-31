/**
 * Unit tests for AnalystNode
 *
 * @module afi-reactor/src/dag/nodes/__tests__/AnalystNode.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalystNode } from '../AnalystNode.js';
import type { PipelineState } from '../../types/pipeline.js';

// Mock the afi-factory module
vi.mock('afi-factory/template_registry.js', () => ({
  loadAnalystConfig: vi.fn(),
}));

describe('AnalystNode', () => {
  let analystNode: AnalystNode;
  let mockState: PipelineState;

  beforeEach(() => {
    analystNode = new AnalystNode();

    // Create a mock state
    mockState = {
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
          },
        ],
      },
      metadata: {
        startTime: '2024-12-26T10:00:00Z',
        trace: [],
      },
    };
  });

  describe('Node properties', () => {
    it('should have correct id', () => {
      expect(analystNode.id).toBe('analyst');
    });

    it('should have correct type', () => {
      expect(analystNode.type).toBe('required');
    });

    it('should have correct plugin', () => {
      expect(analystNode.plugin).toBe('analyst');
    });

    it('should have parallel set to false', () => {
      expect(analystNode.parallel).toBe(false);
    });

    it('should have empty dependencies', () => {
      expect(analystNode.dependencies).toEqual([]);
    });
  });

  describe('execute', () => {
    it('should successfully execute and return updated state', async () => {
      // Mock loadAnalystConfig to return a valid configuration
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
        ],
        valid: true,
      });

      const result = await analystNode.execute(mockState);

      expect(result).toBeDefined();
      expect(result.signalId).toBe('test-signal-123');
      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('analyst');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.metadata.trace[0].duration).toBeGreaterThan(0);
    });

    it('should add trace entry with correct structure', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      const result = await analystNode.execute(mockState);

      const traceEntry = result.metadata.trace[0];
      expect(traceEntry).toHaveProperty('nodeId', 'analyst');
      expect(traceEntry).toHaveProperty('nodeType', 'required');
      expect(traceEntry).toHaveProperty('startTime');
      expect(traceEntry).toHaveProperty('endTime');
      expect(traceEntry).toHaveProperty('duration');
      expect(traceEntry).toHaveProperty('status', 'completed');
    });

    it('should store enabled nodes in enrichment results', async () => {
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
            enabled: false,
          },
        ],
        valid: true,
      });

      const result = await analystNode.execute(mockState);

      const enabledNodes = result.enrichmentResults.get('enabled-nodes');
      expect(enabledNodes).toBeDefined();
      expect(Array.isArray(enabledNodes)).toBe(true);
      expect(enabledNodes).toHaveLength(1);
      expect((enabledNodes as Array<{ id: string }>)[0].id).toBe('price-enricher');
    });

    it('should store node execution order in enrichment results', async () => {
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
            dependencies: ['price-enricher'],
          },
        ],
        valid: true,
      });

      const result = await analystNode.execute(mockState);

      const nodeExecutionOrder = result.enrichmentResults.get('node-execution-order');
      expect(nodeExecutionOrder).toBeDefined();
      expect(Array.isArray(nodeExecutionOrder)).toBe(true);
      expect(nodeExecutionOrder).toHaveLength(2);
      expect((nodeExecutionOrder as string[])[0]).toBe('price-enricher');
      expect((nodeExecutionOrder as string[])[1]).toBe('sentiment-analyzer');
    });

    it('should store signal metadata in enrichment results', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      const result = await analystNode.execute(mockState);

      const signalMetadata = result.enrichmentResults.get('signal-metadata');
      expect(signalMetadata).toBeDefined();
      expect(typeof signalMetadata).toBe('object');
      expect(signalMetadata).toHaveProperty('signalId', 'test-signal-123');
      expect(signalMetadata).toHaveProperty('analystId', 'test-analyst');
      expect(signalMetadata).toHaveProperty('timestamp');
      expect(signalMetadata).toHaveProperty('preparedAt');
    });

    it('should handle topological sort correctly', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node-a',
            type: 'enrichment',
            plugin: 'afi-plugin-a',
            enabled: true,
          },
          {
            id: 'node-b',
            type: 'enrichment',
            plugin: 'afi-plugin-b',
            enabled: true,
            dependencies: ['node-a'],
          },
          {
            id: 'node-c',
            type: 'enrichment',
            plugin: 'afi-plugin-c',
            enabled: true,
            dependencies: ['node-b'],
          },
        ],
        valid: true,
      });

      const result = await analystNode.execute(mockState);

      const nodeExecutionOrder = result.enrichmentResults.get('node-execution-order');
      expect(nodeExecutionOrder).toEqual(['node-a', 'node-b', 'node-c']);
    });

    it('should detect circular dependencies', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'node-a',
            type: 'enrichment',
            plugin: 'afi-plugin-a',
            enabled: true,
            dependencies: ['node-b'],
          },
          {
            id: 'node-b',
            type: 'enrichment',
            plugin: 'afi-plugin-b',
            enabled: true,
            dependencies: ['node-a'],
          },
        ],
        valid: true,
      });

      await expect(analystNode.execute(mockState)).rejects.toThrow(
        'Circular dependency detected'
      );
    });

    it('should add failed trace entry on error', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockRejectedValue(
        new Error('Failed to load configuration')
      );

      await expect(analystNode.execute(mockState)).rejects.toThrow();

      const traceEntry = mockState.metadata.trace[0];
      expect(traceEntry).toHaveProperty('status', 'failed');
      expect(traceEntry).toHaveProperty('error');
    });

    it('should throw error if analyst configuration is missing analystId', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: '',
        enrichmentNodes: [],
        valid: true,
      });

      await expect(analystNode.execute(mockState)).rejects.toThrow(
        'Analyst configuration missing analystId'
      );
    });

    it('should throw error if analyst configuration is missing enrichmentNodes', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: undefined as any,
        valid: true,
      });

      await expect(analystNode.execute(mockState)).rejects.toThrow(
        'Analyst configuration missing or invalid enrichmentNodes'
      );
    });

    it('should throw error if enrichment node is missing id', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: '',
            type: 'enrichment',
            plugin: 'afi-plugin',
            enabled: true,
          },
        ],
        valid: true,
      });

      await expect(analystNode.execute(mockState)).rejects.toThrow(
        'Enrichment node missing id'
      );
    });

    it('should throw error if enrichment node has invalid type', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'test-node',
            type: 'invalid' as any,
            plugin: 'afi-plugin',
            enabled: true,
          },
        ],
        valid: true,
      });

      await expect(analystNode.execute(mockState)).rejects.toThrow(
        "Enrichment node 'test-node' has invalid type"
      );
    });

    it('should throw error if enrichment node is missing plugin', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'test-node',
            type: 'enrichment',
            plugin: '',
            enabled: true,
          },
        ],
        valid: true,
      });

      await expect(analystNode.execute(mockState)).rejects.toThrow(
        "Enrichment node 'test-node' missing plugin"
      );
    });

    it('should throw error if enrichment node has invalid enabled field', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [
          {
            id: 'test-node',
            type: 'enrichment',
            plugin: 'afi-plugin',
            enabled: undefined as any,
          },
        ],
        valid: true,
      });

      await expect(analystNode.execute(mockState)).rejects.toThrow(
        "Enrichment node 'test-node' missing or invalid enabled field"
      );
    });

    it('should throw error if raw signal is missing', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      const stateWithoutRawSignal = {
        ...mockState,
        rawSignal: undefined as any,
      };

      await expect(analystNode.execute(stateWithoutRawSignal)).rejects.toThrow(
        'Raw signal is missing'
      );
    });

    it('should aggregate all enrichment results including AI/ML', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Add mock enrichment results
      mockState.enrichmentResults.set('technical-indicators', { indicators: ['RSI', 'MACD'] });
      mockState.enrichmentResults.set('pattern-recognition', { patterns: ['head-and-shoulders'] });
      mockState.enrichmentResults.set('sentiment', { sentiment: 'bullish' });
      mockState.enrichmentResults.set('news', { newsCount: 5 });
      mockState.enrichmentResults.set('ai-ml', {
        aiMl: {
          convictionScore: 0.85,
          direction: 'long',
          regime: 'bull',
          riskFlag: 'low',
        },
      });
      mockState.enrichmentResults.set('scout', {
        signals: [
          {
            type: 'price-breakout',
            description: 'Price broke above resistance level',
            timestamp: new Date().toISOString(),
            metadata: { resistanceLevel: 50000 },
          },
        ],
        totalSignals: 1,
        discoveredAt: new Date().toISOString(),
        scoutId: 'scout:afi-native:v1',
      });

      const result = await analystNode.execute(mockState);

      // Check that scored signals are stored
      const scoredSignals = result.enrichmentResults.get('scored-signal');
      expect(scoredSignals).toBeDefined();
      expect(Array.isArray(scoredSignals)).toBe(true);
      expect((scoredSignals as any[]).length).toBeGreaterThan(0);
    });

    it('should score Scout signals with confidence and priority', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Add mock Scout signals
      mockState.enrichmentResults.set('scout', {
        signals: [
          {
            type: 'price-breakout',
            description: 'Price broke above resistance level',
            timestamp: new Date().toISOString(),
            metadata: { resistanceLevel: 50000 },
          },
        ],
        totalSignals: 1,
        discoveredAt: new Date().toISOString(),
        scoutId: 'scout:afi-native:v1',
      });

      const result = await analystNode.execute(mockState);

      const scoredSignals = result.enrichmentResults.get('scored-signal') as Array<{
        type: string;
        confidence: number;
        priority: 'high' | 'medium' | 'low';
      }>;

      expect(scoredSignals).toBeDefined();
      expect(scoredSignals.length).toBeGreaterThan(0);
      const firstSignal = scoredSignals[0];
      expect(firstSignal).toHaveProperty('confidence');
      expect(firstSignal).toHaveProperty('priority');
      expect(['high', 'medium', 'low']).toContain(firstSignal.priority);
      expect(firstSignal.confidence).toBeGreaterThanOrEqual(0);
      expect(firstSignal.confidence).toBeLessThanOrEqual(1);
    });

    it('should incorporate AI/ML predictions into scoring', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Add mock Scout signals
      mockState.enrichmentResults.set('scout', {
        signals: [
          {
            type: 'price-breakout',
            description: 'Price broke above resistance level',
            timestamp: new Date().toISOString(),
            metadata: { resistanceLevel: 50000 },
          },
        ],
        totalSignals: 1,
        discoveredAt: new Date().toISOString(),
        scoutId: 'scout:afi-native:v1',
      });

      // Add mock AI/ML predictions with high conviction
      mockState.enrichmentResults.set('ai-ml', {
        aiMl: {
          convictionScore: 0.9,
          direction: 'long',
          regime: 'bull',
          riskFlag: 'low',
        },
      });

      const result = await analystNode.execute(mockState);

      const scoredSignals = result.enrichmentResults.get('scored-signal') as Array<{
        confidence: number;
        priority: 'high' | 'medium' | 'low';
        aiMlInsights: unknown;
      }>;

      expect(scoredSignals).toBeDefined();
      const firstSignal = scoredSignals[0];
      // With high AI/ML conviction (0.9), priority should be 'high'
      expect(firstSignal.priority).toBe('high');
      // Confidence should be influenced by AI/ML conviction
      expect(firstSignal.confidence).toBeGreaterThan(0.7);
      // Should include AI/ML insights
      expect(firstSignal.aiMlInsights).toBeDefined();
    });

    it('should generate narratives with AI/ML insights', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Add mock Scout signals
      mockState.enrichmentResults.set('scout', {
        signals: [
          {
            type: 'price-breakout',
            description: 'Price broke above resistance level',
            timestamp: new Date().toISOString(),
            metadata: { resistanceLevel: 50000 },
          },
        ],
        totalSignals: 1,
        discoveredAt: new Date().toISOString(),
        scoutId: 'scout:afi-native:v1',
      });

      // Add mock AI/ML predictions
      mockState.enrichmentResults.set('ai-ml', {
        aiMl: {
          convictionScore: 0.85,
          direction: 'long',
          regime: 'bull',
          riskFlag: 'low',
        },
      });

      const result = await analystNode.execute(mockState);

      const narratives = result.enrichmentResults.get('narratives') as Array<{
        signalType: string;
        narrative: string;
        confidence: number;
        priority: 'high' | 'medium' | 'low';
        aiMlInsights?: string;
      }>;

      expect(narratives).toBeDefined();
      expect(Array.isArray(narratives)).toBe(true);
      expect(narratives.length).toBeGreaterThan(0);
      const firstNarrative = narratives[0];
      expect(firstNarrative).toHaveProperty('signalType');
      expect(firstNarrative).toHaveProperty('narrative');
      expect(firstNarrative).toHaveProperty('confidence');
      expect(firstNarrative).toHaveProperty('priority');
      expect(firstNarrative).toHaveProperty('aiMlInsights');
      // Narrative should include AI/ML insights
      expect(firstNarrative.aiMlInsights).toContain('AI/ML conviction');
    });

    it('should handle missing AI/ML predictions gracefully', async () => {
      const { loadAnalystConfig } = await import('afi-factory/template_registry.js');
      vi.mocked(loadAnalystConfig).mockResolvedValue({
        analystId: 'test-analyst',
        enrichmentNodes: [],
        valid: true,
      });

      // Add mock Scout signals without AI/ML predictions
      mockState.enrichmentResults.set('scout', {
        signals: [
          {
            type: 'price-breakout',
            description: 'Price broke above resistance level',
            timestamp: new Date().toISOString(),
            metadata: { resistanceLevel: 50000 },
          },
        ],
        totalSignals: 1,
        discoveredAt: new Date().toISOString(),
        scoutId: 'scout:afi-native:v1',
      });

      const result = await analystNode.execute(mockState);

      // Should still score signals even without AI/ML predictions
      const scoredSignals = result.enrichmentResults.get('scored-signal');
      expect(scoredSignals).toBeDefined();
      expect(Array.isArray(scoredSignals)).toBe(true);

      // Should still generate narratives
      const narratives = result.enrichmentResults.get('narratives');
      expect(narratives).toBeDefined();
      expect(Array.isArray(narratives)).toBe(true);
    });
  });
});
