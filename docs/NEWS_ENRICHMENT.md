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
  headlines: string[];        // Legacy: title-only strings for backward compatibility
  items?: NewsItem[];         // New: structured items with full metadata
}

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: Date;          // Date object (converted to ISO string in USS lens)
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

Only headlines published within the last `windowHours` are included. Results are sorted by `publishedAt` descending (newest first).

### 5. Deduplication

Articles are deduplicated by normalized `(title, source)` pairs:
- Titles and sources are trimmed and lowercased for comparison
- Only the first occurrence of each unique `(title, source)` is kept
- Same title from different sources are kept (e.g., "Bitcoin Hits $100K" from both CoinDesk and Bloomberg)

### 6. Capping

Results are capped to a maximum of **10 unique items** to avoid noise and keep enrichment payloads manageable.

### 7. Shock Detection

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
  headlines: [],
  items: []
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
        ],
        "items": [
          {
            "title": "Bitcoin Surges Past $100K as Institutional Demand Soars",
            "source": "CoinDesk",
            "url": "https://coindesk.com/...",
            "publishedAt": "2025-12-11T19:30:00Z"
          },
          {
            "title": "SEC Approves Spot Bitcoin ETF Applications",
            "source": "Bloomberg",
            "url": "https://bloomberg.com/...",
            "publishedAt": "2025-12-11T18:45:00Z"
          },
          {
            "title": "MicroStrategy Adds 5,000 BTC to Treasury",
            "source": "Reuters",
            "url": "https://reuters.com/...",
            "publishedAt": "2025-12-11T17:20:00Z"
          }
        ]
      }
    }
  ]
}
```

**Note:** The `headlines` array contains title strings only (legacy format for backward compatibility). The `items` array contains full structured metadata including source, URL, and publication timestamp.

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
    ],
    "items": [
      {
        "title": "Bitcoin Surges Past $100K as Institutional Demand Soars",
        "source": "CoinDesk",
        "url": "https://coindesk.com/...",
        "publishedAt": "2025-12-11T19:30:00Z"
      },
      {
        "title": "SEC Approves Spot Bitcoin ETF Applications",
        "source": "Bloomberg",
        "url": "https://bloomberg.com/...",
        "publishedAt": "2025-12-11T18:45:00Z"
      },
      {
        "title": "MicroStrategy Adds 5,000 BTC to Treasury",
        "source": "Reuters",
        "url": "https://reuters.com/...",
        "publishedAt": "2025-12-11T17:20:00Z"
      }
    ]
  }
}
```

**Backward Compatibility:**
- `headlines`: Array of title strings (legacy format) - always present
- `items`: Array of structured news items with full metadata (v2 format) - optional, may be undefined for older consumers

### 3. News Features (UWR-Ready, Not Wired Yet)

The `newsFeatures` field provides a derived summary of news enrichment for potential use in UWR scoring or other downstream systems. **This field is currently not used by UWR math** - it's an additive layer for future integration.

```json
{
  "newsFeatures": {
    "hasNewsShock": true,
    "headlineCount": 3,
    "mostRecentMinutesAgo": 15,
    "oldestMinutesAgo": 135,
    "hasExchangeEvent": false,
    "hasRegulatoryEvent": true,
    "hasMacroEvent": false
  }
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `hasNewsShock` | boolean | True if `hasShockEvent === true` |
| `headlineCount` | number | Number of unique headlines in the time window |
| `mostRecentMinutesAgo` | number \| null | Minutes since most recent article (null if no items) |
| `oldestMinutesAgo` | number \| null | Minutes since oldest article (null if no items) |
| `hasExchangeEvent` | boolean | True if headlines mention exchanges (Binance, Coinbase, OKX, etc.) |
| `hasRegulatoryEvent` | boolean | True if headlines mention regulation (SEC, ETF, lawsuit, etc.) |
| `hasMacroEvent` | boolean | True if headlines mention macro events (Fed, inflation, etc.) |

**Keyword Detection:**

Categorical flags use simple case-insensitive keyword matching on article titles and sources:

- **Exchange Events**: binance, coinbase, bybit, okx, blofin, bitget, kraken, gemini, ftx, bitfinex, huobi, kucoin
- **Regulatory Events**: sec, cftc, regulation, lawsuit, ban, etf, approval, denied, fined, penalty, enforcement, compliance, ruling
- **Macro Events**: fed, federal reserve, interest rate, inflation, jobs report, gdp, recession, treasury, bond yield, stock market, s&p, nasdaq, dow, unemployment

**Usage:**

```typescript
// Access newsFeatures from enriched output
const enriched = await froggyEnrichmentPlugin.run(signal);

if (enriched.newsFeatures) {
  console.log(`News shock: ${enriched.newsFeatures.hasNewsShock}`);
  console.log(`Headlines: ${enriched.newsFeatures.headlineCount}`);
  console.log(`Most recent: ${enriched.newsFeatures.mostRecentMinutesAgo} min ago`);

  if (enriched.newsFeatures.hasRegulatoryEvent) {
    console.log("⚠️  Regulatory event detected");
  }
}
```

**Future Integration:**

The `newsFeatures` field is designed to be easily integrated into UWR scoring in the future. For example:

- **Insight Axis**: Regulatory or macro events could boost insight score
- **Execution Axis**: Recent news (< 30 min) could affect timing quality
- **Risk Axis**: Exchange-related events could signal elevated risk

Currently, `newsFeatures` is computed but **not used** by any scoring logic. It's purely informational.

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

## Froggy Max Enrichment Demo

### FROGGY_MAX_ENRICHMENT_PROFILE

For quick demos and testing, use the **FROGGY_MAX_ENRICHMENT_PROFILE** preset to enable all currently wired enrichment categories:

```typescript
// Defined in: afi-reactor/src/config/enrichmentProfiles.ts
export const FROGGY_MAX_ENRICHMENT_PROFILE: EnrichmentProfile = {
  technical: { enabled: true },   // ✅ EMA, RSI, ATR, volume
  pattern: { enabled: true },     // ✅ Chart patterns, regime, Fear & Greed
  sentiment: { enabled: true },   // ✅ Funding rates, OI, positioning
  news: { enabled: true },        // ✅ News headlines, shock detection, newsFeatures
  aiMl: { enabled: false },       // ❌ Reserved lane (not yet wired)
};
```

### Using with /test/enrichment Endpoint

Instead of passing a full `enrichmentProfile` object, use the `useMaxEnrichment` flag:

```bash
# Quick demo with all enrichment categories enabled
curl -X POST "http://localhost:8080/test/enrichment" \
  -H "Content-Type: application/json" \
  -d '{
    "signalId": "froggy-demo-001",
    "symbol": "BTCUSDT",
    "timeframe": "1h",
    "useMaxEnrichment": true
  }'
```

**Response includes:**
- ✅ `output.technical` - Technical indicators (EMA, RSI, ATR)
- ✅ `output.pattern` - Chart patterns and regime detection
- ✅ `output.sentiment` - Funding rates and positioning bias
- ✅ `output.news` - News headlines and shock detection
- ✅ `output.newsFeatures` - Derived news features (timing, categorical flags)
- ✅ `output.lenses[]` - USS lenses for all enabled categories

**Priority order:**
1. Explicit `enrichmentProfile` object (highest priority)
2. `useMaxEnrichment: true` → uses FROGGY_MAX_ENRICHMENT_PROFILE
3. No profile specified → uses default profile (all categories enabled)

**Example:**
```bash
# This uses the custom profile (ignores useMaxEnrichment)
curl -X POST "http://localhost:8080/test/enrichment" \
  -H "Content-Type: application/json" \
  -d '{
    "signalId": "custom-001",
    "symbol": "BTCUSDT",
    "timeframe": "1h",
    "useMaxEnrichment": true,
    "enrichmentProfile": {
      "technical": { "enabled": true },
      "pattern": { "enabled": false },
      "sentiment": { "enabled": false },
      "news": { "enabled": false },
      "aiMl": { "enabled": false }
    }
  }'
```

---

## Future Enhancements

- [ ] Keyword-based shock direction detection (bullish/bearish)
- [ ] Sentiment analysis on headlines (NLP)
- [ ] Multi-provider aggregation (combine NewsData + CryptoCompare)
- [ ] Redis caching to reduce API calls
- [ ] Webhook support for real-time news alerts

