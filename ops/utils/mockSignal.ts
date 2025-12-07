import type { ReactorSignalEnvelope } from '../../types/ReactorSignalEnvelope.js';

/**
 * Dev-only helper for pipeline/DAG simulations.
 * NOT a protocol contract and NOT a TSSD/vault record.
 * Shape is a simple ReactorSignalEnvelope for orchestrator simulations.
 */
export async function getMockSignalEnvelope(
  entryNodeId?: string
): Promise<ReactorSignalEnvelope> {
  const now = new Date();
  return {
    signalId: `mock-${now.getTime()}`,
    score: Math.random(),
    timestamp: now,
    meta: {
      source: 'ops-simulator',
      strategy: entryNodeId ? `mock-${entryNodeId}` : 'mock-strategy',
      tags: ['mock', 'demo'],
    },
  };
}
