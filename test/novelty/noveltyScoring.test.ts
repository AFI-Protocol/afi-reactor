/**
 * Novelty Scoring Tests (Phase: Real Novelty + Replay Canonical)
 *
 * ⚠️ GATED: Novelty scoring is part of validator plugin world (not Reactor scoring runtime).
 * This test is deferred for the scored-only milestone.
 * Set NOVELTY_TESTS_ENABLED=true to run these tests.
 *
 * TODO: Update novelty tests to work with ReactorScoredSignalDocument instead of TssdSignalDocument.
 * TODO: Remove dependency on validator-decision-evaluator plugin.
 *
 * Test Coverage:
 * - Empty cohort (breakthrough novelty)
 * - Redundant signal (near-duplicate baseline)
 * - Canonical novelty comparison (excludes computedAt)
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { MongoClient, Db, Collection } from "mongodb";
import type { PipelineContext } from "../../src/services/pipelineRunner.js";

const NOVELTY_TESTS_ENABLED = process.env.NOVELTY_TESTS_ENABLED === "true";

// MongoDB test setup
let mongoClient: MongoClient | null = null;
let testDb: Db | null = null;
let testCollection: Collection<any> | null = null; // TODO: Update to ReactorScoredSignalDocument

const TEST_MONGO_URI = process.env.AFI_MONGO_URI || "mongodb://localhost:27017";
const TEST_DB_NAME = "afi_test_novelty";
const TEST_COLLECTION_NAME = "tssd_signals";

beforeAll(async () => {
  if (!NOVELTY_TESTS_ENABLED) {
    console.warn("⚠️  Novelty tests SKIPPED (set NOVELTY_TESTS_ENABLED=true to run)");
    return;
  }

  // Set environment variables for TSSD vault service to use test database
  process.env.AFI_MONGO_URI = TEST_MONGO_URI;
  process.env.AFI_MONGO_DB_NAME = TEST_DB_NAME;
  process.env.AFI_MONGO_COLLECTION_TSSD = TEST_COLLECTION_NAME;

  // Connect to MongoDB for testing
  try {
    mongoClient = new MongoClient(TEST_MONGO_URI);
    await mongoClient.connect();
    testDb = mongoClient.db(TEST_DB_NAME);
    testCollection = testDb.collection<any>(TEST_COLLECTION_NAME);

    // Clean up any existing test data
    await testCollection.deleteMany({});

    console.info(`✅ Connected to MongoDB test database: ${TEST_DB_NAME}`);
  } catch (error: any) {
    console.warn(`⚠️  MongoDB not available for novelty tests:`, error.message);
  }
});

afterAll(async () => {
  if (!NOVELTY_TESTS_ENABLED) return;

  // Clean up test data and close connection
  if (testCollection) {
    await testCollection.deleteMany({});
  }
  if (mongoClient) {
    await mongoClient.close();
  }
});

(NOVELTY_TESTS_ENABLED ? describe : describe.skip)("Novelty Scoring (Phase: Real Novelty + Replay Canonical)", () => {
  it("Test A: Empty cohort → breakthrough novelty (score=1.0)", async () => {
    if (!testCollection) {
      console.warn("⚠️  Skipping test: MongoDB not available");
      return;
    }

    // Build test signal with fixed timestamp
    const fixedTimestamp = "2024-01-15T12:00:00.000Z";
    const testSignalId = "test-signal-breakthrough-001";

    const scoredSignal = {
      signalId: testSignalId,
      analysis: {
        analystScore: {
          analystId: "froggy",
          strategyId: "trend_pullback_v1",
          uwrScore: 0.75,
          uwrAxes: {
            structure: 0.8,
            execution: 0.7,
            risk: 0.75,
            insight: 0.7,
          },
        },
        notes: ["Test signal for breakthrough novelty"],
      },
      // Attach context with rawUss for novelty scoring
      _context: {
        rawUss: {
          schema: "afi.usignal.v1.1",
          provenance: {
            source: "test",
            providerId: "test-provider",
            signalId: testSignalId,
            ingestedAt: fixedTimestamp,
            providerRef: "BTCUSDT",
          },
        },
        logger: (msg: string) => console.log(msg),
        env: {},
        isDemo: true,
      } as PipelineContext,
    };

    // Run validator (which will compute novelty)
    const decision = await validatorDecisionEvaluator.run(scoredSignal);

    // Assertions
    expect(decision.novelty).toBeDefined();
    expect(decision.canonicalNovelty).toBeDefined();

    // Empty cohort → breakthrough
    expect(decision.canonicalNovelty?.noveltyClass).toBe("breakthrough");
    expect(decision.canonicalNovelty?.noveltyScore).toBe(1.0);

    // Reason codes should include NOVELTY_BREAKTHROUGH
    expect(decision.reasonCodes).toContain("NOVELTY_BREAKTHROUGH");

    // Decision should be approve (high UWR score + breakthrough novelty)
    expect(decision.decision).toBe("approve");

    // Canonical novelty should NOT include computedAt
    expect((decision.canonicalNovelty as any).computedAt).toBeUndefined();

    // Full novelty SHOULD include computedAt (for observability)
    expect(decision.novelty?.computedAt).toBeDefined();

    console.info(`✅ Test A passed: Empty cohort → breakthrough novelty`);
  });

  it("Test B: Redundant signal (near-duplicate baseline) → flag decision", async () => {
    if (!testCollection) {
      console.warn("⚠️  Skipping test: MongoDB not available");
      return;
    }

    // Step 1: Insert a baseline signal into TSSD vault
    const baselineTimestamp = "2024-01-15T10:00:00.000Z";
    const baselineSignalId = "test-signal-baseline-001";
    const cohortId = "BTCUSDT-1h-trend_pullback_v1";

    const baselineDoc: TssdSignalDocument = {
      signalId: baselineSignalId,
      createdAt: new Date(baselineTimestamp),
      source: "test",
      market: {
        symbol: "BTCUSDT",
        timeframe: "1h",
        market: "spot",
        priceSource: "test",
        venueType: "test",
      },
      strategy: {
        name: "trend_pullback_v1",
        direction: "long",
      },
      noveltyMeta: {
        cohortId,
      },
      pipeline: {
        analystScore: {
          analystId: "froggy",
          strategyId: "trend_pullback_v1",
          uwrScore: 0.75,
          uwrAxes: {
            structure: 0.8,
            execution: 0.7,
            risk: 0.75,
            insight: 0.7,
          },
        },
        scoredAt: baselineTimestamp,
        decayParams: null,
        validatorDecision: {
          decision: "approve",
          uwrConfidence: 0.75,
          reasonCodes: ["score-high"],
        },
        execution: {
          status: "simulated",
          timestamp: baselineTimestamp,
        },
      },
      rawUss: {
        schema: "afi.usignal.v1.1",
        provenance: {
          source: "test",
          providerId: "test-provider",
          signalId: baselineSignalId,
          ingestedAt: baselineTimestamp,
          providerRef: "BTCUSDT",
        },
      },
    };

    await testCollection.insertOne(baselineDoc);

    // Step 2: Create a near-identical signal (redundant)
    const currentTimestamp = "2024-01-15T12:00:00.000Z";
    const currentSignalId = "test-signal-redundant-001";

    const scoredSignal = {
      signalId: currentSignalId,
      analysis: {
        analystScore: {
          analystId: "froggy",
          strategyId: "trend_pullback_v1_long", // Include direction in strategyId
          uwrScore: 0.65, // Below approve threshold (0.7)
          uwrAxes: {
            structure: 0.80, // Exactly identical to baseline for redundancy
            execution: 0.70,
            risk: 0.75,
            insight: 0.70,
          },
        },
        notes: ["Test signal for redundant novelty"],
      },
      // Attach context with rawUss for novelty scoring
      _context: {
        rawUss: {
          schema: "afi.usignal.v1.1",
          provenance: {
            source: "test",
            providerId: "test-provider",
            signalId: currentSignalId,
            ingestedAt: currentTimestamp,
            providerRef: "BTCUSDT",
          },
        },
        logger: (msg: string) => console.log(msg),
        env: {},
        isDemo: true,
      } as PipelineContext,
    };

    // Run validator (which will compute novelty)
    const decision = await validatorDecisionEvaluator.run(scoredSignal);

    // Assertions
    expect(decision.novelty).toBeDefined();
    expect(decision.canonicalNovelty).toBeDefined();

    // Near-duplicate → redundant
    expect(decision.canonicalNovelty?.noveltyClass).toBe("redundant");
    expect(decision.canonicalNovelty?.noveltyScore).toBe(0.0); // Perfect match

    // Reason codes should include NOVELTY_REDUNDANT
    expect(decision.reasonCodes).toContain("NOVELTY_REDUNDANT");

    // Decision should be flag (redundant + uwrConfidence < approveThreshold)
    expect(decision.decision).toBe("flag");
    expect(decision.reasonCodes).toContain("needs-review");

    // Canonical novelty should have cohortId
    expect(decision.canonicalNovelty?.cohortId).toBe(cohortId);

    // Canonical novelty should have referenceSignalIds (sorted)
    expect(decision.canonicalNovelty?.referenceSignalIds).toBeDefined();
    expect(decision.canonicalNovelty?.referenceSignalIds?.length).toBeGreaterThan(0);
    expect(decision.canonicalNovelty?.referenceSignalIds).toContain(baselineSignalId);

    console.info(`✅ Test B passed: Redundant signal → flag decision`);

    // Clean up baseline signal
    await testCollection.deleteOne({ signalId: baselineSignalId });
  });
});

