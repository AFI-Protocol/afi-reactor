import { VaultedSignal } from '../types/VaultedSignal.js';

export function run(signal: VaultedSignal) {
  return { classified: true, signalId: signal.signalId };
}
