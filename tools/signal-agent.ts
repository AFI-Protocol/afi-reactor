/**
 * LOCAL DEV TOOL ONLY — checksum sandbox for strategy/agent metadata.
 * Not the canonical AFI signal type or schema. No runtime/protocol/vault usage.
 * Safe to ignore for protocol reasoning; used solely for local experiments.
 */
import crypto from 'crypto';

interface ChecksumSignalStub {
  strategy: string;
  agent: string;
  category: string;
  source: string;
  version: string;
  tags: string[];
  createdBy: string;
  meta: {
    checksum?: string;
    [key: string]: any;
  };
}

/**
 * Generates a unique checksum based on the signal content
 */
function createChecksum(signal: ChecksumSignalStub): string {
  const data = JSON.stringify({
    strategy: signal.strategy,
    agent: signal.agent,
    category: signal.category,
    source: signal.source,
    version: signal.version,
    tags: signal.tags,
    createdBy: signal.createdBy,
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Enriches a signal with a checksum in the meta field
 */
export function enrichSignal(signal: Omit<ChecksumSignalStub, 'meta'>): ChecksumSignalStub {
  const completeSignal: ChecksumSignalStub = {
    ...signal,
    meta: {
      checksum: createChecksum(signal as ChecksumSignalStub),
    },
  };
  return completeSignal;
}

export const generateSignal = enrichSignal;
