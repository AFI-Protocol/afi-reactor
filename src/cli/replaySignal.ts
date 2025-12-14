#!/usr/bin/env node
/**
 * Vault Replay CLI Tool (Phase 2)
 * 
 * Command-line tool for replaying signals from the TSSD vault.
 * 
 * Usage:
 *   npm run replay:signal -- --id=<signalId>
 *   node dist/cli/replaySignal.js --id=<signalId>
 * 
 * Environment Variables:
 *   AFI_MONGO_URI - MongoDB connection string (required)
 *   AFI_MONGO_DB_NAME - Database name (default: "afi")
 *   AFI_MONGO_COLLECTION_TSSD - Collection name (default: "tssd_signals")
 * 
 * @module cli/replaySignal
 */

import { replaySignalById } from "../services/vaultReplayService.js";
import { getTssdVaultService } from "../services/tssdVaultService.js";

/**
 * Parse command-line arguments
 */
function parseArgs(): { signalId?: string } {
  const args = process.argv.slice(2);
  const result: { signalId?: string } = {};

  for (const arg of args) {
    if (arg.startsWith("--id=")) {
      result.signalId = arg.substring(5);
    } else if (arg.startsWith("--signalId=")) {
      result.signalId = arg.substring(11);
    }
  }

  return result;
}

/**
 * Pretty-print replay result
 */
function prettyPrintReplayResult(result: any): void {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  VAULT REPLAY RESULT");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");

  console.log("📊 SIGNAL METADATA");
  console.log(`   Signal ID:    ${result.signalId}`);
  console.log(`   Symbol:       ${result.stored.meta.symbol}`);
  console.log(`   Timeframe:    ${result.stored.meta.timeframe}`);
  console.log(`   Strategy:     ${result.stored.meta.strategy}`);
  console.log(`   Direction:    ${result.stored.meta.direction}`);
  console.log(`   Source:       ${result.stored.meta.source}`);
  console.log(`   Created At:   ${new Date(result.stored.meta.createdAt).toISOString()}`);
  console.log("");

  console.log("📈 STORED VALUES (from TSSD vault)");
  console.log(`   UWR Score:    ${(result.stored.analystScore?.uwrScore ?? 0).toFixed(4)}`);
  console.log(`   Decision:     ${result.stored.validatorDecision.decision}`);
  console.log(`   Confidence:   ${result.stored.validatorDecision.uwrConfidence.toFixed(4)}`);
  if (result.stored.validatorDecision.reasonCodes && result.stored.validatorDecision.reasonCodes.length > 0) {
    console.log(`   Reason Codes: [${result.stored.validatorDecision.reasonCodes.join(", ")}]`);
  }
  console.log("");

  console.log("🔄 RECOMPUTED VALUES (from pipeline replay)");
  console.log(`   UWR Score:    ${result.recomputed.uwrScore.toFixed(4)}`);
  console.log(`   Decision:     ${result.recomputed.validatorDecision.decision}`);
  console.log(`   Confidence:   ${result.recomputed.validatorDecision.uwrConfidence.toFixed(4)}`);
  if (result.recomputed.validatorDecision.reasonCodes && result.recomputed.validatorDecision.reasonCodes.length > 0) {
    console.log(`   Reason Codes: [${result.recomputed.validatorDecision.reasonCodes.join(", ")}]`);
  }
  console.log("");

  console.log("🔍 COMPARISON (stored vs recomputed)");
  console.log(`   UWR Score Δ:  ${result.comparison.uwrScoreDelta >= 0 ? "+" : ""}${result.comparison.uwrScoreDelta.toFixed(4)}`);
  console.log(`   Decision Changed: ${result.comparison.decisionChanged ? "YES ⚠️" : "NO ✅"}`);
  console.log("");
  console.log("   Changes:");
  for (const change of result.comparison.changes) {
    console.log(`     • ${change}`);
  }
  console.log("");

  if (result.stored.receiptProvenance) {
    console.log("🧾 RECEIPT PROVENANCE");
    console.log(`   Mint Status:  ${result.stored.receiptProvenance.mintStatus}`);
    if (result.stored.receiptProvenance.epochId !== undefined) {
      console.log(`   Epoch ID:     ${result.stored.receiptProvenance.epochId}`);
    }
    if (result.stored.receiptProvenance.receiptId) {
      console.log(`   Receipt ID:   ${result.stored.receiptProvenance.receiptId}`);
    }
    if (result.stored.receiptProvenance.mintTxHash) {
      console.log(`   Mint Tx Hash: ${result.stored.receiptProvenance.mintTxHash}`);
    }
    console.log("");
  }

  console.log("ℹ️  REPLAY METADATA");
  console.log(`   Ran At:       ${new Date(result.replayMeta.ranAt).toISOString()}`);
  console.log(`   Pipeline Ver: ${result.replayMeta.pipelineVersion}`);
  console.log(`   Notes:        ${result.replayMeta.notes}`);
  console.log("");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  console.log("🔄 AFI Vault Replay CLI (Phase 2)");
  console.log("");

  // Parse arguments
  const { signalId } = parseArgs();

  if (!signalId) {
    console.error("❌ Error: Missing required argument --id=<signalId>");
    console.log("");
    console.log("Usage:");
    console.log("  npm run replay:signal -- --id=<signalId>");
    console.log("  node dist/cli/replaySignal.js --id=<signalId>");
    console.log("");
    process.exit(1);
  }

  // Check MongoDB configuration
  const vaultService = getTssdVaultService();
  if (!vaultService) {
    console.error("❌ Error: TSSD vault not configured");
    console.log("");
    console.log("Please set the following environment variables:");
    console.log("  AFI_MONGO_URI - MongoDB connection string");
    console.log("  AFI_MONGO_DB_NAME - Database name (optional, default: 'afi')");
    console.log("  AFI_MONGO_COLLECTION_TSSD - Collection name (optional, default: 'tssd_signals')");
    console.log("");
    process.exit(1);
  }

  try {
    console.log(`🔍 Fetching signal from TSSD vault: ${signalId}`);
    console.log("");

    const result = await replaySignalById(signalId);

    if (!result) {
      console.error(`❌ Signal not found: ${signalId}`);
      console.log("");
      process.exit(1);
    }

    prettyPrintReplayResult(result);

    // Close vault connection
    await vaultService.close();

    process.exit(0);
  } catch (error: any) {
    console.error(`❌ Replay failed:`, error.message || String(error));
    console.log("");
    process.exit(1);
  }
}

// Run CLI
main();

