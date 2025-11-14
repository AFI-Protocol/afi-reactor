import { VaultService } from '../../src/core/VaultService.js';
import process from 'process';

// Parse command line arguments
const args = process.argv.slice(2);
const limitIndex = args.indexOf('--limit');
const stageIndex = args.indexOf('--stage');

const limit = limitIndex !== -1 && args[limitIndex + 1] ? parseInt(args[limitIndex + 1]) : undefined;
const stage = stageIndex !== -1 && args[stageIndex + 1] ? args[stageIndex + 1] : undefined;

console.log(`[replay-vault] 🚀 Starting vault replay...`);
console.log(`[replay-vault] 📊 Filters: stage=${stage || 'all'}, limit=${limit || 'none'}`);

try {
  // Query vault with filters
  const signals = VaultService.queryVault({ stage, limit });
  
  if (signals.length === 0) {
    console.log(`[replay-vault] ⚠️ No signals found matching criteria`);
    process.exit(0);
  }

  console.log(`[replay-vault] 📋 Found ${signals.length} signals to replay`);

  // Replay each signal
  let successCount = 0;
  let errorCount = 0;

  for (const signal of signals) {
    try {
      VaultService.replaySignal(signal);
      successCount++;
    } catch (err) {
      console.error(`[replay-vault] ❌ Error replaying ${signal.signalId}:`, err);
      errorCount++;
    }
  }

  // Summary
  console.log(`[replay-vault] 📊 Replay Summary:`);
  console.log(`[replay-vault]   ✅ Successful: ${successCount}`);
  console.log(`[replay-vault]   ❌ Errors: ${errorCount}`);
  console.log(`[replay-vault]   📈 Total: ${signals.length}`);
  console.log(`[replay-vault] ✅ Completed replay of ${successCount} vaulted signals`);

} catch (err) {
  console.error(`[replay-vault] 💥 Fatal error during vault replay:`, err);
  process.exit(1);
}