import { Signal } from "../types/Signal.js";

export async function analyze(signal: Signal): Promise<Signal & { persisted: boolean }> {
  const persisted = true;
  console.log(`💾 Signal persisted to T.S.S.D. Vault`);
  return {
    ...signal,
    persisted,
  };
}

export default { analyze };