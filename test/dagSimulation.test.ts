import { runDAG, DAGSignal } from '../core/dag-engine.js';

describe('DAG Simulation', () => {
  it('should process a mock signal successfully', async () => {
    const mockSignal: DAGSignal = {
      signalId: 'test-signal-001',
      score: 0.85,
      confidence: 0.92,
      timestamp: new Date().toISOString(),
      meta: { source: 'unit-test', strategy: 'validation' }
    };

    const result = await runDAG('test-dag', mockSignal);

    // Assert core processing
    expect(result.processed).toBe(true);
    expect(result.processedAt).toBeDefined();
    expect(result.signalId).toBe(mockSignal.signalId);
    
    // Assert data integrity
    expect(result.score).toBe(mockSignal.score);
    expect(result.confidence).toBe(mockSignal.confidence);
    expect(result.dagType).toBe('test-dag');
    
    // Assert timestamp is recent
    const processedTime = new Date(result.processedAt);
    const now = new Date();
    expect(processedTime.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('should handle different DAG types', async () => {
    const signal: DAGSignal = {
      signalId: 'multi-dag-test',
      score: 0.75,
      confidence: 0.88,
      timestamp: new Date().toISOString(),
      meta: { source: 'multi-test' }
    };

    const result1 = await runDAG('signal-to-vault', signal);
    const result2 = await runDAG('signal-to-vault-cognition', signal);

    expect(result1.dagType).toBe('signal-to-vault');
    expect(result2.dagType).toBe('signal-to-vault-cognition');
    expect(result1.processed).toBe(true);
    expect(result2.processed).toBe(true);
  });
});