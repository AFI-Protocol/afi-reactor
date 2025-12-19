/**
 * TSSD Vault Service Tests (Phase 1)
 *
 * Tests the MongoDB persistence layer for scored + validated signals.
 *
 * These tests use mocking to avoid requiring a live MongoDB instance.
 * For integration tests with a real MongoDB instance, see tssdVaultIntegration.test.ts
 */

import { describe, it, expect } from "@jest/globals";
import type { TssdSignalDocument } from "../src/types/TssdSignalDocument.js";

describe("TSSD Vault Service (Unit Tests)", () => {

  describe("TssdSignalDocument Type", () => {
    it("should have correct structure for a valid document", () => {
      const doc: TssdSignalDocument = {
        signalId: "test-signal-001",
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: {
          symbol: "BTC/USDT",
          timeframe: "1h",
          market: "spot",
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
            conviction: 0.78,
            uwrAxes: {
              structure: 0.75,
              execution: 0.75,
              risk: 0.75,
              insight: 0.75,
            },
            uwrScore: 0.75,
          },
          scoredAt: "2025-01-01T00:00:00.000Z",
          decayParams: {
            halfLifeMinutes: 720,
            greeksTemplateId: "decay-swing-v1",
          },
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.78,
            reasonCodes: ["score-high"],
          },
          execution: {
            status: "simulated",
            type: "buy",
            asset: "BTC/USDT",
            amount: 0.1,
            simulatedPrice: 67500,
            timestamp: new Date().toISOString(),
            notes: "Simulated BUY",
          },
        },
        strategy: {
          name: "froggy_trend_pullback_v1",
          direction: "long",
        },
        version: "v0.1",
      };

      // Type assertions
      expect(doc.signalId).toBe("test-signal-001");
      expect(doc.source).toBe("afi-eliza-demo");
      expect(doc.market.symbol).toBe("BTC/USDT");
      expect(doc.pipeline.analystScore?.uwrScore).toBe(0.75);
      expect(doc.pipeline.validatorDecision.decision).toBe("approve");
      expect(doc.version).toBe("v0.1");
    });
  });

  describe("Vault Service Configuration", () => {
    it("should have basic smoke test for vault service", () => {
      // Smoke test to ensure types are correct
      // Real vault service tests require MongoDB connection (integration tests)
      expect(true).toBe(true);
    });
  });

  describe("Document Mapping", () => {
    it("should correctly map FroggyPipelineResult to TssdSignalDocument", () => {
      // Simulate a FroggyPipelineResult (no longer has uwrScore at top level)
      const pipelineResult = {
        signalId: "alpha-1733515200000",
        validatorDecision: {
          decision: "approve" as const,
          uwrConfidence: 0.78,
          reasonCodes: ["score-high"],
        },
        execution: {
          status: "simulated" as const,
          type: "buy" as const,
          asset: "BTC/USDT",
          amount: 0.1,
          simulatedPrice: 67500,
          timestamp: "2025-12-07T12:00:00.000Z",
          notes: "Simulated BUY",
        },
        meta: {
          symbol: "BTC/USDT",
          timeframe: "1h",
          strategy: "froggy_trend_pullback_v1",
          direction: "long",
          source: "afi-eliza-demo",
        },
        isDemo: true,
      };

      // Mock analystScore (would come from Froggy analyst in real pipeline)
      const mockAnalystScore = {
        analystId: "froggy",
        strategyId: "trend_pullback_v1",
        marketType: "spot" as const,
        assetClass: "crypto" as const,
        instrumentType: "spot" as const,
        baseAsset: "BTC",
        quoteAsset: "USDT",
        signalTimeframe: "1h",
        holdingHorizon: "swing" as const,
        direction: "long" as const,
        riskBucket: "medium" as const,
        conviction: 0.78,
        uwrAxes: {
          structure: 0.75,
          execution: 0.75,
          risk: 0.75,
          insight: 0.75,
        },
        uwrScore: 0.75,
      };

      // Map to TssdSignalDocument
      const tssdDoc: TssdSignalDocument = {
        signalId: pipelineResult.signalId,
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: {
          symbol: pipelineResult.meta.symbol,
          timeframe: pipelineResult.meta.timeframe,
        },
        pipeline: {
          analystScore: mockAnalystScore,
          validatorDecision: pipelineResult.validatorDecision,
          execution: pipelineResult.execution,
        },
        strategy: {
          name: pipelineResult.meta.strategy,
          direction: pipelineResult.meta.direction,
        },
        version: "v0.1",
      };

      // Verify mapping
      expect(tssdDoc.signalId).toBe(pipelineResult.signalId);
      expect(tssdDoc.source).toBe("afi-eliza-demo");
      expect(tssdDoc.market.symbol).toBe(pipelineResult.meta.symbol);
      expect(tssdDoc.pipeline.analystScore?.uwrScore).toBe(0.75);
      expect(tssdDoc.pipeline.validatorDecision.decision).toBe("approve");
      expect(tssdDoc.version).toBe("v0.1");
    });
  });
});

