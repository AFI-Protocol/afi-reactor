// 🧬 AFI-Reactor DAG plugin (lineage) — metadata only for replay/introspection.
// Used for ancestry across scoring cycles and multi-hop validation tracing; does NOT implement PoI/PoInsight, emissions, or tokenomics.

import { v4 as uuidv4 } from 'uuid';

export async function run(signal: any) {
  if (!signal) throw new Error('Signal is undefined or null.');

  const timestamp = new Date().toISOString();
  const signalId = signal.signalId || uuidv4();

  // Build or extend the lineage array
  const lineageEntry = {
    id: signalId,
    plugin: 'signal-lineager',
    timestamp,
    stage: signal.stage || 'unknown',
  };

  const updatedSignal = {
    ...signal,
    signalId,
    lineage: Array.isArray(signal.lineage)
      ? [...signal.lineage, lineageEntry]
      : [lineageEntry],
  };

  console.log(`🧬 [signal-lineager] Lineage updated for signal: ${signalId}`);
  return updatedSignal;
}
