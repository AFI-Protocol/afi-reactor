interface ReplayResult {
  signalId: string;
  oldScore: number;
  newScore: number;
  delta: number;
}

export function replayScoring(signals: any[]) {
  const results: ReplayResult[] = [];
  for (const signal of signals) {
    const oldScore = signal.score || 0;
    const newScore = oldScore + 1;
    results.push({
      signalId: signal.signalId,
      oldScore,
      newScore,
      delta: newScore - oldScore
    });
  }
  return results;
}
