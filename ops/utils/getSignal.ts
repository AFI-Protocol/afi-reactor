export async function getSignal(entryNodeId: string): Promise<any> {
  console.log(`🧬 Generating mock signal for entry node: ${entryNodeId}`);

  return {
    signalId: `mock-${Date.now()}`,
    score: Math.random(),
    confidence: 0.9,
    timestamp: new Date(),
    meta: {
      source: 'test-agent',
      strategy: 'mock-strategy',
      tags: ['mock', 'demo']
    },
    approvalStatus: 'approved',
    relatedSignals: [],
    lineage: {
      parentId: null,
      derivedFrom: null,
      ancestorChain: []
    },
    cognitiveTags: []
  };
}