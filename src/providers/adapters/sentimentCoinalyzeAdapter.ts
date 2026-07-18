/**
 * afi-adapter-sentiment-coinalyze@1.0.0 — the credentialed BYOK sentiment
 * adapter (FLPR-GOV D-FLPR-2 item 2): Coinalyze cross-exchange perp
 * positioning behind the governed sentiment contract.
 *
 * BYOK boundary (PBF-GOV D-PBF-7): the API key arrives ONLY as the resolved
 * ctx.credential bundle and is sent as the 'api-key' request HEADER — never in
 * a URL, never from process.env, never logged (the runtime logger scrubs it).
 * The adapter derives VALUES ONLY (funding / open-interest / positioning
 * axes) — it never re-serves raw provider data (derived-only posture).
 *
 * Symbol and timeframe come from the canonical signal; a signal with no
 * usable symbol yields an honest empty axes result (never a fabricated
 * default market, FLPR-GOV D-FLPR-4).
 */
import {
  computeFundingRegime,
  computePositioningBias,
} from "../../enrichment/sentiment/perpSentimentMapper.js";
import type { SentimentAxisObservation } from "../../pipeline/nodes/laneView.js";
import { CredentialUnavailableError } from "../errors.js";
import type { CategoryResult, ProviderAdapter, ProviderAdapterContext } from "../types.js";

export interface SentimentCoinalyzeAdapterDeps {
  fetchImpl?: typeof fetch;
}

const BASE_URL = "https://api.coinalyze.net/v1";
const DEFAULT_TIMEOUT_MS = 10000;

/** '<BASE>/<QUOTE>' → Coinalyze perp convention '<BASE><QUOTE>_PERP.A'. */
export function toCoinalyzeSymbol(symbol: string): string {
  return `${symbol.replace(/\//g, "").trim().toUpperCase()}_PERP.A`;
}

/** Collapse the signal timeframe onto Coinalyze's supported intervals. */
export function collapseTimeframe(timeframe: string | undefined): "1h" | "1d" {
  if (typeof timeframe === "string" && /^\d+(d|D|w|W|M)$/.test(timeframe)) return "1d";
  return "1h";
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function lastValue(payload: unknown): number | undefined {
  if (!Array.isArray(payload) || payload.length === 0) return undefined;
  const history = (payload[0] as { history?: unknown })?.history;
  const rows = Array.isArray(history) ? history : payload;
  const last = rows[rows.length - 1] as { value?: unknown; c?: unknown } | undefined;
  const v = typeof last?.value === "number" ? last.value : typeof last?.c === "number" ? last.c : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function firstValue(payload: unknown): number | undefined {
  if (!Array.isArray(payload) || payload.length === 0) return undefined;
  const history = (payload[0] as { history?: unknown })?.history;
  const rows = Array.isArray(history) ? history : payload;
  const first = rows[0] as { value?: unknown; c?: unknown } | undefined;
  const v = typeof first?.value === "number" ? first.value : typeof first?.c === "number" ? first.c : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function createSentimentCoinalyzeAdapter(
  deps: SentimentCoinalyzeAdapterDeps = {}
): ProviderAdapter {
  return {
    adapterId: "afi-adapter-sentiment-coinalyze",
    adapterVersion: "1.0.0",
    category: "sentiment",
    providerCompatibility: ["afi-provider-sentiment-coinalyze"],
    requiresCredential: true,
    async run(ctx: ProviderAdapterContext): Promise<CategoryResult> {
      if (!ctx.credential || ctx.credential.kind !== "apiKeyHeader") {
        throw new CredentialUnavailableError(
          "coinalyze sentiment adapter requires an apiKeyHeader credential bundle"
        );
      }
      const rawSymbol = ctx.signal.facts?.symbol;
      if (typeof rawSymbol !== "string" || rawSymbol.trim() === "") {
        ctx.logger.warn("coinalyze sentiment adapter: signal carries no usable symbol; emitting empty axes");
        return { category: "sentiment", axes: [] };
      }
      const symbol = toCoinalyzeSymbol(rawSymbol);
      const interval = collapseTimeframe(
        typeof ctx.signal.facts?.timeframe === "string" ? ctx.signal.facts.timeframe : undefined
      );
      const horizon: SentimentAxisObservation["horizon"] =
        interval === "1d" ? "daily" : "intraday";

      const timeoutRaw = ctx.config["timeoutMs"];
      const timeoutMs = typeof timeoutRaw === "number" ? timeoutRaw : DEFAULT_TIMEOUT_MS;
      const fetchImpl = deps.fetchImpl ?? fetch;
      // The key rides ONLY in the request header (never the URL).
      const headers = { "api-key": ctx.credential.headerValue };

      async function getJson(path: string): Promise<unknown> {
        const response = await fetchImpl(`${BASE_URL}${path}`, {
          headers,
          signal: ctx.abort ? AbortSignal.any([ctx.abort, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          throw new Error(`coinalyze error: ${response.status} ${response.statusText}`);
        }
        return response.json();
      }

      // The incumbent, proven Coinalyze endpoints (same as the retired direct
      // client): funding-rate + open-interest histories, bounded to 24 points.
      const query = `symbols=${encodeURIComponent(symbol)}&interval=${interval}&limit=24`;
      const [funding, openInterest] = await Promise.all([
        getJson(`/funding-rate?${query}`),
        getJson(`/open-interest?${query}`),
      ]);

      const fundingRate = lastValue(funding);
      const oiLast = lastValue(openInterest);
      const oiFirst = firstValue(openInterest);

      const axes: SentimentAxisObservation[] = [];

      let fundingRegime: ReturnType<typeof computeFundingRegime> | undefined;
      if (fundingRate !== undefined) {
        fundingRegime = computeFundingRegime(fundingRate);
        const fundingScore =
          fundingRegime === "elevated_positive" ? 0.5 : fundingRegime === "elevated_negative" ? -0.5 : 0;
        axes.push({ axis: "funding", score: fundingScore, horizon });
      }

      let oiChange24hPct = 0;
      if (oiLast !== undefined && oiFirst !== undefined && oiFirst !== 0) {
        oiChange24hPct = ((oiLast - oiFirst) / Math.abs(oiFirst)) * 100;
        axes.push({
          axis: "openInterest",
          score: round6(clamp(oiChange24hPct / 20, -1, 1)),
          horizon,
        });
      }

      if (fundingRegime !== undefined) {
        const bias = computePositioningBias({ fundingRegime, oiChange24hPct });
        const positioningScore = bias === "crowded_long" ? 0.6 : bias === "crowded_short" ? -0.6 : 0;
        axes.push({ axis: "positioning", score: positioningScore, horizon });
      }

      ctx.logger.info("perp sentiment axes computed (coinalyze provider adapter)", {
        symbol,
        interval,
        axes: axes.length,
      });

      return { category: "sentiment", axes };
    },
  };
}

/** Production singleton (global fetch; credential injected per invocation). */
export const sentimentCoinalyzeAdapter: ProviderAdapter = createSentimentCoinalyzeAdapter();
