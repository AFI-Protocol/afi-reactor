/**
 * Unit tests for PatternRecognitionNode
 *
 * @module afi-reactor/src/langgraph/plugins/__tests__/PatternRecognitionNode.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PatternRecognitionNode } from '../PatternRecognitionNode.js';
import type { PipelineState } from '../../types/pipeline.js';

describe('PatternRecognitionNode', () => {
  let patternRecognitionNode: PatternRecognitionNode;
  let mockState: PipelineState;

  beforeEach(() => {
    patternRecognitionNode = new PatternRecognitionNode();

    // Create a mock state
    mockState = {
      signalId: 'test-signal-123',
      rawSignal: { price: 50000, timestamp: 1703587200000 },
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
      expect(patternRecognitionNode.id).toBe('pattern-recognition');
    });

    it('should have correct type', () => {
      expect(patternRecognitionNode.type).toBe('enrichment');
    });

    it('should have correct plugin', () => {
      expect(patternRecognitionNode.plugin).toBe('pattern-recognition');
    });

    it('should have parallel set to false', () => {
      expect(patternRecognitionNode.parallel).toBe(false);
    });

    it('should have correct dependencies', () => {
      expect(patternRecognitionNode.dependencies).toEqual(['technical-indicators']);
    });
  });

  describe('execute', () => {
    it('should successfully execute and return updated state', async () => {
      // Pre-populate technical indicators
      mockState.enrichmentResults.set('technical-indicators', {
        sma: [50100, 50200],
        ema: [50100, 50200],
        rsi: 65,
        macd: { macd: 100, signal: 90, histogram: 10 },
        bollingerBands: { upper: 50500, middle: 50200, lower: 49900 },
      });

      const result = await patternRecognitionNode.execute(mockState);

      expect(result).toBeDefined();
      expect(result.signalId).toBe('test-signal-123');
      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('pattern-recognition');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.metadata.trace[0].duration).toBeGreaterThan(0);
    });

    it('should add trace entry with correct structure', async () => {
      mockState.enrichmentResults.set('technical-indicators', {
        sma: [50100],
        ema: [50100],
        rsi: 65,
        macd: { macd: 100, signal: 90, histogram: 10 },
        bollingerBands: { upper: 50500, middle: 50200, lower: 49900 },
      });

      const result = await patternRecognitionNode.execute(mockState);

      const traceEntry = result.metadata.trace[0];
      expect(traceEntry).toHaveProperty('nodeId', 'pattern-recognition');
      expect(traceEntry).toHaveProperty('nodeType', 'enrichment');
      expect(traceEntry).toHaveProperty('startTime');
      expect(traceEntry).toHaveProperty('endTime');
      expect(traceEntry).toHaveProperty('duration');
      expect(traceEntry).toHaveProperty('status', 'completed');
    });

    it('should store pattern recognition results in enrichment results', async () => {
      mockState.enrichmentResults.set('technical-indicators', {
        sma: [50100],
        ema: [50100],
        rsi: 65,
        macd: { macd: 100, signal: 90, histogram: 10 },
        bollingerBands: { upper: 50500, middle: 50200, lower: 49900 },
      });

      const result = await patternRecognitionNode.execute(mockState);

      const patternResults = result.enrichmentResults.get('pattern-recognition');
      expect(patternResults).toBeDefined();
      expect(typeof patternResults).toBe('object');
      expect(patternResults).toHaveProperty('chartPatterns');
      expect(patternResults).toHaveProperty('candlestickPatterns');
      expect(patternResults).toHaveProperty('detectedAt');
    });

    it('should return chart patterns array', async () => {
      mockState.enrichmentResults.set('technical-indicators', {
        sma: [50100],
        ema: [50100],
        rsi: 65,
        macd: { macd: 100, signal: 90, histogram: 10 },
        bollingerBands: { upper: 50500, middle: 50200, lower: 49900 },
      });

      const result = await patternRecognitionNode.execute(mockState);

      const patternResults = result.enrichmentResults.get('pattern-recognition') as {
        chartPatterns: unknown[];
      };
      expect(Array.isArray(patternResults.chartPatterns)).toBe(true);
    });

    it('should return candlestick patterns array', async () => {
      mockState.enrichmentResults.set('technical-indicators', {
        sma: [50100],
        ema: [50100],
        rsi: 65,
        macd: { macd: 100, signal: 90, histogram: 10 },
        bollingerBands: { upper: 50500, middle: 50200, lower: 49900 },
      });

      const result = await patternRecognitionNode.execute(mockState);

      const patternResults = result.enrichmentResults.get('pattern-recognition') as {
        candlestickPatterns: unknown[];
      };
      expect(Array.isArray(patternResults.candlestickPatterns)).toBe(true);
    });

    it('should include detectedAt timestamp', async () => {
      mockState.enrichmentResults.set('technical-indicators', {
        sma: [50100],
        ema: [50100],
        rsi: 65,
        macd: { macd: 100, signal: 90, histogram: 10 },
        bollingerBands: { upper: 50500, middle: 50200, lower: 49900 },
      });

      const result = await patternRecognitionNode.execute(mockState);

      const patternResults = result.enrichmentResults.get('pattern-recognition') as {
        detectedAt: string;
      };
      expect(typeof patternResults.detectedAt).toBe('string');
      expect(new Date(patternResults.detectedAt)).toBeInstanceOf(Date);
    });

    it('should throw error if technical indicators are missing', async () => {
      await expect(patternRecognitionNode.execute(mockState)).rejects.toThrow(
        'Technical indicators are missing'
      );
    });

    it('should throw error if technical indicators are invalid', async () => {
      mockState.enrichmentResults.set('technical-indicators', null);

      await expect(patternRecognitionNode.execute(mockState)).rejects.toThrow(
        'Technical indicators are invalid'
      );
    });

    it('should add failed trace entry on error', async () => {
      await expect(patternRecognitionNode.execute(mockState)).rejects.toThrow();

      const traceEntry = mockState.metadata.trace[0];
      expect(traceEntry).toHaveProperty('status', 'failed');
      expect(traceEntry).toHaveProperty('error');
    });
  });
});
