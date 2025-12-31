/**
 * Unit tests for ScoutNode
 *
 * @module afi-reactor/src/langgraph/plugins/__tests__/ScoutNode.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ScoutNode } from '../ScoutNode.js';
import type { PipelineState } from '../../types/pipeline.js';

describe('ScoutNode', () => {
  let scoutNode: ScoutNode;
  let mockState: PipelineState;

  beforeEach(() => {
    scoutNode = new ScoutNode();

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
      expect(scoutNode.id).toBe('scout');
    });

    it('should have correct type', () => {
      expect(scoutNode.type).toBe('ingress');
    });

    it('should have correct plugin', () => {
      expect(scoutNode.plugin).toBe('scout');
    });

    it('should have parallel set to true', () => {
      expect(scoutNode.parallel).toBe(true);
    });

    it('should have empty dependencies', () => {
      expect(scoutNode.dependencies).toEqual([]);
    });
  });

  describe('execute', () => {
    it('should successfully execute and return updated state', async () => {
      const result = await scoutNode.execute(mockState);

      expect(result).toBeDefined();
      expect(result.signalId).toBe('test-signal-123');
      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('scout');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.metadata.trace[0].duration).toBeGreaterThan(0);
    });

    it('should add trace entry with correct structure', async () => {
      const result = await scoutNode.execute(mockState);

      const traceEntry = result.metadata.trace[0];
      expect(traceEntry).toHaveProperty('nodeId', 'scout');
      expect(traceEntry).toHaveProperty('nodeType', 'ingress');
      expect(traceEntry).toHaveProperty('startTime');
      expect(traceEntry).toHaveProperty('endTime');
      expect(traceEntry).toHaveProperty('duration');
      expect(traceEntry).toHaveProperty('status', 'completed');
    });

    it('should store scout results in enrichment results', async () => {
      const result = await scoutNode.execute(mockState);

      const scoutResults = result.enrichmentResults.get('scout');
      expect(scoutResults).toBeDefined();
      expect(typeof scoutResults).toBe('object');
      expect(scoutResults).toHaveProperty('signals');
      expect(scoutResults).toHaveProperty('totalSignals');
      expect(scoutResults).toHaveProperty('discoveredAt');
      expect(scoutResults).toHaveProperty('scoutId');
    });

    it('should return signals array', async () => {
      const result = await scoutNode.execute(mockState);

      const scoutResults = result.enrichmentResults.get('scout') as {
        signals: unknown[];
      };
      expect(Array.isArray(scoutResults.signals)).toBe(true);
    });

    it('should include totalSignals count', async () => {
      const result = await scoutNode.execute(mockState);

      const scoutResults = result.enrichmentResults.get('scout') as {
        totalSignals: number;
      };
      expect(typeof scoutResults.totalSignals).toBe('number');
      expect(scoutResults.totalSignals).toBeGreaterThan(0);
    });

    it('should include discoveredAt timestamp', async () => {
      const result = await scoutNode.execute(mockState);

      const scoutResults = result.enrichmentResults.get('scout') as {
        discoveredAt: string;
      };
      expect(typeof scoutResults.discoveredAt).toBe('string');
      expect(new Date(scoutResults.discoveredAt)).toBeInstanceOf(Date);
    });

    it('should NOT score signals - scoring is done by Analyst node', async () => {
      const result = await scoutNode.execute(mockState);

      const scoutResults = result.enrichmentResults.get('scout') as {
        signals: Array<{
          type: string;
          description: string;
          timestamp: string;
          metadata: Record<string, unknown>;
        }>;
      };

      expect(scoutResults.signals.length).toBeGreaterThan(0);
      const firstSignal = scoutResults.signals[0];
      // Scout signals should NOT have confidence or priority
      expect(firstSignal).not.toHaveProperty('confidence');
      expect(firstSignal).not.toHaveProperty('priority');
    });

    it('should track scoutId for reward attribution', async () => {
      const result = await scoutNode.execute(mockState);

      const scoutResults = result.enrichmentResults.get('scout') as {
        scoutId: string;
      };
      expect(scoutResults).toHaveProperty('scoutId');
      expect(typeof scoutResults.scoutId).toBe('string');
      expect(scoutResults.scoutId).toBe('scout:afi-native:v1');
    });

    it('should extract asset info from raw signal', async () => {
      const result = await scoutNode.execute(mockState);

      const scoutResults = result.enrichmentResults.get('scout');
      expect(scoutResults).toBeDefined();
    });

    it('should handle raw signal without asset info', async () => {
      const stateWithoutAssetInfo = {
        ...mockState,
        rawSignal: { price: 50000 },
      };

      const result = await scoutNode.execute(stateWithoutAssetInfo);

      const scoutResults = result.enrichmentResults.get('scout');
      expect(scoutResults).toBeDefined();
    });

    it('should handle null raw signal gracefully', async () => {
      // ScoutNode should handle null rawSignal gracefully by using default values
      const stateWithNullSignal = {
        ...mockState,
        rawSignal: null,
      };

      const result = await scoutNode.execute(stateWithNullSignal);

      // Should complete successfully with default asset info
      expect(result).toBeDefined();
      expect(result.metadata.trace[0].status).toBe('completed');
      const scoutResults = result.enrichmentResults.get('scout');
      expect(scoutResults).toBeDefined();
    });
  });
});
