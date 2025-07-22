import { insertVaultedSignal, closeMongoConnection } from '../agents/persistence/vaultInsert';
import { VaultedSignal } from '../agents/persistence/vaultInsert';

(async () => {
  const mockSignal: VaultedSignal = {
    signalId: 'mock-signal-001',
    timestamp: new Date(),
    score: 0.8472,
    meta: {
      source: 'test-runner',
      validatedBy: ['agent-x', 'agent-y'],
      notes: 'This is a test signal for vault insertion.'
    }
  };

  try {
    console.log('🚀 Inserting mock signal into MongoDB...');
    const result = await insertVaultedSignal(mockSignal);
    console.log('🧪 Insert successful:', result);

  } catch (err) {
    console.error('💥 Insert test failed:', err);
  } finally {
    await closeMongoConnection();
  }
})();