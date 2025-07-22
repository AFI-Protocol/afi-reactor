import { evaluate } from './plugins/afi-ensemble-scorer/index.ts';

const mockSignal = {
  id: 'mock-signal-001',
  source: 'test-harness',
  timeframe: '1h',
  action: 'long',
  strength: 0.75,
  market: 'ETH-USD',
  indicators: {
    rsi: 65,
    macd: 0.02,
  },
  analysis: {
    type: 'technical',
    confidence: 0.85,
    summary: 'Momentum building with bullish confirmation',
  },
  enriched: {
    pattern: 'ascending_triangle',
    sentimentScore: 0.3,
  },
  scoring: {
    PoI: 50,
    insightScore: 90,
  },
};

const result = evaluate({ signal: mockSignal });

console.log('🧪 Test Result:', result);