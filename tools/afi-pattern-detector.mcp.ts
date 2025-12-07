import { ReactorSignalEnvelope } from "../types/ReactorSignalEnvelope.js";

const mockPatterns = [
  "bullish flag",
  "bearish wedge",
  "head and shoulders",
  "ascending triangle",
  "double bottom"
];

export async function analyze(signal: ReactorSignalEnvelope): Promise<
  ReactorSignalEnvelope & {
    patternMatch: boolean;
    patternType: string | null;
    patternConfidence: number;
  }
> {
  const matched = Math.random() > 0.5;
  const patternType = matched ? mockPatterns[Math.floor(Math.random() * mockPatterns.length)] : null;
  const patternConfidence = matched ? parseFloat((Math.random() * 0.4 + 0.6).toFixed(2)) : 0;

  console.log(
    matched
      ? `🔍 Pattern matched: ${patternType} with ${patternConfidence * 100}% confidence`
      : `🔍 No pattern detected`
  );

  return {
    ...signal,
    patternMatch: matched,
    patternType,
    patternConfidence
  };
}

export default { analyze };
