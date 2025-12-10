# Market Type & Venue Type Mapping

## Overview

This document describes how AFI Reactor normalizes market types and maps them to venue types for TSSD vault provenance tracking.

**Date**: December 10, 2025  
**Phase**: BloFin Integration - Market Type Hardening

---

## Problem Statement

**Before**: The `/demo/afi-eliza-demo` endpoint had hardcoded `market: "spot"`, which meant:
- Request payload `"market": "perp"` → TSSD document showed `Market Type: spot`, `Venue Type: crypto_spot` ❌
- No way to test perp or futures signals
- Incorrect provenance tracking for different market types

**After**: Request body is now respected, and market types are normalized consistently:
- Request payload `"market": "perp"` → TSSD document shows `Market Type: perp`, `Venue Type: crypto_perps` ✅
- Request payload `"market": "spot"` → TSSD document shows `Market Type: spot`, `Venue Type: crypto_spot` ✅

---

## Market Type Flow

### Request → Internal → TSSD

```
HTTP Request Body
  ↓
  "market": "perp" | "spot" | "futures"
  ↓
POST /demo/afi-eliza-demo (src/server.ts)
  ↓
  req.body.market → payload.market
  ↓
runFroggyTrendPullbackFromTradingView (src/services/froggyDemoService.ts)
  ↓
  payload.market → alphaDraft.market
  ↓
Froggy Enrichment Adapter (plugins/froggy-enrichment-adapter.plugin.ts)
  ↓
  normalizeMarketType(meta.market) → "spot" | "perp" | "futures"
  ↓
  mapMarketTypeToVenueType(marketType) → "crypto_spot" | "crypto_perps" | "crypto_futures"
  ↓
  _priceFeedMetadata.marketType = normalizedMarketType
  _priceFeedMetadata.venueType = venueType
  ↓
TSSD Vault Write (src/services/froggyDemoService.ts)
  ↓
  market.market = marketType
  market.venueType = venueType
  ↓
MongoDB: afi.tssd_signals
```

---

## Normalization Logic

### Market Type Normalization

**Location**: `src/utils/marketUtils.ts`

**Function**: `normalizeMarketType(input?: string): AfiMarketType`

**Supported Inputs**:
- `"perp"`, `"perps"`, `"perpetual"` → `"perp"`
- `"spot"` → `"spot"`
- `"futures"`, `"future"` → `"futures"`
- `undefined`, `null`, `""` → `"spot"` (default)
- Unknown values → `"spot"` (default with warning)

**Output**: `"spot" | "perp" | "futures"`

---

### Venue Type Mapping

**Location**: `src/utils/marketUtils.ts`

**Function**: `mapMarketTypeToVenueType(marketType: AfiMarketType, isDemo: boolean): VenueType`

**Mapping**:
- `"spot"` → `"crypto_spot"`
- `"perp"` → `"crypto_perps"`
- `"futures"` → `"crypto_futures"`
- `isDemo=true` → `"demo"` (overrides market type)

**Output**: `"crypto_spot" | "crypto_perps" | "crypto_futures" | "demo"`

---

## Files Changed

### 1. **src/utils/marketUtils.ts** (NEW)
- Centralized market type normalization
- Venue type mapping logic
- Type definitions: `AfiMarketType`, `VenueType`

### 2. **src/server.ts**
- Changed `/demo/afi-eliza-demo` endpoint to read from `req.body` instead of hardcoded values
- Now respects: `symbol`, `market`, `timeframe`, `strategy`, `direction` from request

### 3. **plugins/froggy-enrichment-adapter.plugin.ts**
- Import `normalizeMarketType` and `mapMarketTypeToVenueType`
- Use normalized market type in enriched output
- Attach `marketType` to `_priceFeedMetadata` for TSSD

### 4. **src/services/froggyDemoService.ts**
- Extract `marketType` from `_priceFeedMetadata`
- Write normalized `marketType` to TSSD `market.market` field

---

## Testing

### Test 1: Perp Market

**Request**:
```bash
curl -X POST "http://localhost:8080/demo/afi-eliza-demo" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "DOGE/USDT",
    "timeframe": "4h",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "short",
    "market": "perp"
  }'
```

**TSSD Document** (verified via `npm run verify:tssd:blofin`):
```
Market:
  Symbol:        DOGE/USDT
  Timeframe:     4h
  Market Type:   perp ✅
  Price Source:  blofin ✅
  Venue Type:    crypto_perps ✅
```

---

### Test 2: Spot Market

**Request**:
```bash
curl -X POST "http://localhost:8080/demo/afi-eliza-demo" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "ADA/USDT",
    "timeframe": "15m",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long",
    "market": "spot"
  }'
```

**TSSD Document**:
```
Market:
  Symbol:        ADA/USDT
  Timeframe:     15m
  Market Type:   spot ✅
  Price Source:  blofin ✅
  Venue Type:    crypto_spot ✅
```

---

## Verification Commands

```bash
# 1. Start server with BloFin mode
export AFI_MONGO_URI="mongodb+srv://..."
export AFI_PRICE_FEED_SOURCE=blofin
npm run build
npm run start:demo

# 2. Send test signals (in another terminal)
# Perp signal
curl -X POST "http://localhost:8080/demo/afi-eliza-demo" \
  -H "Content-Type: application/json" \
  -d '{"symbol": "BTC/USDT", "market": "perp", "timeframe": "1h", "strategy": "froggy_trend_pullback_v1", "direction": "long"}'

# Spot signal
curl -X POST "http://localhost:8080/demo/afi-eliza-demo" \
  -H "Content-Type: application/json" \
  -d '{"symbol": "ETH/USDT", "market": "spot", "timeframe": "1h", "strategy": "froggy_trend_pullback_v1", "direction": "long"}'

# 3. Verify TSSD documents
npm run verify:tssd:blofin
```

---

## Summary

✅ **Market type normalization** is centralized in `src/utils/marketUtils.ts`  
✅ **Venue type mapping** is deterministic and consistent  
✅ **Request body** is now respected by `/demo/afi-eliza-demo` endpoint  
✅ **TSSD documents** correctly reflect market type and venue type  
✅ **Provenance tracking** is complete: `priceSource`, `venueType`, `marketType`

**No breaking changes** to existing demo behavior - defaults to "spot" if not specified.

