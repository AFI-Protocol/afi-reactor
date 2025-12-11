# News Enrichment - Pluggable NewsProvider System

## Overview

The **News Enrichment** system provides real-time crypto news data for Froggy's enrichment pipeline. It uses a pluggable provider architecture that supports multiple news sources (NewsData.io, CryptoCompare, CoinFeeds, CryptoPanic, etc.).

All providers implement **fail-soft behavior**: if a provider is disabled, misconfigured, or encounters an error, enrichment continues with a safe default (no shock event, empty headlines).

---

## Architecture

### NewsProvider Interface

All news providers implement the `NewsProvider` interface:

```typescript
export interface NewsProvider {
  fetchRecentNews(params: NewsProviderParams): Promise<NewsShockSummary | null>;
}

export interface NewsProviderParams {
  symbol: string;           // e.g. "BTCUSDT", "ETHUSDT"
  windowHours?: number;     // lookback window, default 4
}

export interface NewsShockSummary {
  hasShockEvent: boolean;
  shockDirection: "bullish" | "bearish" | "none" | "unknown";
  headlines: NewsHeadline[];
}

export interface NewsHeadline {
  id: string;
  title: string;
  source: string;
  url?: string;
  publishedAt: string; // ISO 8601
}
```

### Supported Providers

| Provider | Status | API Key Required | Free Tier |
|----------|--------|------------------|-----------|
| **NewsData.io** | ✅ Implemented | Yes | 200 requests/day |
| CryptoCompare | 🔜 Planned | Yes | TBD |
| CoinFeeds | 🔜 Planned | Yes | TBD |
| CryptoPanic | 🔜 Planned | Yes | TBD |

---

## Configuration

### Environment Variables

```bash
# Choose which news provider to use:
#   - "none"      : disable news enrichment (default if unset)
#   - "newsdata"  : use NewsData.io crypto news API
NEWS_PROVIDER=newsdata

# NewsData.io API key (required if NEWS_PROVIDER=newsdata)
# Sign up at https://newsdata.io/ for a free developer key
NEWSDATA_API_KEY=your-newsdata-api-key-here

# Optional: lookback window in hours for news queries (default: 4)
NEWS_WINDOW_HOURS=4
```

### Getting a NewsData.io API Key

1. Visit [https://newsdata.io/](https://newsdata.io/)
2. Sign up for a free account
3. Navigate to your dashboard and copy your API key
4. Add it to your `.env` file as `NEWSDATA_API_KEY`

**Free Tier Limits:**
- 200 requests/day
- Crypto news endpoint access
- English language support

---

## How It Works

### 1. Provider Selection

When Froggy enrichment runs, it creates a NewsProvider based on `NEWS_PROVIDER`:

```typescript
function createNewsProvider(): NewsProvider | null {
  const providerType = process.env.NEWS_PROVIDER?.toLowerCase();

  if (!providerType || providerType === "none") {
    return null; // News enrichment disabled
  }

  if (providerType === "newsdata") {
    return createNewsDataProvider(); // NewsData.io
  }

  return null; // Unknown provider
}
```

### 2. Fetching News

The provider fetches recent news for the given symbol:

```typescript
const newsSummary = await newsProvider.fetchRecentNews({
  symbol: "BTCUSDT",
  windowHours: 4,
});
```

### 3. Symbol Mapping

AFI trading symbols are mapped to news queries:

| AFI Symbol | NewsData Coin | Search Query |
|------------|---------------|--------------|
| BTCUSDT | `btc` | "Bitcoin OR BTC" |
| ETHUSDT | `eth` | "Ethereum OR ETH" |
| SOLUSDT | `sol` | "Solana OR SOL" |
| Other | - | "cryptocurrency" |

### 4. Time Filtering

Only headlines published within the last `windowHours` are included. Results are sorted by `publishedAt` descending (newest first) and limited to the top 5 headlines.

### 5. Shock Detection

For v1, shock detection is simple:
- `hasShockEvent = true` if any headlines exist
- `shockDirection = "unknown"` (keyword-based heuristics can be added later)

---

## Fail-Soft Behavior

The system is designed to **never break enrichment** due to news provider issues:

| Scenario | Behavior |
|----------|----------|
| `NEWS_PROVIDER` not set | News enrichment disabled, returns default summary |
| `NEWSDATA_API_KEY` missing | Warning logged, returns default summary |
| NewsData API error (4xx/5xx) | Warning logged, returns default summary |
| Network timeout | Warning logged, returns default summary |
| Invalid JSON response | Warning logged, returns default summary |

**Default Summary:**
```typescript
{
  hasShockEvent: false,
  shockDirection: "none",
  headlines: []
}
```

---

## Output Format

News data appears in two places in the enriched signal:

### 1. USS News Lens

```json
{
  "lenses": [
    {
      "type": "news",
      "version": "v1",
      "payload": {
        "hasShockEvent": true,
        "shockDirection": "unknown",
        "headlines": [
          "Bitcoin Surges Past $100K as Institutional Demand Soars",
          "SEC Approves Spot Bitcoin ETF Applications",
          "MicroStrategy Adds 5,000 BTC to Treasury"
        ]
      }
    }
  ]
}
```

### 2. Top-Level News Object (afi-core compatibility)

```json
{
  "news": {
    "hasShockEvent": true,
    "shockDirection": "unknown",
    "headlines": [
      "Bitcoin Surges Past $100K as Institutional Demand Soars",
      "SEC Approves Spot Bitcoin ETF Applications",
      "MicroStrategy Adds 5,000 BTC to Treasury"
    ]
  }
}
```

---

## Adding New Providers

To add a new news provider (e.g. CryptoCompare):

1. **Create provider implementation:**
   ```typescript
   // src/news/cryptocompareNewsProvider.ts
   export class CryptoCompareProvider implements NewsProvider {
     async fetchRecentNews(params: NewsProviderParams): Promise<NewsShockSummary | null> {
       // Implementation
     }
   }
   ```

2. **Add factory function:**
   ```typescript
   export function createCryptoCompareProvider(): CryptoCompareProvider | null {
     const apiKey = process.env.CRYPTOCOMPARE_API_KEY;
     if (!apiKey) return null;
     return new CryptoCompareProvider(apiKey);
   }
   ```

3. **Update provider selection:**
   ```typescript
   if (providerType === "cryptocompare") {
     return createCryptoCompareProvider();
   }
   ```

4. **Update .env.example and this documentation**

---

## Testing

See `test/enrichment/newsDataProvider.test.ts` for examples of:
- Mocking NewsData API responses
- Testing fail-soft behavior
- Verifying enrichment integration

Run tests:
```bash
npm test -- test/enrichment/newsDataProvider.test.ts
```

---

## Troubleshooting

### No news headlines appearing

1. Check `NEWS_PROVIDER` is set to `newsdata`
2. Verify `NEWSDATA_API_KEY` is valid
3. Check server logs for warnings:
   ```
   [NewsDataProvider] API error: 401 Unauthorized
   [NewsDataProvider] NEWSDATA_API_KEY not configured
   ```

### Rate limit errors

NewsData.io free tier: 200 requests/day

If you hit the limit:
- Increase `NEWS_WINDOW_HOURS` to reduce API calls
- Implement caching (Redis with 1-hour TTL)
- Upgrade to a paid NewsData.io plan

---

## Future Enhancements

- [ ] Keyword-based shock direction detection (bullish/bearish)
- [ ] Sentiment analysis on headlines (NLP)
- [ ] Multi-provider aggregation (combine NewsData + CryptoCompare)
- [ ] Redis caching to reduce API calls
- [ ] Webhook support for real-time news alerts

