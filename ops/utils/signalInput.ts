export async function getSignal(): Promise<any> {
  return {
    signalId: 'mock-signal-001',
    score: 0.85,
    confidence: 0.92,
    timestamp: new Date(),
    meta: {
      source: 'mock-source',
      strategy: 'backtest'
    },
    approvalStatus: 'approved'
  };
}