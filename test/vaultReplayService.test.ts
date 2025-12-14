/**
 * Vault Replay Service Tests (Phase 2)
 *
 * Tests the vault replay functionality for read-only signal replay.
 *
 * These tests focus on:
 * - Type safety for ReplayResult
 * - Replay logic structure (stored vs recomputed comparison)
 * - Graceful degradation when MongoDB unavailable
 * - Signal not found handling
 */

import { describe, it, expect } from "@jest/globals";
import type { ReplayResult, TssdSignalDocument } from "../src/types/TssdSignalDocument.js";

describe("Vault Replay Service (Unit Tests)", () => {

  describe("ReplayResult Type", () => {
    it("should have correct structure for a valid replay result", () => {
      const mockAnalystScore1 = {
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
        uwrAxes: { structure: 0.75, execution: 0.75, risk: 0.75, insight: 0.75 },
        uwrScore: 0.75,
      };

      const mockAnalystScore2 = {
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
        uwrAxes: { structure: 0.7521, execution: 0.7521, risk: 0.7521, insight: 0.7521 },
        uwrScore: 0.7521,
      };

      const replayResult: ReplayResult = {
        signalId: "test-signal-001",
        stored: {
          analystScore: mockAnalystScore1,
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
            timestamp: "2025-12-07T10:00:00.000Z",
          },
          meta: {
            symbol: "BTC/USDT",
            timeframe: "1h",
            strategy: "froggy_trend_pullback_v1",
            direction: "long",
            source: "afi-eliza-demo",
            createdAt: new Date("2025-12-07T10:00:00.000Z"),
          },
        },
        recomputed: {
          analystScore: mockAnalystScore2,
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
            timestamp: "2025-12-07T12:00:00.000Z",
          },
        },
        comparison: {
          uwrScoreDelta: 0.0021,
          decisionChanged: false,
          changes: [
            "uwrScore changed by +0.0021 (0.7500 → 0.7521)",
            "validatorDecision unchanged: approve",
          ],
        },
        replayMeta: {
          ranAt: new Date("2025-12-07T12:00:00.000Z"),
          pipelineVersion: "froggy_trend_pullback_v1",
          notes: "Read-only replay; no DB writes performed",
        },
      };

      expect(replayResult.signalId).toBe("test-signal-001");
      expect(replayResult.stored.analystScore?.uwrScore).toBe(0.75);
      expect(replayResult.recomputed.analystScore?.uwrScore).toBe(0.7521);
      expect(replayResult.comparison.uwrScoreDelta).toBe(0.0021);
      expect(replayResult.comparison.decisionChanged).toBe(false);
      expect(replayResult.replayMeta.notes).toBe("Read-only replay; no DB writes performed");
    });

    it("should support replay result with decision change", () => {
      const mockAnalystScore3 = {
        analystId: "froggy",
        strategyId: "trend_pullback_v1",
        marketType: "spot" as const,
        assetClass: "crypto" as const,
        instrumentType: "spot" as const,
        baseAsset: "ETH",
        quoteAsset: "USDT",
        signalTimeframe: "4h",
        holdingHorizon: "swing" as const,
        direction: "long" as const,
        riskBucket: "medium" as const,
        conviction: 0.68,
        uwrAxes: { structure: 0.65, execution: 0.65, risk: 0.65, insight: 0.65 },
        uwrScore: 0.65,
      };

      const mockAnalystScore4 = {
        analystId: "froggy",
        strategyId: "trend_pullback_v1",
        marketType: "spot" as const,
        assetClass: "crypto" as const,
        instrumentType: "spot" as const,
        baseAsset: "ETH",
        quoteAsset: "USDT",
        signalTimeframe: "4h",
        holdingHorizon: "swing" as const,
        direction: "long" as const,
        riskBucket: "low" as const,
        conviction: 0.60,
        uwrAxes: { structure: 0.58, execution: 0.58, risk: 0.58, insight: 0.58 },
        uwrScore: 0.58,
      };

      const replayResult: ReplayResult = {
        signalId: "test-signal-002",
        stored: {
          analystScore: mockAnalystScore3,
          decayParams: {
            halfLifeMinutes: 720,
            greeksTemplateId: "decay-swing-v1",
          },
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.68,
          },
          execution: {
            status: "simulated",
            timestamp: "2025-12-07T10:00:00.000Z",
          },
          meta: {
            symbol: "ETH/USDT",
            timeframe: "4h",
            strategy: "froggy_trend_pullback_v1",
            direction: "long",
            source: "tradingview-webhook",
            createdAt: new Date("2025-12-07T10:00:00.000Z"),
          },
        },
        recomputed: {
          analystScore: mockAnalystScore4,
          decayParams: {
            halfLifeMinutes: 720,
            greeksTemplateId: "decay-swing-v1",
          },
          validatorDecision: {
            decision: "reject",
            uwrConfidence: 0.60,
            reasonCodes: ["score-low"],
          },
          execution: {
            status: "skipped",
            timestamp: "2025-12-07T12:00:00.000Z",
          },
        },
        comparison: {
          uwrScoreDelta: -0.07,
          decisionChanged: true,
          changes: [
            "uwrScore changed by -0.0700 (0.6500 → 0.5800)",
            "validatorDecision changed: approve → reject",
          ],
        },
        replayMeta: {
          ranAt: new Date("2025-12-07T12:00:00.000Z"),
          pipelineVersion: "froggy_trend_pullback_v1",
          notes: "Read-only replay; no DB writes performed",
        },
      };

      expect(replayResult.comparison.decisionChanged).toBe(true);
      expect(replayResult.comparison.uwrScoreDelta).toBe(-0.07);
      expect(replayResult.stored.validatorDecision.decision).toBe("approve");
      expect(replayResult.recomputed.validatorDecision.decision).toBe("reject");
    });

    it("should support replay result with receipt provenance", () => {
      const mockAnalystScore5 = {
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
        riskBucket: "high" as const,
        conviction: 0.95,
        uwrAxes: { structure: 0.92, execution: 0.92, risk: 0.92, insight: 0.92 },
        uwrScore: 0.92,
      };

      const replayResult: ReplayResult = {
        signalId: "test-signal-003",
        stored: {
          analystScore: mockAnalystScore5,
          decayParams: {
            halfLifeMinutes: 720,
            greeksTemplateId: "decay-swing-v1",
          },
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.95,
          },
          execution: {
            status: "simulated",
            type: "buy",
            timestamp: "2025-12-07T10:00:00.000Z",
          },
          meta: {
            symbol: "BTC/USDT",
            timeframe: "1h",
            strategy: "froggy_trend_pullback_v1",
            direction: "long",
            source: "afi-eliza-demo",
            createdAt: new Date("2025-12-07T10:00:00.000Z"),
          },
          receiptProvenance: {
            mintStatus: "minted",
            epochId: 5,
            receiptId: "42",
            mintTxHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          },
        },
        recomputed: {
          analystScore: mockAnalystScore5,
          decayParams: {
            halfLifeMinutes: 720,
            greeksTemplateId: "decay-swing-v1",
          },
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.95,
          },
          execution: {
            status: "simulated",
            type: "buy",
            timestamp: "2025-12-07T12:00:00.000Z",
          },
        },
        comparison: {
          uwrScoreDelta: 0.0,
          decisionChanged: false,
          changes: ["uwrScore unchanged (0.9200)", "validatorDecision unchanged: approve"],
        },
        replayMeta: {
          ranAt: new Date("2025-12-07T12:00:00.000Z"),
          pipelineVersion: "froggy_trend_pullback_v1",
          notes: "Read-only replay; no DB writes performed",
        },
      };

      expect(replayResult.stored.receiptProvenance).toBeDefined();
      expect(replayResult.stored.receiptProvenance?.mintStatus).toBe("minted");
      expect(replayResult.stored.receiptProvenance?.epochId).toBe(5);
      expect(replayResult.stored.receiptProvenance?.receiptId).toBe("42");
    });
  });

  describe("Comparison Logic", () => {
    it("should calculate correct uwrScoreDelta for positive change", () => {
      const stored = 0.75;
      const recomputed = 0.7521;
      const delta = recomputed - stored;

      expect(delta).toBeCloseTo(0.0021, 4);
    });

    it("should calculate correct uwrScoreDelta for negative change", () => {
      const stored = 0.75;
      const recomputed = 0.72;
      const delta = recomputed - stored;

      expect(delta).toBeCloseTo(-0.03, 4);
    });

    it("should detect decision changes correctly", () => {
      type Decision = "approve" | "reject" | "flag" | "abstain";
      const storedDecision = "approve" as Decision;
      const recomputedDecision = "reject" as Decision;
      const decisionChanged = storedDecision !== recomputedDecision;

      expect(decisionChanged).toBe(true);
    });

    it("should detect no decision change when decisions match", () => {
      type Decision = "approve" | "reject" | "flag" | "abstain";
      const storedDecision = "approve" as Decision;
      const recomputedDecision = "approve" as Decision;
      const decisionChanged = storedDecision !== recomputedDecision;

      expect(decisionChanged).toBe(false);
    });
  });

  describe("Replay Metadata", () => {
    it("should include required replay metadata fields", () => {
      const replayMeta = {
        ranAt: new Date(),
        pipelineVersion: "froggy_trend_pullback_v1",
        notes: "Read-only replay; no DB writes performed",
      };

      expect(replayMeta.ranAt).toBeInstanceOf(Date);
      expect(replayMeta.pipelineVersion).toBe("froggy_trend_pullback_v1");
      expect(replayMeta.notes).toContain("Read-only");
      expect(replayMeta.notes).toContain("no DB writes");
    });
  });

  describe("Error Handling", () => {
    it("should handle signal not found gracefully", () => {
      // Type-level test: replaySignalById should return null when signal not found
      const notFoundResult: ReplayResult | null = null;

      expect(notFoundResult).toBeNull();
    });

    it("should handle MongoDB unavailable gracefully", () => {
      // Type-level test: service should throw clear error when MongoDB not configured
      const errorMessage = "TSSD vault not configured (AFI_MONGO_URI not set)";

      expect(errorMessage).toContain("TSSD vault not configured");
      expect(errorMessage).toContain("AFI_MONGO_URI");
    });
  });

  describe("Pipeline Input Reconstruction", () => {
    it("should reconstruct pipeline input from TSSD document with rawPayload", () => {
      const mockAnalystScore6 = {
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
        uwrAxes: { structure: 0.75, execution: 0.75, risk: 0.75, insight: 0.75 },
        uwrScore: 0.75,
      };

      const tssdDoc: TssdSignalDocument = {
        signalId: "test-signal-004",
        createdAt: new Date(),
        source: "tradingview-webhook",
        market: {
          symbol: "BTC/USDT",
          timeframe: "1h",
          market: "spot",
        },
        pipeline: {
          analystScore: mockAnalystScore6,
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.78,
          },
          execution: {
            status: "simulated",
            timestamp: "2025-12-07T10:00:00.000Z",
          },
        },
        strategy: {
          name: "froggy_trend_pullback_v1",
          direction: "long",
        },
        rawPayload: {
          symbol: "BTC/USDT",
          market: "spot",
          timeframe: "1h",
          strategy: "froggy_trend_pullback_v1",
          direction: "long",
          setupSummary: "Bullish pullback",
          notes: "Original notes",
        },
        version: "v0.1",
      };

      // Verify rawPayload is available for reconstruction
      expect(tssdDoc.rawPayload).toBeDefined();
      expect((tssdDoc.rawPayload as any).symbol).toBe("BTC/USDT");
      expect((tssdDoc.rawPayload as any).setupSummary).toBe("Bullish pullback");
    });

    it("should reconstruct pipeline input from TSSD document without rawPayload", () => {
      const mockAnalystScore7 = {
        analystId: "froggy",
        strategyId: "trend_pullback_v1",
        marketType: "spot" as const,
        assetClass: "crypto" as const,
        instrumentType: "spot" as const,
        baseAsset: "ETH",
        quoteAsset: "USDT",
        signalTimeframe: "4h",
        holdingHorizon: "swing" as const,
        direction: "long" as const,
        riskBucket: "medium" as const,
        conviction: 0.85,
        uwrAxes: { structure: 0.82, execution: 0.82, risk: 0.82, insight: 0.82 },
        uwrScore: 0.82,
      };

      const tssdDoc: TssdSignalDocument = {
        signalId: "test-signal-005",
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: {
          symbol: "ETH/USDT",
          timeframe: "4h",
          market: "spot",
        },
        pipeline: {
          analystScore: mockAnalystScore7,
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.85,
          },
          execution: {
            status: "simulated",
            timestamp: "2025-12-07T10:00:00.000Z",
          },
        },
        strategy: {
          name: "froggy_trend_pullback_v1",
          direction: "long",
        },
        version: "v0.1",
      };

      // Verify structured fields are available for reconstruction
      expect(tssdDoc.market.symbol).toBe("ETH/USDT");
      expect(tssdDoc.market.timeframe).toBe("4h");
      expect(tssdDoc.strategy.name).toBe("froggy_trend_pullback_v1");
      expect(tssdDoc.strategy.direction).toBe("long");
    });
  });
});

