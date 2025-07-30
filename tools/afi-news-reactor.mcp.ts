import { Signal } from "../types/Signal.js";

const sampleHeadlines = [
  "Fed signals potential rate hike next quarter",
  "Ethereum devs confirm major upgrade timeline",
  "Bitcoin ETFs reach record weekly inflows",
  "Market cautious amid geopolitical tensions",
  "SEC delays decision on crypto regulations"
];

export async function analyze(signal: Signal): Promise<
  Signal & {
    newsImpactScore: number;
    headlineSummary: string;
    newsSentiment: "positive" | "neutral" | "negative";
  }
> {
  const headlineSummary = sampleHeadlines[Math.floor(Math.random() * sampleHeadlines.length)];
  const sentimentRoll = Math.random();
  const newsSentiment =
    sentimentRoll > 0.66 ? "positive" : sentimentRoll > 0.33 ? "neutral" : "negative";

  const baseImpact = Math.random(); // 0 to 1
  const sentimentMultiplier = newsSentiment === "positive" ? 1 : newsSentiment === "neutral" ? 0.7 : 0.4;
  const newsImpactScore = parseFloat((baseImpact * sentimentMultiplier).toFixed(3));

  console.log(
    `📰 News: "${headlineSummary}" — Sentiment: ${newsSentiment}, Impact Score: ${newsImpactScore}`
  );

  return {
    ...signal,
    newsImpactScore,
    headlineSummary,
    newsSentiment
  };
}

export default { analyze };