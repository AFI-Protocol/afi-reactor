import { ReactorSignalEnvelope } from "../types/ReactorSignalEnvelope.js";

export async function analyze(signal: ReactorSignalEnvelope): Promise<ReactorSignalEnvelope & { ensembleScore: number }> {
  const ensembleScore = parseFloat((Math.random()).toFixed(3));
  console.log(`🎯 Ensemble Score: ${ensembleScore}`);
  return {
    ...signal,
    ensembleScore,
  };
}

export default { analyze };
