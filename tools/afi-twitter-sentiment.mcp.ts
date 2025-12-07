import { ReactorSignalEnvelope } from "../types/ReactorSignalEnvelope.js";

export async function analyze(signal: ReactorSignalEnvelope): Promise<ReactorSignalEnvelope & { sentimentScore: number; sentimentLabel: string }> {
  const sentimentScore = parseFloat((Math.random() * 2 - 1).toFixed(3)); // Range: -1 (bearish) to 1 (bullish)

  const sentimentLabel =
    sentimentScore > 0.3
      ? "bullish"
      : sentimentScore < -0.3
      ? "bearish"
      : "neutral";

  console.log(`🐦 Twitter sentiment score: ${sentimentScore} (${sentimentLabel})`);

  return {
    ...signal,
    sentimentScore,
    sentimentLabel,
  };
}

export default { analyze };
