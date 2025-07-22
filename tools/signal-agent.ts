import crypto from "crypto";

/**
 * Generates a fully enriched agentic signal with metadata suited for traders, quants, and AFI pipeline apps.
 */
export function generateSignal(): any {
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const score = parseFloat((Math.random() * 1).toFixed(4));
  const confidence = parseFloat((0.85 + Math.random() * 0.1).toFixed(3));

  const signal = {
    signalId: `agent-${now}`,
    score,
    confidence,
    timestamp,
    meta: {
      strategy: pickStrategy(),
      agent: "signal-agent-001",
      category: pickCategory(),
      source: pickSource(),
      version: "v1.0.0",
      tags: ["agentic", "testnet", "mvp"],
      createdBy: "signal-agent.ts"
    }
  };

  // Add an optional checksum for integrity (e.g., for R&D, replay audit)
  signal.meta.checksum = createChecksum(signal);

  return signal;
}

/**
 * Returns a random strategy name (for signal diversity testing)
 */
function pickStrategy(): string {
  const strategies = [
    "agentic-mean-reversion",
    "trend-following-alpha",
    "momentum-surge-scout",
    "stat-arb-v2",
    "chaikin-tap"
  ];
  return strategies[Math.floor(Math.random() * strategies.length)];
}

/**
 * Returns a category for this signal: helpful for sorting in UI or pipelines.
 */
function pickCategory(): string {
  const categories = ["technical", "sentiment", "news", "pattern", "ml"];
  return categories[Math.floor(Math.random() * categories.length)];
}

/**
 * Simulate the signal’s origin for tracking and debugging.
 */
function pickSource(): string {
  const sources = ["agent-net", "livefeed", "backtest", "simulation", "manual"];
  return sources[Math.floor(Math.random() * sources.length)];
}

/**
 * Create a checksum for lightweight signal verification (useful in R&D or challenge systems)
 */
function createChecksum(signal: any): string {
  const base = `${signal.signalId}:${signal.score}:${signal.confidence}:${signal.timestamp}`;
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 12);
}