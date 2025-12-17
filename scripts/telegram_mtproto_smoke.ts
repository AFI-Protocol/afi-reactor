/**
 * Telegram MTProto Collector Smoke Test
 * 
 * Validates MTProto collector configuration and CPJ conversion without requiring real Telegram connection.
 * 
 * Usage:
 *   npm run build && node dist/scripts/telegram_mtproto_smoke.js
 * 
 * Or with dry-run mode (no network calls):
 *   DRY_RUN=1 npm run build && node dist/scripts/telegram_mtproto_smoke.js
 */

import { Api } from "telegram";
import { convertMessageToCpj } from "../src/collectors/telegram_mtproto/mtprotoToCpj.js";
import { MtprotoStateManager } from "../src/collectors/telegram_mtproto/mtprotoState.js";

/**
 * Test CPJ conversion with mock message
 */
function testCpjConversion(): void {
  console.log(`\n🧪 Testing CPJ conversion...`);

  // Create a mock Telegram message (Cornix-style signal)
  const mockMessage = {
    id: 12345,
    date: Math.floor(Date.now() / 1000),
    message: `🚀 BTC LONG SIGNAL

Symbol: BTCUSDT
Entry: 42000-42500
Stop Loss: 41500
Take Profit 1: 43000
Take Profit 2: 44000
Leverage: 5x
Timeframe: 4h`,
  } as Api.Message;

  const channelId = "test-channel-123";
  const channelUsername = "test_signals";

  const result = convertMessageToCpj(mockMessage, channelId, channelUsername);

  if (!result.cpj) {
    console.error(`❌ CPJ conversion failed: ${result.reason}`);
    process.exit(1);
  }

  console.log(`✅ CPJ conversion successful`);
  console.log(`   Confidence: ${result.confidence.toFixed(2)}`);
  console.log(`   Symbol: ${result.cpj.extracted.symbolRaw}`);
  console.log(`   Side: ${result.cpj.extracted.side}`);
  console.log(`   Entry: ${JSON.stringify(result.cpj.extracted.entry)}`);
  console.log(`   Stop Loss: ${result.cpj.extracted.stopLoss}`);
  console.log(`   Take Profits: ${result.cpj.extracted.takeProfits?.length || 0}`);

  // Validate CPJ structure
  if (result.cpj.schema !== "afi.cpj.v0.1") {
    console.error(`❌ Invalid CPJ schema: ${result.cpj.schema}`);
    process.exit(1);
  }

  if (result.cpj.provenance.providerType !== "telegram") {
    console.error(`❌ Invalid providerType: ${result.cpj.provenance.providerType}`);
    process.exit(1);
  }

  if (result.cpj.parse.parserId !== "telegram-mtproto-raw") {
    console.error(`❌ Invalid parserId: ${result.cpj.parse.parserId}`);
    process.exit(1);
  }

  console.log(`✅ CPJ structure validation passed`);
}

/**
 * Test state manager
 */
function testStateManager(): void {
  console.log(`\n🧪 Testing state manager...`);

  const statePath = "./.secrets/telegram_mtproto_smoke_test.state.json";
  const stateManager = new MtprotoStateManager(statePath);

  const channelId = "test-channel-123";

  // Initial state should be 0
  const initial = stateManager.getLastMessageId(channelId);
  if (initial !== 0) {
    console.error(`❌ Initial state should be 0, got ${initial}`);
    process.exit(1);
  }

  // Update state
  stateManager.updateLastMessageId(channelId, 100);
  const updated = stateManager.getLastMessageId(channelId);
  if (updated !== 100) {
    console.error(`❌ Updated state should be 100, got ${updated}`);
    process.exit(1);
  }

  // Update with older message (should not change)
  stateManager.updateLastMessageId(channelId, 50);
  const unchanged = stateManager.getLastMessageId(channelId);
  if (unchanged !== 100) {
    console.error(`❌ State should remain 100, got ${unchanged}`);
    process.exit(1);
  }

  // Update with newer message
  stateManager.updateLastMessageId(channelId, 200);
  const newer = stateManager.getLastMessageId(channelId);
  if (newer !== 200) {
    console.error(`❌ State should be 200, got ${newer}`);
    process.exit(1);
  }

  console.log(`✅ State manager tests passed`);

  // Clean up
  stateManager.clear();
}

/**
 * Validate environment variables
 */
function validateEnv(): void {
  console.log(`\n🧪 Validating environment variables...`);

  const required = [
    "AFI_TELEGRAM_MTPROTO_API_ID",
    "AFI_TELEGRAM_MTPROTO_API_HASH",
    "AFI_TELEGRAM_MTPROTO_PHONE",
  ];

  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.warn(`⚠️  Missing environment variables (required for live run):`);
    for (const key of missing) {
      console.warn(`   - ${key}`);
    }
  } else {
    console.log(`✅ All required environment variables present`);
  }

  // Validate optional vars
  const channels = process.env.AFI_TELEGRAM_MTPROTO_CHANNELS;
  if (channels) {
    const channelList = channels.split(",").map((ch) => ch.trim());
    console.log(`✅ Channels configured: ${channelList.join(", ")}`);
  } else {
    console.warn(`⚠️  AFI_TELEGRAM_MTPROTO_CHANNELS not set`);
  }
}

/**
 * Main smoke test
 */
async function main(): Promise<void> {
  console.log(`🚀 Telegram MTProto Collector Smoke Test`);
  console.log(`   Mode: ${process.env.DRY_RUN === "1" ? "DRY RUN" : "VALIDATION"}`);

  testCpjConversion();
  testStateManager();
  validateEnv();

  console.log(`\n✅ All smoke tests passed!`);
  console.log(`\nNext steps:`);
  console.log(`  1. Set required environment variables (see TELEGRAM_MTPROTO_SETUP.md)`);
  console.log(`  2. Run 'npm run dev' to start collector`);
  console.log(`  3. Complete login prompts on first run`);
  console.log(`  4. Monitor logs for incoming messages`);
}

main().catch((error) => {
  console.error(`❌ Smoke test failed:`, error);
  process.exit(1);
});

