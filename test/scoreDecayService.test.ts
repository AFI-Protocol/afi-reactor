/**
 * Tests for Score Decay Service
 *
 * Verifies time-decayed score calculations from TSSD vault documents.
 */

import { describe, it, expect } from "@jest/globals";
import { computeDecayedUwrScore } from "../src/services/scoreDecayService.js";
import type { TssdSignalDocument } from "../src/types/TssdSignalDocument.js";

describe("Score Decay Service", () => {
  describe("computeDecayedUwrScore", () => {
    it("should compute decayed score after one half-life", () => {
      const mockDoc: TssdSignalDocument = {
        signalId: "test-signal-001",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        source: "afi-eliza-demo",
        market: {
          symbol: "BTC/USDT",
          timeframe: "1h",
        },
        pipeline: {
          analystScore: {
            analystId: "froggy",
            strategyId: "trend_pullback_v1",
            marketType: "spot",
            assetClass: "crypto",
            instrumentType: "spot",
            baseAsset: "BTC",
            quoteAsset: "USDT",
            signalTimeframe: "1h",
            holdingHorizon: "swing",
            direction: "long",
            riskBucket: "medium",
            conviction: 0.85,
            uwrAxes: {
              structure: 1.0,
              execution: 1.0,
              risk: 1.0,
              insight: 1.0,
            },
            uwrScore: 1.0,
          },
          scoredAt: "2025-01-01T00:00:00.000Z",
          decayParams: {
            halfLifeMinutes: 60,
            greeksTemplateId: "decay-intraday-v1",
          },
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.85,
          },
          execution: {
            status: "simulated",
            timestamp: "2025-01-01T00:00:00.000Z",
          },
        },
        strategy: {
          name: "froggy_trend_pullback_v1",
          direction: "long",
        },
        version: "v0.1",
      };

      const nowIso = "2025-01-01T01:00:00.000Z"; // 60 minutes later
      const decayed = computeDecayedUwrScore(mockDoc, nowIso);

      expect(decayed).not.toBeNull();
      expect(decayed).toBeCloseTo(0.5, 10); // One half-life => score halves
    });

    it("should return null when analystScore is missing", () => {
      const mockDoc: TssdSignalDocument = {
        signalId: "test-signal-002",
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: { symbol: "BTC/USDT", timeframe: "1h" },
        pipeline: {
          scoredAt: "2025-01-01T00:00:00.000Z",
          decayParams: {
            halfLifeMinutes: 60,
            greeksTemplateId: "decay-intraday-v1",
          },
          validatorDecision: { decision: "approve", uwrConfidence: 0.8 },
          execution: { status: "simulated", timestamp: "2025-01-01T00:00:00.000Z" },
        },
        strategy: { name: "test", direction: "long" },
        version: "v0.1",
      };

      const decayed = computeDecayedUwrScore(mockDoc, "2025-01-01T01:00:00.000Z");
      expect(decayed).toBeNull();
    });

    it("should return null when scoredAt is missing", () => {
      const mockDoc: TssdSignalDocument = {
        signalId: "test-signal-003",
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: { symbol: "BTC/USDT", timeframe: "1h" },
        pipeline: {
          analystScore: {
            analystId: "froggy",
            strategyId: "trend_pullback_v1",
            marketType: "spot",
            assetClass: "crypto",
            instrumentType: "spot",
            baseAsset: "BTC",
            quoteAsset: "USDT",
            signalTimeframe: "1h",
            holdingHorizon: "swing",
            direction: "long",
            riskBucket: "medium",
            conviction: 0.85,
            uwrAxes: { structure: 0.8, execution: 0.8, risk: 0.8, insight: 0.8 },
            uwrScore: 0.8,
          },
          decayParams: {
            halfLifeMinutes: 60,
            greeksTemplateId: "decay-intraday-v1",
          },
          validatorDecision: { decision: "approve", uwrConfidence: 0.8 },
          execution: { status: "simulated", timestamp: "2025-01-01T00:00:00.000Z" },
        },
        strategy: { name: "test", direction: "long" },
        version: "v0.1",
      };

      const decayed = computeDecayedUwrScore(mockDoc, "2025-01-01T01:00:00.000Z");
      expect(decayed).toBeNull();
    });

    it("should return null when decayParams is missing", () => {
      const mockDoc: TssdSignalDocument = {
        signalId: "test-signal-004",
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: { symbol: "BTC/USDT", timeframe: "1h" },
        pipeline: {
          analystScore: {
            analystId: "froggy",
            strategyId: "trend_pullback_v1",
            marketType: "spot",
            assetClass: "crypto",
            instrumentType: "spot",
            baseAsset: "BTC",
            quoteAsset: "USDT",
            signalTimeframe: "1h",
            holdingHorizon: "swing",
            direction: "long",
            riskBucket: "medium",
            conviction: 0.85,
            uwrAxes: { structure: 0.8, execution: 0.8, risk: 0.8, insight: 0.8 },
            uwrScore: 0.8,
          },
          scoredAt: "2025-01-01T00:00:00.000Z",
          validatorDecision: { decision: "approve", uwrConfidence: 0.8 },
          execution: { status: "simulated", timestamp: "2025-01-01T00:00:00.000Z" },
        },
        strategy: { name: "test", direction: "long" },
        version: "v0.1",
      };

      const decayed = computeDecayedUwrScore(mockDoc, "2025-01-01T01:00:00.000Z");
      expect(decayed).toBeNull();
    });
  });
});

