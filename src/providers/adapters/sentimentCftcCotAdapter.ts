/**
 * afi-adapter-sentiment-cftc-cot@1.0.0 — the KEYLESS public-source sentiment
 * reference adapter (FLPR-GOV D-FLPR-2 item 1): CFTC Commitments of Traders
 * (Traders in Financial Futures, futures-only) via the public-domain Socrata
 * JSON API. The lawful backbone of the sentiment lane — weekly-cadence
 * institutional positioning, freely redistributable (attribute CFTC).
 *
 * Keyless: no credential kind exists for this provider; the SecretResolver is
 * never invoked. The adapter derives VALUES ONLY (positioning / open-interest
 * axes normalized to [-1,1]); it never re-serves raw rows. An unknown or
 * unmapped signal symbol yields an honest empty axes result — never a
 * fabricated default market (FLPR-GOV D-FLPR-4).
 */
import type { SentimentAxisObservation } from "../../pipeline/nodes/laneView.js";
import type { CategoryResult, ProviderAdapter, ProviderAdapterContext } from "../types.js";

export interface SentimentCftcCotAdapterDeps {
  fetchImpl?: typeof fetch;
}

/**
 * Fixed public host + dataset (Traders in Financial Futures, futures-only).
 * Never analyst-configurable (anti-SSRF; endpointProfile 'default' only).
 */
const BASE_URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Bounded base-asset → CME market-name prefix map. COT covers listed futures
 * only; symbols outside the map yield an honest empty result.
 */
const MARKET_PREFIX_BY_BASE: Record<string, string> = {
  BTC: "BITCOIN",
  XBT: "BITCOIN",
  ETH: "ETHER",
};

/** Known quote suffixes stripped from concatenated symbol forms (e.g. BTCUSDT). */
const QUOTE_SUFFIXES = ["USDT", "USDC", "USD", "PERP"];

/** Base-asset extraction: slash-split first, else strip ONE known quote suffix. */
export function baseAssetOf(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  if (upper.includes("/")) return upper.split("/")[0] ?? "";
  for (const suffix of QUOTE_SUFFIXES) {
    if (upper.endsWith(suffix) && upper.length > suffix.length) {
      return upper.slice(0, upper.length - suffix.length);
    }
  }
  return upper;
}

export function cotMarketPrefixForSymbol(symbol: string): string | undefined {
  // EXACT base-asset match only — a prefix match would present another
  // market's positioning as this signal's sentiment (never wrong-asset data).
  return MARKET_PREFIX_BY_BASE[baseAssetOf(symbol)];
}

function toFinite(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function createSentimentCftcCotAdapter(
  deps: SentimentCftcCotAdapterDeps = {}
): ProviderAdapter {
  return {
    adapterId: "afi-adapter-sentiment-cftc-cot",
    adapterVersion: "1.0.0",
    transportKind: "http",
    category: "sentiment",
    providerCompatibility: ["afi-provider-sentiment-cftc-cot"],
    requiresCredential: false,
    async run(ctx: ProviderAdapterContext): Promise<CategoryResult> {
      const rawSymbol = ctx.signal.facts?.symbol;
      const prefix =
        typeof rawSymbol === "string" && rawSymbol.trim() !== ""
          ? cotMarketPrefixForSymbol(rawSymbol)
          : undefined;
      if (!prefix) {
        ctx.logger.warn(
          "cftc cot sentiment adapter: signal symbol has no listed COT market; emitting empty axes"
        );
        return { category: "sentiment", axes: [] };
      }

      const timeoutRaw = ctx.config["timeoutMs"];
      const timeoutMs = typeof timeoutRaw === "number" ? timeoutRaw : DEFAULT_TIMEOUT_MS;
      const fetchImpl = deps.fetchImpl ?? fetch;

      // Latest weekly report for the mapped market (bounded Socrata query;
      // keyless — no token, nothing secret in the URL).
      const params = new URLSearchParams({
        $where: `starts_with(market_and_exchange_names, '${prefix}')`,
        $order: "report_date_as_yyyy_mm_dd DESC",
        $limit: "1",
      });
      const response = await fetchImpl(`${BASE_URL}?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: ctx.abort
          ? AbortSignal.any([ctx.abort, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`cftc cot error: ${response.status} ${response.statusText}`);
      }
      const rows = (await response.json()) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows) || rows.length === 0) {
        ctx.logger.warn("cftc cot sentiment adapter: no report rows for market; emitting empty axes");
        return { category: "sentiment", axes: [] };
      }
      const row = rows[0];

      const axes: SentimentAxisObservation[] = [];

      // Leveraged-funds positioning: net = (long - short) / (long + short), in [-1,1].
      const levLong = toFinite(row["lev_money_positions_long"] ?? row["lev_money_positions_long_all"]);
      const levShort = toFinite(row["lev_money_positions_short"] ?? row["lev_money_positions_short_all"]);
      if (levLong !== undefined && levShort !== undefined && levLong + levShort > 0) {
        axes.push({
          axis: "positioning",
          score: round6(clamp((levLong - levShort) / (levLong + levShort), -1, 1)),
          confidence: 0.9,
          horizon: "weekly",
        });
        axes.push({
          axis: "longShort",
          score: round6(clamp((levLong - levShort) / (levLong + levShort), -1, 1)),
          horizon: "weekly",
        });
      }

      // Open-interest change: weekly delta relative to total OI.
      const oi = toFinite(row["open_interest_all"]);
      const oiChange = toFinite(row["change_in_open_interest_all"]);
      if (oi !== undefined && oi > 0 && oiChange !== undefined) {
        axes.push({
          axis: "openInterest",
          score: round6(clamp(oiChange / oi, -1, 1)),
          horizon: "weekly",
        });
      }

      ctx.logger.info("cot sentiment axes computed (cftc provider adapter)", {
        market: prefix,
        axes: axes.length,
      });

      return { category: "sentiment", axes };
    },
  };
}

/** Production singleton (global fetch; keyless public-domain source). */
export const sentimentCftcCotAdapter: ProviderAdapter = createSentimentCftcCotAdapter();
