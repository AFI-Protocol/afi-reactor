# BloFin Price Feed Integration

## Overview

This document describes the BloFin exchange integration for AFI Reactor, providing **read-only price data** for crypto perpetual futures and spot markets. This is the first step toward real exchange-sourced data, replacing mock/demo data for the Froggy pipeline.

**Status**: ✅ Complete (Read-only price data only)  
**Date**: 2025-12-10  
**Scope**: Price feeds only (NO live trading, NO order execution, NO emissions wiring)

---

## Files Created/Modified

### New Files

1. **`src/adapters/exchanges/types.ts`**
   - Core type definitions for exchange adapters
   - `PriceFeedAdapter` interface
   - `OHLCVCandle`, `TickerSnapshot`, `PriceFeedMetadata` types
   - `PriceSourceId` and `VenueType` enums

2. **`src/adapters/exchanges/blofinPriceFeedAdapter.ts`**
   - BloFin exchange adapter implementation using ccxt
   - Fetches OHLCV candles and ticker snapshots
   - Supports both perps and spot markets

3. **`src/adapters/exchanges/demoPriceFeedAdapter.ts`**
   - Mock data generator for backward compatibility
   - Generates realistic-looking OHLCV and ticker data
   - Used when `AFI_PRICE_FEED_SOURCE=demo`

4. **`src/adapters/exchanges/priceFeedRegistry.ts`**
   - Central registry mapping source IDs to adapters
   - `getPriceFeedAdapter(sourceId)` - Get adapter by ID
   - `getDefaultPriceSource()` - Read from env var
   - `listAvailablePriceSources()` - List all registered sources

5. **`src/routes/blofinTestEndpoints.ts`**
   - HTTP test endpoints for BloFin adapter verification
   - `GET /test/blofin/status` - Adapter status and config
   - `GET /test/blofin/ticker?symbol=BTC/USDT:USDT` - Real-time ticker
   - `GET /test/blofin/ohlcv?symbol=BTC/USDT:USDT&timeframe=1h&limit=50` - OHLCV candles

### Modified Files

6. **`plugins/froggy-enrichment-adapter.plugin.ts`**
   - Added real price data fetching when `AFI_PRICE_FEED_SOURCE !== "demo"`
   - Calculates technical indicators (EMA-20, EMA-50, RSI-14) from real candles
   - Falls back to demo data on error
   - Attaches price source metadata to enriched signals

7. **`src/types/TssdSignalDocument.ts`**
   - Extended `market` object to include `priceSource` and `venueType` fields
   - Enables provenance tracking in TSSD vault

8. **`src/services/froggyDemoService.ts`**
   - Updated TSSD document creation to include price source metadata
   - Reads metadata from enriched signal's `_priceFeedMetadata` property

9. **`src/server.ts`**
   - Imported and mounted BloFin test endpoints router
   - Updated startup log to show BloFin endpoints and current price feed source

10. **`.env.example`**
    - Added `AFI_PRICE_FEED_SOURCE` configuration
    - Added `BLOFIN_API_BASE_URL` (optional, uses ccxt default if not set)

11. **`package.json`**
    - Added `ccxt` dependency for unified exchange API access

---

## Implementation Approach

### Why ccxt?

We chose **ccxt** (CryptoCurrency eXchange Trading Library) over a native BloFin client because:

1. **Unified API**: Single interface for 100+ exchanges (easy to add Coinbase, Binance, etc. later)
2. **Battle-tested**: Industry standard with extensive production usage
3. **Active maintenance**: Regular updates for exchange API changes
4. **TypeScript support**: Good type definitions available
5. **Rate limiting**: Built-in rate limit handling
6. **Symbol normalization**: Handles exchange-specific symbol formats

### Caveats

- **Symbol Format**: BloFin uses `BTC/USDT:USDT` format for perps (base/quote:settlement)
- **Rate Limits**: ccxt handles this automatically with `enableRateLimit: true`
- **No API Keys**: Public endpoints only (OHLCV and ticker data)
- **Error Handling**: Graceful fallback to demo data if real fetch fails

---

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# Price feed source: "demo" (mock data) or "blofin" (real BloFin exchange data)
AFI_PRICE_FEED_SOURCE=demo

# BloFin API base URL (optional, uses ccxt default if not set)
# BLOFIN_API_BASE_URL=https://api.blofin.com
```

### Enabling BloFin Sourcing

1. Set `AFI_PRICE_FEED_SOURCE=blofin` in your `.env` file
2. Restart the server: `npm run start:demo`
3. Check the startup log for: `Price Feed: blofin (real BloFin exchange data)`

---

## Verification

### 1. Check Server Startup Log

```bash
npm run start:demo
```

Look for:
```
BloFin Test Endpoints (dev/demo only):
  GET  /test/blofin/ohlcv?symbol=BTC/USDT:USDT&timeframe=1h&limit=50
  GET  /test/blofin/ticker?symbol=BTC/USDT:USDT
  GET  /test/blofin/status

Price Feed: demo (mock data)
```

### 2. Test BloFin Endpoints

```bash
# Check adapter status
curl "http://localhost:8080/test/blofin/status" | jq .

# Get real-time ticker
curl "http://localhost:8080/test/blofin/ticker?symbol=BTC/USDT:USDT" | jq .

# Get OHLCV candles
curl "http://localhost:8080/test/blofin/ohlcv?symbol=BTC/USDT:USDT&timeframe=1h&limit=10" | jq .
```

### 3. Confirm Froggy Uses BloFin

Set `AFI_PRICE_FEED_SOURCE=blofin` and run the full pipeline. Check the enrichment logs:

```
✅ Enrichment: Fetched real price data from blofin
```

### 4. Inspect TSSD Vault Metadata

If MongoDB is configured, check the TSSD vault documents for:

```json
{
  "market": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "market": "perp",
    "priceSource": "blofin",
    "venueType": "crypto_perps"
  }
}
```

---

## Next Steps (Future Phases)

### Phase 2: Add Coinbase Adapter
- Implement `CoinbasePriceFeedAdapter` using ccxt
- Register in `priceFeedRegistry.ts`
- Add to `listAvailablePriceSources()`

### Phase 3: Multi-Venue Strategy Support
- Allow strategies to specify preferred venues
- Fallback logic if primary venue is unavailable
- Venue-specific configuration in strategy metadata

### Phase 4: Validator/Enrichment Venue Override
- Allow validator profiles to override venue selection
- Enrichment profiles can specify data sources
- Per-signal venue routing logic

### Phase 5: AFI Console Integration
- UI for selecting price feed source
- Real-time venue status monitoring
- Historical data source tracking

### Phase 6: Execution Integration
- Wire execution sim to real exchange APIs (read-only order book)
- Add execution venue selection (separate from price feed venue)
- Emissions coordinator integration

---

## Technical Notes

### Price Source Metadata Flow

1. **Enrichment Stage**: Fetches real data, attaches `_priceFeedMetadata` to enriched signal
2. **Demo Service**: Reads metadata and includes in TSSD vault document
3. **TSSD Vault**: Stores `priceSource` and `venueType` for provenance

### Why `_priceFeedMetadata`?

We use a separate property (not part of `enrichmentMeta`) because:
- `FroggyEnrichedView` type is defined in afi-core (separate repo)
- Cannot modify afi-core types from afi-reactor (strict repo boundaries)
- Type assertion allows us to attach metadata without breaking type safety

### Symbol Format Mapping

Different exchanges use different symbol formats:
- **BloFin Perps**: `BTC/USDT:USDT` (base/quote:settlement)
- **BloFin Spot**: `BTC/USDT` (base/quote)
- **Coinbase**: `BTC-USD` (base-quote)

Future work: Add symbol normalization layer to handle this transparently.

---

## Conclusion

✅ **BloFin integration is complete and working!**

- Real price data flows through the Froggy pipeline
- Provenance tracking in TSSD vault
- Test endpoints for manual verification
- Clean adapter pattern for future exchanges
- Graceful fallback to demo data

**Next**: Add Coinbase adapter and multi-venue support.

