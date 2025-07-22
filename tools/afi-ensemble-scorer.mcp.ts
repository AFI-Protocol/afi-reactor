import { Signal } from "../types/Signal";

export async function analyze(signal: Signal): Promise<Signal & { ensembleScore: number }> {
  const ensembleScore = parseFloat((Math.random()).toFixed(3));
  console.log(`🎯 Ensemble Score: ${ensembleScore}`);
  return {
    ...signal,
    ensembleScore,
  };
}

export default { analyze };