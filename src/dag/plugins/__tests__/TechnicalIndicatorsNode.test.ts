/**
 * Unit tests for TechnicalIndicatorsNode
 *
 * @module afi-reactor/src/langgraph/plugins/__tests__/TechnicalIndicatorsNode.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TechnicalIndicatorsNode } from '../TechnicalIndicatorsNode.js';
import type { PipelineState } from '../../types/dag.js';

describe('TechnicalIndicatorsNode', () => {
  let technicalIndicatorsNode: TechnicalIndicatorsNode;
  let mockState: PipelineState;

  beforeEach(() => {
    technicalIndicatorsNode = new TechnicalIndicatorsNode();

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
      expect(technicalIndicatorsNode.id).toBe('technical-indicators');
    });

    it('should have correct type', () => {
      expect(technicalIndicatorsNode.type).toBe('enrichment');
    });

    it('should have correct plugin', () => {
      expect(technicalIndicatorsNode.plugin).toBe('technical-indicators');
    });

    it('should have parallel set to true', () => {
      expect(technicalIndicatorsNode.parallel).toBe(true);
    });

    it('should have empty dependencies', () => {
      expect(technicalIndicatorsNode.dependencies).toEqual([]);
    });
  });

  describe('execute', () => {
    it('should successfully execute and return updated state', async () => {
      const result = await technicalIndicatorsNode.execute(mockState);

      expect(result).toBeDefined();
      expect(result.signalId).toBe('test-signal-123');
      expect(result.metadata.trace).toHaveLength(1);
      expect(result.metadata.trace[0].nodeId).toBe('technical-indicators');
      expect(result.metadata.trace[0].status).toBe('completed');
      expect(result.metadata.trace[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should add trace entry with correct structure', async () => {
      const result = await technicalIndicatorsNode.execute(mockState);

      const traceEntry = result.metadata.trace[0];
      expect(traceEntry).toHaveProperty('nodeId', 'technical-indicators');
      expect(traceEntry).toHaveProperty('nodeType', 'enrichment');
      expect(traceEntry).toHaveProperty('startTime');
      expect(traceEntry).toHaveProperty('endTime');
      expect(traceEntry).toHaveProperty('duration');
      expect(traceEntry).toHaveProperty('status', 'completed');
    });

    it('should store technical indicators in enrichment results', async () => {
      const result = await technicalIndicatorsNode.execute(mockState);

      const indicators = result.enrichmentResults.get('technical-indicators');
      expect(indicators).toBeDefined();
      expect(typeof indicators).toBe('object');
      expect(indicators).toHaveProperty('sma');
      expect(indicators).toHaveProperty('ema');
      expect(indicators).toHaveProperty('rsi');
      expect(indicators).toHaveProperty('macd');
      expect(indicators).toHaveProperty('bollingerBands');
    });

    it('should calculate SMA correctly', async () => {
      const result = await technicalIndicatorsNode.execute(mockState);

      const indicators = result.enrichmentResults.get('technical-indicators') as {
        sma: number[];
      };
      expect(Array.isArray(indicators.sma)).toBe(true);
      expect(indicators.sma.length).toBeGreaterThanOrEqual(0);
    });

    it('should calculate EMA correctly', async () => {
      const result = await technicalIndicatorsNode.execute(mockState);

      const indicators = result.enrichmentResults.get('technical-indicators') as {
        ema: number[];
      };
      expect(Array.isArray(indicators.ema)).toBe(true);
      expect(indicators.ema.length).toBeGreaterThan(0);
    });

    it('should calculate RSI correctly', async () => {
      const result = await technicalIndicatorsNode.execute(mockState);

      const indicators = result.enrichmentResults.get('technical-indicators') as {
        rsi: number;
      };
      expect(typeof indicators.rsi).toBe('number');
      expect(indicators.rsi).toBeGreaterThanOrEqual(0);
      expect(indicators.rsi).toBeLessThanOrEqual(100);
    });

    it('should calculate MACD correctly', async () => {
      const result = await technicalIndicatorsNode.execute(mockState);

      const indicators = result.enrichmentResults.get('technical-indicators') as {
        macd: {
          macd: number;
          signal: number;
          histogram: number;
        };
      };
      expect(typeof indicators.macd).toBe('object');
      expect(indicators.macd).toHaveProperty('macd');
      expect(indicators.macd).toHaveProperty('signal');
      expect(indicators.macd).toHaveProperty('histogram');
    });

    it('should calculate Bollinger Bands correctly', async () => {
      const result = await technicalIndicatorsNode.execute(mockState);

      const indicators = result.enrichmentResults.get('technical-indicators') as {
        bollingerBands: {
          upper: number;
          middle: number;
          lower: number;
        };
      };
      expect(typeof indicators.bollingerBands).toBe('object');
      expect(indicators.bollingerBands).toHaveProperty('upper');
      expect(indicators.bollingerBands).toHaveProperty('middle');
      expect(indicators.bollingerBands).toHaveProperty('lower');
      expect(indicators.bollingerBands.upper).toBeGreaterThanOrEqual(indicators.bollingerBands.middle);
      expect(indicators.bollingerBands.lower).toBeLessThanOrEqual(indicators.bollingerBands.middle);
    });

    it('should extract price data from raw signal with prices array', async () => {
      const stateWithPrices = {
        ...mockState,
        rawSignal: { prices: [50000, 50100, 50200, 50150, 50300] },
      };

      const result = await technicalIndicatorsNode.execute(stateWithPrices);

      const indicators = result.enrichmentResults.get('technical-indicators');
      expect(indicators).toBeDefined();
    });

    it('should extract price data from raw signal with single price', async () => {
      const stateWithSinglePrice = {
        ...mockState,
        rawSignal: { price: 50000 },
      };

      const result = await technicalIndicatorsNode.execute(stateWithSinglePrice);

      const indicators = result.enrichmentResults.get('technical-indicators');
      expect(indicators).toBeDefined();
    });

    it('should add failed trace entry on error', async () => {
      const stateWithInvalidPrice = {
        ...mockState,
        rawSignal: { prices: [NaN, 50100, 50200] },
      };

      await expect(technicalIndicatorsNode.execute(stateWithInvalidPrice)).rejects.toThrow();

      const traceEntry = mockState.metadata.trace[0];
      expect(traceEntry).toHaveProperty('status', 'failed');
      expect(traceEntry).toHaveProperty('error');
    });

    it('should throw error if price data is empty', async () => {
      const stateWithEmptyPrices = {
        ...mockState,
        rawSignal: { prices: [] },
      };

      await expect(technicalIndicatorsNode.execute(stateWithEmptyPrices)).rejects.toThrow(
        'Price data is empty'
      );
    });

    it('should throw error if price data contains invalid values', async () => {
      const stateWithInvalidPrices = {
        ...mockState,
        rawSignal: { prices: [50000, -100, 50200] },
      };

      await expect(technicalIndicatorsNode.execute(stateWithInvalidPrices)).rejects.toThrow(
        'Price data at index 1 is invalid'
      );
    });
  });
});
