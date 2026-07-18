/**
 * afi-adapter-news-http@1.0.0 — the CREDENTIALED (BYOK) news reference adapter
 * (PBF-GOV §7.8).
 *
 * Wraps the real news-provider abstraction (NewsProvider) with header-based
 * BYOK: the credential is supplied ONLY by ctx.credential (resolved by the
 * least-privilege SecretResolver), carried in a request HEADER (never a URL),
 * and the transport is injectable so the proof runs against a deterministic
 * fake — no live paid key. The adapter reads NO process.env for its credential.
 */
import type { NewsProvider, NewsShockSummary } from "../../news/newsProvider.js";
import { DEFAULT_NEWS_SUMMARY } from "../../news/newsProvider.js";
import { NewsDataProvider } from "../clients/newsdataNewsProvider.js";
import { computeNewsFeatures } from "../../news/newsFeatures.js";
import { CredentialUnavailableError } from "../errors.js";
import type { CategoryResult, ProviderAdapter, ProviderAdapterContext } from "../types.js";

export interface HttpNewsAdapterDeps {
  /** Build a header-authenticated news provider from the resolved key + transport. */
  createProvider: (opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }) => NewsProvider;
  computeFeatures: typeof computeNewsFeatures;
  /** Injectable transport (default: global fetch). Injected as a fake in the proof. */
  fetchImpl?: typeof fetch;
}

const PRODUCTION_DEPS: HttpNewsAdapterDeps = {
  createProvider: ({ apiKey, fetchImpl, timeoutMs }) => new NewsDataProvider(apiKey, { fetchImpl, timeoutMs }),
  computeFeatures: computeNewsFeatures,
};

export function createHttpNewsAdapter(deps: HttpNewsAdapterDeps = PRODUCTION_DEPS): ProviderAdapter {
  return {
    adapterId: "afi-adapter-news-http",
    adapterVersion: "1.0.0",
    category: "news",
    providerCompatibility: ["afi-provider-news-http"],
    requiresCredential: true,
    async run(ctx: ProviderAdapterContext): Promise<CategoryResult> {
      if (!ctx.credential || ctx.credential.kind !== "apiKeyHeader") {
        // Defensive: the runtime guarantees a credential for a credentialed
        // provider; fail closed and non-revealing if it is ever absent.
        throw new CredentialUnavailableError("news adapter invoked without an authorized credential");
      }
      const windowRaw = ctx.config["windowHours"];
      const windowHours = typeof windowRaw === "number" ? windowRaw : 4;
      // Operator-configured, non-secret invocation timeout (from the provider
      // instance's invocation settings); undefined falls back to the provider default.
      const timeoutRaw = ctx.config["timeoutMs"];
      const timeoutMs = typeof timeoutRaw === "number" ? timeoutRaw : undefined;
      const rawSymbol = ctx.signal.facts?.symbol;
      if (typeof rawSymbol !== "string" || rawSymbol.trim() === "") {
        // No usable symbol → the honest empty summary. NEVER a fabricated
        // default market (FLPR-GOV D-FLPR-4 — no fixed-symbol fallbacks).
        ctx.logger.warn("news adapter: signal carries no usable symbol; emitting empty summary");
        return {
          category: "news",
          news: {
            hasShockEvent: DEFAULT_NEWS_SUMMARY.hasShockEvent,
            shockDirection: DEFAULT_NEWS_SUMMARY.shockDirection,
            headlines: DEFAULT_NEWS_SUMMARY.headlines,
            items: [],
          },
          newsFeatures: {},
        };
      }
      const symbol = rawSymbol;

      const provider = deps.createProvider({ apiKey: ctx.credential.headerValue, fetchImpl: deps.fetchImpl, timeoutMs });

      let summary: NewsShockSummary | null = null;
      try {
        // Thread the per-node abort so an executor timeout / cancellation aborts
        // the outbound request (not just the executor).
        summary = await provider.fetchRecentNews({ symbol, windowHours, abort: ctx.abort });
      } catch (err) {
        // Fail-soft to the declared fallback; the scrubbing logger guarantees
        // the credential never reaches the sink even if err carries it.
        ctx.logger.warn("news provider fetch failed (fail-soft, recorded)", {
          symbol,
          error: err instanceof Error ? err.message : String(err),
        });
        summary = null;
      }

      const effective = summary ?? DEFAULT_NEWS_SUMMARY;
      const news = {
        hasShockEvent: effective.hasShockEvent,
        shockDirection: effective.shockDirection,
        headlines: effective.headlines,
        items: effective.items?.map((item) => ({
          title: item.title,
          source: item.source,
          url: item.url,
          publishedAt: item.publishedAt.toISOString(),
        })),
      };
      const newsFeatures = deps.computeFeatures(summary) ?? {};

      return { category: "news", news, newsFeatures };
    },
  };
}

export const httpNewsAdapter: ProviderAdapter = createHttpNewsAdapter();
