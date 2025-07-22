import { insertVaultedSignal } from '../persistence/vaultInsert';
import type { VaultedSignal } from '../types/VaultedSignal';

export async function run(input: VaultedSignal) {
  try {
    const result = await insertVaultedSignal(input);
    return {
      status: 'success',
      insertedId: result.insertedId,
    };
  } catch (err) {
    console.error('❌ Vault plugin failed:', err);
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
