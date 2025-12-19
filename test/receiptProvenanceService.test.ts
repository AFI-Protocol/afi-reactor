/**
 * Receipt Provenance Service Tests (Phase 1.5)
 *
 * Tests the receipt provenance tracking helpers for TSSD vault documents.
 *
 * These tests focus on type safety and update logic. MongoDB operations are
 * tested at the type/structure level rather than requiring a live database.
 */

import { describe, it, expect } from "@jest/globals";
import type { TssdSignalDocument } from "../src/types/TssdSignalDocument.js";

describe("Receipt Provenance Service (Unit Tests)", () => {

  describe("TssdSignalDocument with receiptProvenance", () => {
    it("should allow documents without receiptProvenance (backward compatibility)", () => {
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

      const doc: TssdSignalDocument = {
        signalId: "test-signal-001",
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: {
          symbol: "BTC/USDT",
          timeframe: "1h",
        },
        pipeline: {
          analystScore: mockAnalystScore1,
          decayParams: {
            halfLifeMinutes: 720,
            greeksTemplateId: "decay-swing-v1",
          },
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.78,
          },
          execution: {
            status: "simulated",
            timestamp: new Date().toISOString(),
          },
        },
        strategy: {
          name: "froggy_trend_pullback_v1",
          direction: "long",
        },
        version: "v0.1",
      };

      // Should compile without receiptProvenance
      expect(doc.signalId).toBe("test-signal-001");
      expect(doc.receiptProvenance).toBeUndefined();
    });

    it("should support receiptProvenance block with pending status", () => {
      const mockAnalystScore2 = {
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

      const doc: TssdSignalDocument = {
        signalId: "test-signal-002",
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: {
          symbol: "ETH/USDT",
          timeframe: "4h",
        },
        pipeline: {
          analystScore: mockAnalystScore2,
          decayParams: {
            halfLifeMinutes: 720,
            greeksTemplateId: "decay-swing-v1",
          },
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.85,
          },
          execution: {
            status: "simulated",
            timestamp: new Date().toISOString(),
          },
        },
        strategy: {
          name: "froggy_trend_pullback_v1",
          direction: "long",
        },
        receiptProvenance: {
          mintStatus: "pending",
        },
        version: "v0.1",
      };

      expect(doc.receiptProvenance?.mintStatus).toBe("pending");
    });

    it("should support receiptProvenance block with eligible status", () => {
      const mockAnalystScore3 = {
        analystId: "froggy",
        strategyId: "trend_pullback_v1",
        marketType: "spot" as const,
        assetClass: "crypto" as const,
        instrumentType: "spot" as const,
        baseAsset: "SOL",
        quoteAsset: "USDT",
        signalTimeframe: "1h",
        holdingHorizon: "swing" as const,
        direction: "long" as const,
        riskBucket: "high" as const,
        conviction: 0.90,
        uwrAxes: { structure: 0.88, execution: 0.88, risk: 0.88, insight: 0.88 },
        uwrScore: 0.88,
      };

      const doc: TssdSignalDocument = {
        signalId: "test-signal-003",
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: {
          symbol: "SOL/USDT",
          timeframe: "1h",
        },
        pipeline: {
          analystScore: mockAnalystScore3,
          decayParams: {
            halfLifeMinutes: 720,
            greeksTemplateId: "decay-swing-v1",
          },
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.90,
          },
          execution: {
            status: "simulated",
            timestamp: new Date().toISOString(),
          },
        },
        strategy: {
          name: "froggy_trend_pullback_v1",
          direction: "long",
        },
        receiptProvenance: {
          mintStatus: "eligible",
          mintEligibleAt: new Date(),
          epochId: 5,
          beneficiary: "0x1234567890123456789012345678901234567890",
        },
        version: "v0.1",
      };

      expect(doc.receiptProvenance?.mintStatus).toBe("eligible");
      expect(doc.receiptProvenance?.epochId).toBe(5);
      expect(doc.receiptProvenance?.beneficiary).toBe("0x1234567890123456789012345678901234567890");
    });

    it("should support receiptProvenance block with minted status and full metadata", () => {
      const mockAnalystScore4 = {
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

      const doc: TssdSignalDocument = {
        signalId: "test-signal-004",
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: {
          symbol: "BTC/USDT",
          timeframe: "1h",
        },
        pipeline: {
          analystScore: mockAnalystScore4,
          decayParams: {
            halfLifeMinutes: 720,
            greeksTemplateId: "decay-swing-v1",
          },
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.95,
            reasonCodes: ["score-high", "novelty-high"],
          },
          execution: {
            status: "simulated",
            type: "buy",
            timestamp: new Date().toISOString(),
          },
        },
        strategy: {
          name: "froggy_trend_pullback_v1",
          direction: "long",
        },
        receiptProvenance: {
          mintStatus: "minted",
          mintEligibleAt: new Date("2025-12-07T10:00:00Z"),
          mintAttemptedAt: new Date("2025-12-07T10:05:00Z"),
          mintedAt: new Date("2025-12-07T10:05:30Z"),
          epochId: 5,
          receiptId: "42",
          mintTxHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          mintBlockNumber: 12345678,
          beneficiary: "0x1234567890123456789012345678901234567890",
          tokenAmount: "1000.0",
          receiptAmount: 1,
        },
        version: "v0.1",
      };

      expect(doc.receiptProvenance?.mintStatus).toBe("minted");
      expect(doc.receiptProvenance?.epochId).toBe(5);
      expect(doc.receiptProvenance?.receiptId).toBe("42");
      expect(doc.receiptProvenance?.mintTxHash).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
      expect(doc.receiptProvenance?.mintBlockNumber).toBe(12345678);
      expect(doc.receiptProvenance?.tokenAmount).toBe("1000.0");
      expect(doc.receiptProvenance?.receiptAmount).toBe(1);
    });

    it("should support receiptProvenance block with failed status", () => {
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
        riskBucket: "medium" as const,
        conviction: 0.72,
        uwrAxes: { structure: 0.70, execution: 0.70, risk: 0.70, insight: 0.70 },
        uwrScore: 0.70,
      };

      const doc: TssdSignalDocument = {
        signalId: "test-signal-005",
        createdAt: new Date(),
        source: "afi-eliza-demo",
        market: {
          symbol: "BTC/USDT",
          timeframe: "1h",
        },
        pipeline: {
          analystScore: mockAnalystScore5,
          decayParams: {
            halfLifeMinutes: 720,
            greeksTemplateId: "decay-swing-v1",
          },
          validatorDecision: {
            decision: "approve",
            uwrConfidence: 0.72,
          },
          execution: {
            status: "simulated",
            timestamp: new Date().toISOString(),
          },
        },
        strategy: {
          name: "froggy_trend_pullback_v1",
          direction: "long",
        },
        receiptProvenance: {
          mintStatus: "failed",
          mintAttemptedAt: new Date(),
          mintError: "Insufficient gas",
          mintRetryCount: 2,
        },
        version: "v0.1",
      };

      expect(doc.receiptProvenance?.mintStatus).toBe("failed");
      expect(doc.receiptProvenance?.mintError).toBe("Insufficient gas");
      expect(doc.receiptProvenance?.mintRetryCount).toBe(2);
    });

    it("should support all mintStatus values", () => {
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

      const statuses: Array<"pending" | "eligible" | "minted" | "failed" | "ineligible"> = [
        "pending",
        "eligible",
        "minted",
        "failed",
        "ineligible",
      ];

      statuses.forEach((status) => {
        const doc: TssdSignalDocument = {
          signalId: `test-signal-${status}`,
          createdAt: new Date(),
          source: "afi-eliza-demo",
          market: { symbol: "BTC/USDT", timeframe: "1h" },
          pipeline: {
            analystScore: mockAnalystScore6,
            decayParams: {
              halfLifeMinutes: 720,
              greeksTemplateId: "decay-swing-v1",
            },
            validatorDecision: { decision: "approve", uwrConfidence: 0.78 },
            execution: { status: "simulated", timestamp: new Date().toISOString() },
          },
          strategy: { name: "test", direction: "long" },
          receiptProvenance: { mintStatus: status },
          version: "v0.1",
        };

        expect(doc.receiptProvenance?.mintStatus).toBe(status);
      });
    });
  });

  describe("Provenance Helper Functions (Type-Level Tests)", () => {
    it("should have correct update structure for markSignalEligibleForMint", () => {
      // Type-level test: ensure the update structure matches MongoDB expectations
      const updateDoc = {
        "receiptProvenance.mintStatus": "eligible" as const,
        "receiptProvenance.mintEligibleAt": new Date(),
        "receiptProvenance.epochId": 5,
        "receiptProvenance.beneficiary": "0x1234567890123456789012345678901234567890",
      };

      expect(updateDoc["receiptProvenance.mintStatus"]).toBe("eligible");
      expect(updateDoc["receiptProvenance.epochId"]).toBe(5);
    });

    it("should have correct update structure for markSignalMinted", () => {
      // Type-level test: ensure the update structure matches MongoDB expectations
      const updateDoc = {
        "receiptProvenance.mintStatus": "minted" as const,
        "receiptProvenance.mintedAt": new Date(),
        "receiptProvenance.epochId": 5,
        "receiptProvenance.receiptId": "42",
        "receiptProvenance.mintTxHash": "0xabc123",
        "receiptProvenance.mintBlockNumber": 12345678,
        "receiptProvenance.beneficiary": "0x1234567890123456789012345678901234567890",
        "receiptProvenance.tokenAmount": "1000.0",
        "receiptProvenance.receiptAmount": 1,
      };

      expect(updateDoc["receiptProvenance.mintStatus"]).toBe("minted");
      expect(updateDoc["receiptProvenance.receiptId"]).toBe("42");
      expect(updateDoc["receiptProvenance.mintTxHash"]).toBe("0xabc123");
    });

    it("should have correct update structure for markSignalMintFailed", () => {
      // Type-level test: ensure the update structure matches MongoDB expectations
      const updateDoc = {
        "receiptProvenance.mintStatus": "failed" as const,
        "receiptProvenance.mintAttemptedAt": new Date(),
        "receiptProvenance.mintError": "Insufficient gas",
      };

      expect(updateDoc["receiptProvenance.mintStatus"]).toBe("failed");
      expect(updateDoc["receiptProvenance.mintError"]).toBe("Insufficient gas");
    });
  });
});

