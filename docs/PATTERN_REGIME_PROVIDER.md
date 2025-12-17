# Pattern Regime Provider Configuration

## Overview

Pattern Regime enrichment now uses **exchange-provided OHLC data** (Blofin/Coinbase) instead of CoinGecko to avoid rate limits and improve reliability.

## Problem Solved

**Before:** Pattern Regime used CoinGecko's free API for 90-day OHLC data, which:
- Hit 429 rate limits frequently on Render
- Caused "Insufficient OHLC data (0 candles)" errors
- Blocked the entire enrichment pipeline

**After:** Pattern Regime uses exchange adapters (Blofin primary, Coinbase fallback) with:
- No rate limits (public OHLC endpoints)
- Lightweight caching (15-minute TTL)
- Graceful degradation (returns "unknown" regime on failure)
- Kill-switch for tests (`PATTERN_REGIME_PROVIDER=off`)

---

## Environment Variables

### `PATTERN_REGIME_PROVIDER`

**Default:** `blofin`

**Options:**
- `blofin` - Use BloFin exchange OHLC (recommended, supports perps + spot)
- `coinbase` - Use Coinbase exchange OHLC (fallback, spot only)
- `coingecko` - Use CoinGecko public API (legacy, has rate limits)
- `off` - Disable regime enrichment (returns `patternRegime: "unknown"`)

**Example:**
```bash
PATTERN_REGIME_PROVIDER=blofin
```

### `PATTERN_REGIME_TIMEFRAME`

**Default:** `4h`

**Options:** Any ccxt-supported timeframe (`1h`, `4h`, `1d`, etc.)

Higher timeframes = smoother regime detection, fewer API calls.

**Example:**
```bash
PATTERN_REGIME_TIMEFRAME=4h
```

### `PATTERN_REGIME_LOOKBACK_DAYS`

**Default:** `90`

How many days of historical data to fetch for regime computation.

**Example:**
```bash
PATTERN_REGIME_LOOKBACK_DAYS=90
```

### `PATTERN_REGIME_CACHE_TTL_MINUTES`

**Default:** `15`

How long to cache regime candles before refetching. Prevents redundant API calls for multiple alerts on the same symbol.

**Example:**
```bash
PATTERN_REGIME_CACHE_TTL_MINUTES=15
```

---

## How It Works

### Symbol Normalization

TradingView symbols like `BTCUSDT.P` are automatically normalized to exchange format:

- `BTCUSDT.P` → `BTC/USDT` (strips `.P` suffix)
- `ETHUSDT` → `ETH/USDT` (inserts `/` between base/quote)
- `BTC/USDT` → `BTC/USDT` (already canonical)

### Caching

Regime candles are cached in-memory with a TTL (default 15 minutes):

- **Cache Key:** `{symbol}:{timeframe}:{lookbackDays}:{provider}`
- **Example:** `BTCUSDT.P:4h:90:blofin`
- **Benefit:** Multiple TradingView alerts for the same symbol don't refetch 90 days of history

### Graceful Degradation

If regime fetch fails (network error, rate limit, etc.):
- **Before:** Entire enrichment pipeline failed
- **After:** Returns `patternRegime: "unknown"` and continues pipeline

---

## Setting Environment Variables on Render

### Via Dashboard

1. Go to your Render service dashboard
2. Click **Environment** tab
3. Add environment variables:
   ```
   PATTERN_REGIME_PROVIDER=blofin
   PATTERN_REGIME_TIMEFRAME=4h
   PATTERN_REGIME_LOOKBACK_DAYS=90
   PATTERN_REGIME_CACHE_TTL_MINUTES=15
   ```
4. Click **Save Changes**
5. Render will automatically redeploy

### Via render.yaml (Infrastructure as Code)

```yaml
services:
  - type: web
    name: afi-reactor
    env: node
    buildCommand: npm install && npm run build
    startCommand: npm run start:demo
    envVars:
      - key: PATTERN_REGIME_PROVIDER
        value: blofin
      - key: PATTERN_REGIME_TIMEFRAME
        value: 4h
      - key: PATTERN_REGIME_LOOKBACK_DAYS
        value: 90
      - key: PATTERN_REGIME_CACHE_TTL_MINUTES
        value: 15
```

---

## Testing

### Test Payload (TradingView Webhook)

Send this payload to verify CoinGecko is **not** called when using Blofin:

```bash
curl -X POST http://localhost:8080/api/webhooks/tradingview \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTCUSDT.P",
    "timeframe": "1h",
    "close": 95000,
    "volume": 1000,
    "timestamp": "2024-12-17T00:00:00Z",
    "alert_message": "Test regime provider"
  }'
```

### Expected Logs (Blofin Provider)

```
🔍 Pattern Regime: Computing for BTCUSDT.P on 1h...
🔍 Regime Candles: Fetching from blofin - BTC/USDT 4h (90d)
✅ Regime Candles: Fetched 540 candles from blofin (cached for 15m)
✅ Pattern Regime: BTCUSDT.P - mid_bull (uptrend, normal vol, neutral)
```

**Note:** No `CoinGecko` logs should appear!

### Expected Logs (Provider = off)

```
🔍 Pattern Regime: Computing for BTCUSDT.P on 1h...
⚠️  Regime Candles: Provider is "off", skipping fetch
⚠️  Pattern Regime: Insufficient OHLC data (0 candles). Returning "unknown" regime.
```

---

## Migration Notes

- **No breaking changes:** Existing deployments continue to work
- **Default behavior:** Uses Blofin (no CoinGecko rate limits)
- **Backward compatibility:** Set `PATTERN_REGIME_PROVIDER=coingecko` to restore old behavior
- **Tests:** Set `PATTERN_REGIME_PROVIDER=off` to disable regime enrichment in tests

---

## Troubleshooting

### "Insufficient OHLC data" warnings

**Cause:** Exchange returned fewer than 20 candles (not enough for regime computation)

**Solutions:**
1. Check if symbol is supported by the exchange (e.g., Coinbase doesn't support perps)
2. Try a different provider (`blofin` vs `coinbase`)
3. Reduce `PATTERN_REGIME_LOOKBACK_DAYS` (e.g., 30 instead of 90)

### Cache not working

**Symptom:** Logs show "Fetching from blofin" on every alert

**Cause:** Cache TTL expired or cache key mismatch

**Solution:** Increase `PATTERN_REGIME_CACHE_TTL_MINUTES` (e.g., 30)

