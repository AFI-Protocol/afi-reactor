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
import { NewsDataProvider } from "../../news/newsdataNewsProvider.js";
import { computeNewsFeatures } from "../../news/newsFeatures.js";
import { CredentialUnavailableError } from "../errors.js";
import type { CategoryResult, ProviderAdapter, ProviderAdapterContext } from "../types.js";

export interface HttpNewsAdapterDeps {
  /** Build a header-authenticated news provider from the resolved key + transport. */
  createProvider: (opts: { apiKey: string; fetchImpl?: typeof fetch }) => NewsProvider;
  computeFeatures: typeof computeNewsFeatures;
  /** Injectable transport (default: global fetch). Injected as a fake in the proof. */
  fetchImpl?: typeof fetch;
}

const PRODUCTION_DEPS: HttpNewsAdapterDeps = {
  createProvider: ({ apiKey, fetchImpl }) => new NewsDataProvider(apiKey, { fetchImpl }),
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
      const symbol =
        typeof ctx.signal.facts?.symbol === "string" ? ctx.signal.facts.symbol : "BTCUSDT";

      const provider = deps.createProvider({ apiKey: ctx.credential.headerValue, fetchImpl: deps.fetchImpl });

      let summary: NewsShockSummary | null = null;
      try {
        summary = await provider.fetchRecentNews({ symbol, windowHours });
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
