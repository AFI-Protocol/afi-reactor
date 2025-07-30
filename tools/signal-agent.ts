import crypto from 'crypto';

interface Signal {
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
function createChecksum(signal: Signal): string {
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
export function enrichSignal(signal: Omit<Signal, 'meta'>): Signal {
  const completeSignal: Signal = {
    ...signal,
    meta: {
      checksum: createChecksum(signal as Signal),
    },
  };
  return completeSignal;
}

// Example usage (can be removed in production)
if (require.main === module) {
  const sampleSignal = enrichSignal({
    strategy: 'scalping',
    agent: 'demo-agent',
    category: 'crypto',
    source: 'simulated',
    version: '1.0.0',
    tags: ['test', 'simulation'],
    createdBy: 'AFI',
  });

  console.log('✅ Sample enriched signal:', sampleSignal);
}export const generateSignal = enrichSignal;
