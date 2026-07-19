/**
 * afi-adapter-news-sec-edgar@1.0.0 — the KEYLESS government-source news
 * reference adapter (FLPR-GOV D-FLPR-2 item 6): SEC EDGAR full-text search
 * behind the governed news contract.
 *
 * EDGAR is public information ("may be copied or further distributed by users
 * without the SEC's permission" — cite SEC; no SEC seal/marks). Access is
 * keyless; the SEC fair-access policy requires a DESCRIPTIVE User-Agent
 * header, which is a non-secret operator identifier — NOT a credential (the
 * SecretResolver is never invoked). Hosts are fixed adapter policy (anti-SSRF;
 * endpointProfile 'default' only).
 *
 * The adapter derives a bounded filing-event summary (same normalization
 * discipline as the incumbent news provider: window filter, newest-first,
 * dedup, cap 10). An unmapped signal symbol yields the honest empty summary —
 * never a fabricated default query (FLPR-GOV D-FLPR-4).
 */
import type { NewsShockSummary } from "../../news/newsProvider.js";
import { DEFAULT_NEWS_SUMMARY } from "../../news/newsProvider.js";
import { computeNewsFeatures } from "../../news/newsFeatures.js";
import type { CategoryResult, ProviderAdapter, ProviderAdapterContext } from "../types.js";

export interface NewsSecEdgarAdapterDeps {
  fetchImpl?: typeof fetch;
  computeFeatures?: typeof computeNewsFeatures;
  /** Injectable clock (tests only). */
  now?: () => Date;
}

/** Fixed public hosts — never analyst-configurable. */
const SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";
const ARCHIVE_BASE = "https://www.sec.gov/Archives/edgar/data";
/** Descriptive, non-secret fair-access identifier required by SEC policy. */
const USER_AGENT = "AFI-Protocol afi-reactor (founder@afiprotocol.org)";
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_ITEMS = 10;

/** Bounded base-asset → full-text query map (conservative; no free-form terms). */
const QUERY_BY_BASE: Record<string, string> = {
  BTC: "bitcoin",
  XBT: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  DOGE: "dogecoin",
  XRP: "ripple",
};

/** Known quote suffixes stripped from concatenated symbol forms (e.g. BTCUSDT). */
const QUOTE_SUFFIXES = ["USDT", "USDC", "USD", "PERP"];

function baseAssetOf(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  if (upper.includes("/")) return upper.split("/")[0] ?? "";
  for (const suffix of QUOTE_SUFFIXES) {
    if (upper.endsWith(suffix) && upper.length > suffix.length) {
      return upper.slice(0, upper.length - suffix.length);
    }
  }
  return upper;
}

export function edgarQueryForSymbol(symbol: string): string | undefined {
  // EXACT base-asset match only — a prefix match would query another asset's
  // filings as this signal's news (never wrong-asset data).
  return QUERY_BY_BASE[baseAssetOf(symbol)];
}

interface EdgarHitSource {
  adsh?: string;
  ciks?: string[];
  display_names?: string[];
  root_forms?: string[];
  file_type?: string;
  file_date?: string;
}

function emptyResult(computeFeatures: typeof computeNewsFeatures): CategoryResult {
  return {
    category: "news",
    news: {
      hasShockEvent: DEFAULT_NEWS_SUMMARY.hasShockEvent,
      shockDirection: DEFAULT_NEWS_SUMMARY.shockDirection,
      headlines: DEFAULT_NEWS_SUMMARY.headlines,
      items: [],
    },
    newsFeatures: computeFeatures(DEFAULT_NEWS_SUMMARY) ?? {},
  };
}

export function createNewsSecEdgarAdapter(deps: NewsSecEdgarAdapterDeps = {}): ProviderAdapter {
  const computeFeatures = deps.computeFeatures ?? computeNewsFeatures;
  return {
    adapterId: "afi-adapter-news-sec-edgar",
    adapterVersion: "1.0.0",
    transportKind: "http",
    category: "news",
    providerCompatibility: ["afi-provider-news-sec-edgar"],
    requiresCredential: false,
    async run(ctx: ProviderAdapterContext): Promise<CategoryResult> {
      const rawSymbol = ctx.signal.facts?.symbol;
      const query =
        typeof rawSymbol === "string" && rawSymbol.trim() !== ""
          ? edgarQueryForSymbol(rawSymbol)
          : undefined;
      if (!query) {
        ctx.logger.warn("sec-edgar news adapter: signal symbol has no mapped query; emitting empty summary");
        return emptyResult(computeFeatures);
      }

      const windowRaw = ctx.config["windowHours"];
      const windowHours = typeof windowRaw === "number" ? windowRaw : 24;
      const timeoutRaw = ctx.config["timeoutMs"];
      const timeoutMs = typeof timeoutRaw === "number" ? timeoutRaw : DEFAULT_TIMEOUT_MS;
      const fetchImpl = deps.fetchImpl ?? fetch;
      const now = deps.now ? deps.now() : new Date();

      let payload: unknown;
      try {
        const params = new URLSearchParams({ q: `"${query}"` });
        const response = await fetchImpl(`${SEARCH_URL}?${params.toString()}`, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          signal: ctx.abort
            ? AbortSignal.any([ctx.abort, AbortSignal.timeout(timeoutMs)])
            : AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          throw new Error(`sec-edgar error: ${response.status} ${response.statusText}`);
        }
        payload = await response.json();
      } catch (err) {
        // Fail-soft to the honest empty summary (same discipline as the
        // incumbent news adapter); the degradation is visible, never fabricated.
        ctx.logger.warn("sec-edgar news fetch failed (fail-soft, recorded)", {
          query,
          error: err instanceof Error ? err.message : String(err),
        });
        return emptyResult(computeFeatures);
      }

      const hits =
        ((payload as { hits?: { hits?: Array<{ _source?: EdgarHitSource }> } })?.hits?.hits ?? [])
          .map((h) => h?._source)
          .filter((s): s is EdgarHitSource => s !== null && typeof s === "object");

      const cutoffMs = now.getTime() - windowHours * 3600 * 1000;
      const seen = new Set<string>();
      const items: { id: string; title: string; source: string; url: string; publishedAt: Date }[] = [];
      for (const s of hits) {
        const adsh = typeof s.adsh === "string" ? s.adsh : undefined;
        const cik = Array.isArray(s.ciks) && typeof s.ciks[0] === "string" ? s.ciks[0] : undefined;
        const name =
          Array.isArray(s.display_names) && typeof s.display_names[0] === "string"
            ? s.display_names[0]
            : "unknown filer";
        const form =
          Array.isArray(s.root_forms) && typeof s.root_forms[0] === "string"
            ? s.root_forms[0]
            : typeof s.file_type === "string"
              ? s.file_type
              : "filing";
        const fileDate = typeof s.file_date === "string" ? new Date(s.file_date) : now;
        const publishedAt = Number.isFinite(fileDate.getTime()) ? fileDate : now;
        if (publishedAt.getTime() < cutoffMs) continue;
        if (!adsh || !cik) continue;
        const dedupKey = adsh.toLowerCase();
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        const cikNum = String(Number(cik));
        const adshNoDashes = adsh.replace(/-/g, "");
        items.push({
          id: adsh,
          title: `${form} — ${name}`,
          source: "sec-edgar",
          url: `${ARCHIVE_BASE}/${cikNum}/${adshNoDashes}/${adsh}-index.htm`,
          publishedAt,
        });
      }
      items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
      const bounded = items.slice(0, MAX_ITEMS);

      const summary: NewsShockSummary = {
        hasShockEvent: bounded.length > 0,
        shockDirection: bounded.length > 0 ? "unknown" : "none",
        headlines: bounded.map((i) => i.title),
        items: bounded,
      };

      ctx.logger.info("filing events computed (sec-edgar provider adapter)", {
        query,
        items: bounded.length,
      });

      return {
        category: "news",
        news: {
          hasShockEvent: summary.hasShockEvent,
          shockDirection: summary.shockDirection,
          headlines: summary.headlines,
          items: bounded.map((item) => ({
            title: item.title,
            source: item.source,
            url: item.url,
            publishedAt: item.publishedAt.toISOString(),
          })),
        },
        newsFeatures: computeFeatures(summary) ?? {},
      };
    },
  };
}

/** Production singleton (global fetch; keyless government source). */
export const newsSecEdgarAdapter: ProviderAdapter = createNewsSecEdgarAdapter();
