/**
 * Unit tests for SignalIngressNode
 *
 * @module afi-reactor/src/langgraph/plugins/__tests__/SignalIngressNode.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SignalIngressNode } from '../SignalIngressNode.js';
import type { PipelineState } from '../../../types/pipeline.js';

describe('SignalIngressNode', () => {
  let signalIngressNode: SignalIngressNode;
  let mockState: PipelineState;

  beforeEach(() => {
    signalIngressNode = new SignalIngressNode();

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
      expect(signalIngressNode.id).toBe('signal-ingress');
    });

    it('should have correct type', () => {
      expect(signalIngressNode.type).toBe('ingress');
    });

    it('should have correct plugin', () => {
      expect(signalIngressNode.plugin).toBe('signal-ingress');
    });

    it('should have parallel set to true', () => {
      expect(signalIngressNode.parallel).toBe(true);
    });

    it('should have empty dependencies', () => {
      expect(signalIngressNode.dependencies).toEqual([]);
    });
  });

  describe('execute', () => {
    it('should successfully execute and return updated state', async () => {
      const result = await signalIngressNode.execute(mockState);

      expect(result).toBeDefined();
      expect(result.signalId).toBe('test-signal-123');
      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('signal-ingress');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.metadata.trace[0].duration).toBeGreaterThan(0);
    });

    it('should add trace entry with correct structure', async () => {
      const result = await signalIngressNode.execute(mockState);

      const traceEntry = result.metadata.trace[0];
      expect(traceEntry).toHaveProperty('nodeId', 'signal-ingress');
      expect(traceEntry).toHaveProperty('nodeType', 'ingress');
      expect(traceEntry).toHaveProperty('startTime');
      expect(traceEntry).toHaveProperty('endTime');
      expect(traceEntry).toHaveProperty('duration');
      expect(traceEntry).toHaveProperty('status', 'completed');
    });

    it('should store signal ingress results in enrichment results', async () => {
      const result = await signalIngressNode.execute(mockState);

      const ingressResults = result.enrichmentResults.get('signal-ingress');
      expect(ingressResults).toBeDefined();
      expect(typeof ingressResults).toBe('object');
      expect(ingressResults).toHaveProperty('signals');
      expect(ingressResults).toHaveProperty('totalSignals');
      expect(ingressResults).toHaveProperty('validSignals');
      expect(ingressResults).toHaveProperty('normalizedSignals');
      expect(ingressResults).toHaveProperty('ingestedAt');
    });

    it('should return signals array', async () => {
      const result = await signalIngressNode.execute(mockState);

      const ingressResults = result.enrichmentResults.get('signal-ingress') as {
        signals: unknown[];
      };
      expect(Array.isArray(ingressResults.signals)).toBe(true);
    });

    it('should include totalSignals count', async () => {
      const result = await signalIngressNode.execute(mockState);

      const ingressResults = result.enrichmentResults.get('signal-ingress') as {
        totalSignals: number;
      };
      expect(typeof ingressResults.totalSignals).toBe('number');
      expect(ingressResults.totalSignals).toBeGreaterThan(0);
    });

    it('should include validSignals count', async () => {
      const result = await signalIngressNode.execute(mockState);

      const ingressResults = result.enrichmentResults.get('signal-ingress') as {
        totalSignals: number;
        validSignals: number;
      };
      expect(typeof ingressResults.validSignals).toBe('number');
      expect(ingressResults.validSignals).toBeGreaterThan(0);
      expect(ingressResults.validSignals).toBeLessThanOrEqual(ingressResults.totalSignals);
    });

    it('should include normalizedSignals count', async () => {
      const result = await signalIngressNode.execute(mockState);

      const ingressResults = result.enrichmentResults.get('signal-ingress') as {
        validSignals: number;
        normalizedSignals: number;
      };
      expect(typeof ingressResults.normalizedSignals).toBe('number');
      expect(ingressResults.normalizedSignals).toBeGreaterThan(0);
      expect(ingressResults.normalizedSignals).toBeLessThanOrEqual(ingressResults.validSignals);
    });

    it('should include ingestedAt timestamp', async () => {
      const result = await signalIngressNode.execute(mockState);

      const ingressResults = result.enrichmentResults.get('signal-ingress') as {
        ingestedAt: string;
      };
      expect(typeof ingressResults.ingestedAt).toBe('string');
      expect(new Date(ingressResults.ingestedAt)).toBeInstanceOf(Date);
    });

    it('should validate signals and mark invalid ones', async () => {
      const result = await signalIngressNode.execute(mockState);

      const ingressResults = result.enrichmentResults.get('signal-ingress') as {
        signals: Array<{
          source: string;
          signalId: string;
          timestamp: string;
          data: Record<string, unknown>;
          valid: boolean;
          validationErrors: string[];
          normalized: boolean;
          normalizedAt: string;
        }>;
      };

      // All mock signals should be valid
      expect(ingressResults.signals.length).toBeGreaterThan(0);
      ingressResults.signals.forEach(signal => {
        expect(signal).toHaveProperty('valid');
        expect(signal).toHaveProperty('validationErrors');
        expect(Array.isArray(signal.validationErrors)).toBe(true);
      });
    });

    it('should normalize valid signals', async () => {
      const result = await signalIngressNode.execute(mockState);

      const ingressResults = result.enrichmentResults.get('signal-ingress') as {
        signals: Array<{
          source: string;
          signalId: string;
          timestamp: string;
          data: Record<string, unknown>;
          valid: boolean;
          validationErrors: string[];
          normalized: boolean;
          normalizedAt: string;
        }>;
      };

      // All valid signals should be normalized
      const validSignals = ingressResults.signals.filter(s => s.valid);
      validSignals.forEach(signal => {
        expect(signal.normalized).toBe(true);
        expect(signal).toHaveProperty('normalizedAt');
        expect(typeof signal.normalizedAt).toBe('string');
      });
    });

    it('should include signal metadata', async () => {
      const result = await signalIngressNode.execute(mockState);

      const ingressResults = result.enrichmentResults.get('signal-ingress') as {
        signals: Array<{
          source: string;
          signalId: string;
          timestamp: string;
          data: Record<string, unknown>;
        }>;
      };

      expect(ingressResults.signals.length).toBeGreaterThan(0);
      const firstSignal = ingressResults.signals[0];
      expect(firstSignal).toHaveProperty('source');
      expect(firstSignal).toHaveProperty('signalId');
      expect(firstSignal).toHaveProperty('timestamp');
      expect(firstSignal).toHaveProperty('data');
    });

    it('should add failed trace entry on error', async () => {
      // Mock a scenario that would cause an error
      const stateWithInvalidSignal = {
        ...mockState,
        rawSignal: null,
      };

      await expect(signalIngressNode.execute(stateWithInvalidSignal)).rejects.toThrow();

      const traceEntry = mockState.metadata.trace[0];
      expect(traceEntry).toHaveProperty('status', 'failed');
      expect(traceEntry).toHaveProperty('error');
    });
  });
});
