export async function getSignal() {
  return {
    signalId: 'mock-signal-' + Date.now(),
    score: Math.random(),
    confidence: 0.85,
    timestamp: new Date(),
    meta: {
      source: 'unit-test',
      strategy: 'mock-trial'
    },
    approvalStatus: 'approved'
  };
}