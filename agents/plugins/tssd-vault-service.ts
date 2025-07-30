import { insertVaultedSignal } from '../persistence/VaultedSignalStore.js';
import type { VaultedSignal } from '../../types/VaultedSignal.js';

export async function storeSignal(signal: VaultedSignal) {
  await insertVaultedSignal(signal);
}
