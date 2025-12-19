/**
 * Crypto Fear & Greed Index Client
 *
 * Provides access to Alternative.me's Crypto Fear & Greed Index.
 * No API key required - completely free and public.
 *
 * API Docs: https://alternative.me/crypto/fear-and-greed-index/
 *
 * The index ranges from 0 (Extreme Fear) to 100 (Extreme Greed) and is
 * calculated from volatility, market momentum, social media, surveys, and dominance.
 */

const FEAR_GREED_API_URL = "https://api.alternative.me/fng/";

/**
 * Fear & Greed data point
 */
export interface FearGreedPoint {
  /** Timestamp in seconds (Unix epoch) */
  timestampSec: number;
  /** Fear & Greed value (0-100) */
  value: number;
  /** Classification label from API */
  classification: string;
}

/**
 * Map Fear & Greed classification string to our internal enum
 *
 * @param classification - Classification from API (e.g. "Extreme Fear", "Greed")
 * @returns Normalized label
 */
export function mapFearGreedLabel(
  classification: string
):
  | "extreme_fear"
  | "fear"
  | "neutral"
  | "greed"
  | "extreme_greed"
  | "unknown" {
  const normalized = classification.toLowerCase().trim();

  if (normalized.includes("extreme fear")) {
    return "extreme_fear";
  }
  if (normalized.includes("fear")) {
    return "fear";
  }
  if (normalized.includes("extreme greed")) {
    return "extreme_greed";
  }
  if (normalized.includes("greed")) {
    return "greed";
  }
  if (normalized.includes("neutral")) {
    return "neutral";
  }

  console.warn(
    `⚠️  Fear & Greed: Unknown classification "${classification}", defaulting to "unknown"`
  );
  return "unknown";
}

/**
 * Fetch Fear & Greed Index history
 *
 * @param limit - Number of data points to fetch (default: 90)
 * @returns Array of Fear & Greed data points, sorted oldest to newest
 *
 * Note: Returns empty array on error (fail-soft behavior)
 */
export async function fetchFearGreedHistory(
  limit: number = 90
): Promise<FearGreedPoint[]> {
  const url = `${FEAR_GREED_API_URL}?limit=${limit}&format=json`;

  try {
    console.log(`🔍 Fear & Greed: Fetching ${limit} data points...`);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      throw new Error(
        `Fear & Greed API error: ${response.status} ${response.statusText}`
      );
    }

    const json = await response.json();

    // Validate response format
    if (!json || !Array.isArray(json.data)) {
      throw new Error(
        `Fear & Greed API returned invalid data. Expected {data: [...]}, got: ${JSON.stringify(json).substring(0, 100)}`
      );
    }

    if (json.data.length === 0) {
      console.warn(`⚠️  Fear & Greed: No data returned`);
      return [];
    }

    // Map response to our format
    const points: FearGreedPoint[] = json.data.map((item: any) => {
      return {
        timestampSec: parseInt(item.timestamp, 10),
        value: parseInt(item.value, 10),
        classification: item.value_classification,
      };
    });

    // Sort oldest to newest (API returns newest first)
    points.reverse();

    console.log(
      `✅ Fear & Greed: Fetched ${points.length} data points (${points[0]?.value} to ${points[points.length - 1]?.value})`
    );

    return points;
  } catch (error) {
    // Fail-soft: log warning and return empty array
    if (error instanceof Error) {
      console.warn(
        `⚠️  Fear & Greed API unavailable:`,
        error.message,
        `- skipping sentiment overlay`
      );
    } else {
      console.warn(
        `⚠️  Fear & Greed API unavailable (unknown error) - skipping sentiment overlay`
      );
    }
    return [];
  }
}

