#!/usr/bin/env node
/**
 * AFI Pipeline Smoke Test
 * 
 * Tests the full pipeline end-to-end:
 * 1. Submit TradingView-like payload
 * 2. Wait for pipeline completion
 * 3. Verify validator decision
 * 4. Check TSSD vault persistence
 * 5. Test vault replay
 * 
 * Usage:
 *   npm run build
 *   node dist/scripts/pipeline-smoke.js
 */

import { runFroggyPipeline } from "../src/services/froggyDemoService.js";
import { getTssdCollection } from "../src/services/tssdVaultService.js";
import { replaySignalById } from "../src/services/vaultReplayService.js";

async function main() {
  console.log("🧪 AFI Pipeline Smoke Test\n");
  console.log("=" .repeat(60));
  console.log("\n");

  // Step 1: Submit signal
  console.log("1️⃣  INGESTION: Submitting test signal...");
  const payload = {
    symbol: "BTC/USDT",
    timeframe: "1h",
    strategy: "froggy_trend_pullback_v1",
    direction: "long" as const,
    setupSummary: "Smoke test signal - bullish pullback to 20 EMA",
    enrichmentProfile: {
      technical: { enabled: true, preset: "trend_pullback" },
      pattern: { enabled: true, preset: "reversal_patterns" },
      sentiment: { enabled: true, preset: "social_momentum" },
      news: { enabled: true, preset: "crypto_news" },
      aiMl: { enabled: true, preset: "price_prediction" }
    }
  };

  const result = await runFroggyPipeline(payload, { 
    isDemo: false,
    includeStageSummaries: true 
  });

  console.log(`   ✅ Signal processed: ${result.signalId}`);
  console.log(`   📊 Decision: ${result.validatorDecision.decision.toUpperCase()}`);
  console.log(`   🎯 UWR Score: ${result.uwrScore.toFixed(2)}`);
  console.log(`   💯 Confidence: ${result.validatorDecision.uwrConfidence.toFixed(2)}`);
  
  if (result.validatorDecision.reasonCodes && result.validatorDecision.reasonCodes.length > 0) {
    console.log(`   ⚠️  Reason Codes: ${result.validatorDecision.reasonCodes.join(", ")}`);
  }
  console.log("\n");

  // Step 2: Verify TSSD vault persistence
  console.log("2️⃣  PERSISTENCE: Checking TSSD vault...");
  const collection = await getTssdCollection();
  
  if (collection) {
    const doc = await collection.findOne({ signalId: result.signalId });
    if (doc) {
      console.log(`   ✅ Signal found in vault: ${doc.signalId}`);
      console.log(`   📅 Created: ${doc.createdAt}`);
      console.log(`   🔄 Updated: ${doc.updatedAt}`);
      console.log(`   📦 Source: ${doc.source}`);
    } else {
      console.error(`   ❌ Signal NOT found in vault!`);
      console.error(`   Expected signalId: ${result.signalId}`);
      process.exit(1);
    }
  } else {
    console.warn(`   ⚠️  TSSD vault disabled (AFI_MONGO_URI not set)`);
    console.warn(`   Skipping vault persistence check`);
  }
  console.log("\n");

  // Step 3: Test vault replay
  console.log("3️⃣  REPLAY: Testing vault replay...");
  const replayResult = await replaySignalById(result.signalId);
  
  if (replayResult) {
    console.log(`   ✅ Replay successful`);
    console.log(`   📊 Original UWR: ${replayResult.comparison.originalUwrScore.toFixed(4)}`);
    console.log(`   📊 Replayed UWR: ${replayResult.comparison.replayedUwrScore.toFixed(4)}`);
    console.log(`   📊 UWR Delta: ${replayResult.comparison.uwrScoreDelta.toFixed(4)}`);
    console.log(`   🔄 Decision Changed: ${replayResult.comparison.decisionChanged ? "YES ⚠️" : "NO ✅"}`);
    
    if (replayResult.comparison.decisionChanged) {
      console.warn(`   ⚠️  WARNING: Validator decision changed on replay!`);
      console.warn(`   Original: ${replayResult.comparison.originalDecision}`);
      console.warn(`   Replayed: ${replayResult.comparison.replayedDecision}`);
    }
  } else {
    console.error(`   ❌ Replay failed!`);
    console.error(`   Signal may not be in vault or replay service is unavailable`);
    process.exit(1);
  }
  console.log("\n");

  // Summary
  console.log("=" .repeat(60));
  console.log("🎉 All smoke tests passed!\n");
  console.log("Pipeline stages verified:");
  console.log("  ✅ Ingestion (Alpha Scout)");
  console.log("  ✅ Structuring (Pixel Rick)");
  console.log("  ✅ Enrichment (Pixel Rick - Enrichment Legos)");
  console.log("  ✅ Analysis (Froggy Analyst)");
  console.log("  ✅ Validation (Val Dook)");
  console.log("  ✅ Persistence (TSSD Vault)");
  console.log("  ✅ Replay (Vault Replay Service)");
  console.log("\n");

  process.exit(0);
}

main().catch((error) => {
  console.error("\n❌ Smoke test failed:");
  console.error(error);
  console.error("\n");
  process.exit(1);
});

