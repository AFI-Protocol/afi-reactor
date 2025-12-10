# Coinbase Integration - Quick Reference

**Last Updated**: 2025-12-10  
**Status**: Active

---

## Overview

AFI Reactor integrates with **Coinbase** exchange for real-time spot market price data. This integration is **READ-ONLY** (no order placement) and uses the [ccxt](https://github.com/ccxt/ccxt) library for exchange connectivity.

**Supported Markets**: Spot only (Coinbase does not offer perpetual futures)

---

## Quick Start

### 1. Enable Coinbase Price Feed

Set environment variable:

```bash
export AFI_PRICE_FEED_SOURCE=coinbase
```

### 2. Start Server

```bash
npm run start:demo
```

### 3. Test Coinbase Connectivity

```bash
# Check adapter status
curl "http://localhost:8080/test/coinbase/status" | jq .

# Fetch ticker
curl "http://localhost:8080/test/coinbase/ticker?symbol=BTC/USDT" | jq .

# Fetch OHLCV candles
curl "http://localhost:8080/test/coinbase/ohlcv?symbol=BTC/USDT&timeframe=1h&limit=50" | jq .
```

### 4. Generate Coinbase-Backed Signal

```bash
curl -X POST "http://localhost:8080/demo/afi-eliza-demo" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "market": "spot",
    "direction": "long",
    "entry": 95000,
    "stopLoss": 93000,
    "takeProfit": 98000,
    "confidence": 0.75,
    "reasoning": "Testing Coinbase price feed integration"
  }' | jq .
```

**Expected Provenance**:
- `priceSource`: `"coinbase"`
- `venueType`: `"crypto_spot"`
- `marketType`: `"spot"`

---

## Symbol Format

### AFI Canonical Format
`"BTC/USDT"`, `"ETH/USDC"` (BASE/QUOTE with slash)

### Coinbase Format
`"BTC-USDT"`, `"ETH-USDC"` (BASE-QUOTE with hyphen)

**Conversion** (handled automatically by symbol registry):
```typescript
import { toVenueSymbol, fromVenueSymbol } from './adapters/symbolRegistry.js';

// AFI canonical → Coinbase
toVenueSymbol({ venue: 'coinbase', canonical: 'BTC/USDT', marketType: 'spot' })
// Returns: "BTC-USDT"

// Coinbase → AFI canonical
fromVenueSymbol({ venue: 'coinbase', venueSymbol: 'BTC-USDT' })
// Returns: "BTC/USDT"
```

---

## Test Endpoints

All test endpoints are **dev/demo only** and should not be used in production.

### GET /test/coinbase/status

Check Coinbase adapter status and configuration.

**Example**:
```bash
curl "http://localhost:8080/test/coinbase/status" | jq .
```

**Response**:
```json
{
  "status": "ok",
  "adapter": {
    "id": "coinbase",
    "name": "Coinbase",
    "supportsPerps": false,
    "supportsSpot": true
  },
  "availableSources": ["blofin", "coinbase", "demo"],
  "env": {
    "AFI_PRICE_FEED_SOURCE": "coinbase",
    "COINBASE_API_BASE_URL": "(default)"
  },
  "timestamp": "2025-12-10T12:00:00.000Z"
}
```

### GET /test/coinbase/ticker

Fetch current ticker snapshot.

**Query Parameters**:
- `symbol` (required): Trading pair in AFI canonical format (e.g., `"BTC/USDT"`)

**Example**:
```bash
curl "http://localhost:8080/test/coinbase/ticker?symbol=BTC/USDT" | jq .
```

### GET /test/coinbase/ohlcv

Fetch OHLCV candles.

**Query Parameters**:
- `symbol` (required): Trading pair in AFI canonical format
- `timeframe` (required): Candle timeframe (`"1m"`, `"5m"`, `"1h"`, `"1d"`, etc.)
- `limit` (optional): Number of candles (default: 50, max: 500)

**Example**:
```bash
curl "http://localhost:8080/test/coinbase/ohlcv?symbol=BTC/USDT&timeframe=1h&limit=50" | jq .
```

---

## Environment Variables

```bash
# Price feed source (required)
AFI_PRICE_FEED_SOURCE=coinbase

# Custom Coinbase API base URL (optional)
# Only needed if using a custom endpoint
# COINBASE_API_BASE_URL=https://api.coinbase.com
```

---

## Provenance Tracking

All Coinbase-backed signals are tagged with provenance metadata in the TSSD vault:

```json
{
  "signalId": "alpha-...",
  "market": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "marketType": "spot",
    "priceSource": "coinbase",
    "venueType": "crypto_spot"
  }
}
```

This metadata is **required** for TSSD vault writes and is validated at runtime.

---

## Limitations

- **Spot markets only**: Coinbase does not offer perpetual futures or derivatives
- **Public endpoints only**: No authentication required (read-only)
- **Rate limits**: Respects Coinbase API rate limits via ccxt

---

## Related Documentation

- **Price Feed Architecture**: `docs/PRICE_FEED_ARCHITECTURE.md`
- **BloFin Quick Reference**: `docs/BLOFIN_QUICK_REFERENCE.md`
- **Symbol Registry**: `src/adapters/symbolRegistry.ts`
- **Coinbase Adapter**: `src/adapters/exchanges/coinbasePriceFeedAdapter.ts`

