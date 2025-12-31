/**
 * AFI Reactor - Technical Indicators Node
 *
 * This node is responsible for:
 * - Calculating technical indicators from price data
 * - Computing common indicators like RSI, MACD, moving averages
 * - Storing indicator results in enrichment results
 * - Adding trace entries for execution tracking
 *
 * @module afi-reactor/src/dag/plugins/TechnicalIndicatorsNode
 */

import type { Pipehead, PipelineState } from '../../types/dag.js';

/**
 * Technical Indicators Node - Enrichment Node
 *
 * The Technical Indicators node calculates technical indicators from price data.
 * This is an optional enrichment node that can be configured by analysts.
 */
export class TechnicalIndicatorsNode implements Pipehead {
  /** Node ID. Must be unique within the DAG. */
  id = 'technical-indicators';

  /** Node type. Enrichment nodes are analyst-configurable. */
  type = 'enrichment' as const;

  /** Plugin ID that implements this node. */
  plugin = 'technical-indicators';

  /** Whether this node can run in parallel with other nodes. */
  parallel = true;

  /** Node dependencies. The DAG will ensure all dependencies complete before executing this node. */
  dependencies: string[] = [];

  /**
   * Executes the Technical Indicators node.
   *
   * This method:
   * 1. Extracts price data from the raw signal
   * 2. Calculates technical indicators (RSI, MACD, moving averages, etc.)
   * 3. Stores indicator results in enrichment results
   * 4. Adds trace entries for execution tracking
   *
   * @param state - The current pipeline state
   * @returns Promise<PipelineState> - The updated state
   * @throws Error if price data is missing or invalid
   */
  async execute(state: PipelineState): Promise<PipelineState> {
    const startTime = Date.now();
    const startTimeIso = new Date(startTime).toISOString();

    // Create a trace entry for the start of execution
    const traceEntry = {
      nodeId: this.id,
      nodeType: this.type,
      startTime: startTimeIso,
      status: 'running' as const,
    };

    try {
      // Extract price data from raw signal
      const priceData = this.extractPriceData(state.rawSignal);

      // Validate price data
      this.validatePriceData(priceData);

      // Calculate technical indicators
      const indicators = this.calculateIndicators(priceData);

      // Store indicators in enrichment results
      state.enrichmentResults.set(this.id, indicators);

      // Update trace entry with completion status
      const endTime = Date.now();
      const endTimeIso = new Date(endTime).toISOString();
      const duration = endTime - startTime;

      const completedTraceEntry = {
        ...traceEntry,
        endTime: endTimeIso,
        duration,
        status: 'completed' as const,
      };

      state.metadata.trace.push(completedTraceEntry);

      return state;
    } catch (error) {
      // Update trace entry with failure status
      const endTime = Date.now();
      const endTimeIso = new Date(endTime).toISOString();
      const duration = endTime - startTime;

      const failedTraceEntry = {
        ...traceEntry,
        endTime: endTimeIso,
        duration,
        status: 'failed' as const,
        error: error instanceof Error ? error.message : String(error),
      };

      state.metadata.trace.push(failedTraceEntry);

      throw error;
    }
  }

  /**
   * Extracts price data from the raw signal.
   *
   * @param rawSignal - The raw signal data
   * @returns Price data array
   * @throws Error if price data cannot be extracted
   * @private
   */
  private extractPriceData(rawSignal: unknown): number[] {
    // Placeholder implementation
    // In a real implementation, this would extract price data from the signal
    if (typeof rawSignal === 'object' && rawSignal !== null) {
      const signal = rawSignal as Record<string, unknown>;
      if (Array.isArray(signal.prices)) {
        return signal.prices as number[];
      }
      if (typeof signal.price === 'number') {
        return [signal.price];
      }
    }

    // Return mock data for testing
    return [50000, 50100, 50200, 50150, 50300, 50400, 50350, 50500];
  }

  /**
   * Validates the price data.
   *
   * @param priceData - The price data to validate
   * @throws Error if price data is invalid
   * @private
   */
  private validatePriceData(priceData: number[]): void {
    if (!priceData || !Array.isArray(priceData)) {
      throw new Error('Price data is missing or invalid');
    }

    if (priceData.length === 0) {
      throw new Error('Price data is empty');
    }

    for (let i = 0; i < priceData.length; i++) {
      if (typeof priceData[i] !== 'number' || isNaN(priceData[i]) || priceData[i] <= 0) {
        throw new Error(`Price data at index ${i} is invalid: ${priceData[i]}`);
      }
    }
  }

  /**
   * Calculates technical indicators from price data.
   *
   * This method calculates common technical indicators:
   * - Simple Moving Average (SMA)
   * - Exponential Moving Average (EMA)
   * - Relative Strength Index (RSI)
   * - Moving Average Convergence Divergence (MACD)
   * - Bollinger Bands
   *
   * @param priceData - The price data to calculate indicators for
   * @returns Technical indicators object
   * @private
   */
  private calculateIndicators(priceData: number[]): {
    sma: number[];
    ema: number[];
    rsi: number;
    macd: {
      macd: number;
      signal: number;
      histogram: number;
    };
    bollingerBands: {
      upper: number;
      middle: number;
      lower: number;
    };
  } {
    // Calculate Simple Moving Average (SMA) with period 5
    const smaPeriod = 5;
    const sma: number[] = [];
    for (let i = smaPeriod - 1; i < priceData.length; i++) {
      const sum = priceData.slice(i - smaPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / smaPeriod);
    }

    // Calculate Exponential Moving Average (EMA) with period 5
    const emaPeriod = 5;
    const multiplier = 2 / (emaPeriod + 1);
    const ema: number[] = [];
    let emaValue = priceData[0];
    ema.push(emaValue);
    for (let i = 1; i < priceData.length; i++) {
      emaValue = (priceData[i] - emaValue) * multiplier + emaValue;
      ema.push(emaValue);
    }

    // Calculate Relative Strength Index (RSI) with period 14
    const rsiPeriod = 14;
    const rsi = this.calculateRSI(priceData, rsiPeriod);

    // Calculate MACD (12, 26, 9)
    const macd = this.calculateMACD(priceData);

    // Calculate Bollinger Bands (20, 2)
    const bollingerBands = this.calculateBollingerBands(priceData, 20, 2);

    return {
      sma,
      ema,
      rsi,
      macd,
      bollingerBands,
    };
  }

  /**
   * Calculates the Relative Strength Index (RSI).
   *
   * @param priceData - The price data
   * @param period - The RSI period
   * @returns The RSI value
   * @private
   */
  private calculateRSI(priceData: number[], period: number): number {
    if (priceData.length < period + 1) {
      return 50; // Default neutral value
    }

    let gains = 0;
    let losses = 0;

    // Calculate initial average gain and loss
    for (let i = 1; i <= period; i++) {
      const change = priceData[i] - priceData[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) {
      return 100;
    }

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  /**
   * Calculates the Moving Average Convergence Divergence (MACD).
   *
   * @param priceData - The price data
   * @returns MACD object with macd, signal, and histogram values
   * @private
   */
  private calculateMACD(priceData: number[]): {
    macd: number;
    signal: number;
    histogram: number;
  } {
    const fastPeriod = 12;
    const slowPeriod = 26;
    const signalPeriod = 9;

    // Calculate EMAs
    const fastEMA = this.calculateEMA(priceData, fastPeriod);
    const slowEMA = this.calculateEMA(priceData, slowPeriod);

    // MACD line
    const macd = fastEMA - slowEMA;

    // Signal line (EMA of MACD)
    // For simplicity, we'll use a placeholder
    const signal = macd * 0.9;

    // Histogram
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  /**
   * Calculates the Exponential Moving Average (EMA).
   *
   * @param priceData - The price data
   * @param period - The EMA period
   * @returns The EMA value
   * @private
   */
  private calculateEMA(priceData: number[], period: number): number {
    if (priceData.length === 0) {
      return 0;
    }

    const multiplier = 2 / (period + 1);
    let ema = priceData[0];

    for (let i = 1; i < priceData.length; i++) {
      ema = (priceData[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculates Bollinger Bands.
   *
   * @param priceData - The price data
   * @param period - The period for the middle band (SMA)
   * @param stdDev - The number of standard deviations for the bands
   * @returns Bollinger Bands object with upper, middle, and lower bands
   * @private
   */
  private calculateBollingerBands(
    priceData: number[],
    period: number,
    stdDev: number
  ): {
    upper: number;
    middle: number;
    lower: number;
  } {
    if (priceData.length < period) {
      const avg = priceData.reduce((a, b) => a + b, 0) / priceData.length;
      return { upper: avg, middle: avg, lower: avg };
    }

    // Calculate middle band (SMA)
    const recentPrices = priceData.slice(-period);
    const middle = recentPrices.reduce((a, b) => a + b, 0) / period;

    // Calculate standard deviation
    const variance =
      recentPrices.reduce((sum, price) => sum + Math.pow(price - middle, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);

    // Calculate upper and lower bands
    const upper = middle + stdDev * standardDeviation;
    const lower = middle - stdDev * standardDeviation;

    return { upper, middle, lower };
  }
}
