# BloFin Integration - Quick Reference

**Last Updated**: 2025-12-10

---

## Environment Variables

```bash
# Price feed source (required)
export AFI_PRICE_FEED_SOURCE=demo      # Use mock data
export AFI_PRICE_FEED_SOURCE=blofin    # Use real BloFin exchange data
export AFI_PRICE_FEED_SOURCE=coinbase  # Use real Coinbase exchange data (spot only)

# MongoDB connection (optional - enables TSSD vault)
export AFI_MONGO_URI=mongodb://localhost:27017/afi
export AFI_MONGO_DB_NAME=afi
export AFI_MONGO_COLLECTION_TSSD=tssd_signals
```

---

## Quick Start

### Demo Mode (No MongoDB Required)

```bash
cd ~/AFI_Modular_Repos/afi-reactor
export AFI_PRICE_FEED_SOURCE=demo
npm run build
npm run start:demo
```

### BloFin Mode (Real Exchange Data)

```bash
cd ~/AFI_Modular_Repos/afi-reactor
export AFI_PRICE_FEED_SOURCE=blofin
npm run build
npm run start:demo
```

### With MongoDB Vault

```bash
# 1. Start MongoDB (Docker)
docker run -d --name afi-mongo -p 27017:27017 mongo:7

# 2. Configure and run
export AFI_MONGO_URI=mongodb://localhost:27017/afi
export AFI_PRICE_FEED_SOURCE=blofin
npm run build
npm run start:demo
```

---

## Test Endpoints

### BloFin Test Endpoints

```bash
# Check BloFin adapter status
curl "http://localhost:8080/test/blofin/status" | jq .

# Get BTC ticker
curl "http://localhost:8080/test/blofin/ticker?symbol=BTC/USDT" | jq .

# Get BTC OHLCV candles
curl "http://localhost:8080/test/blofin/ohlcv?symbol=BTC/USDT&timeframe=1h&limit=5" | jq .
```

### Full Pipeline Test

```bash
curl -X POST "http://localhost:8080/demo/afi-eliza-demo" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long",
    "market": "perp"
  }' | jq .
```

---

## MongoDB Verification

```bash
# Verify BloFin-backed signals in TSSD vault
npm run verify:tssd:blofin
```

**Expected Output** (if signals exist):
```
✅ Found 1 BloFin-backed signal(s)

📄 Signal #1
  Signal ID:       alpha-...
  Price Source:    blofin ✅
  Venue Type:      crypto_perps ✅
```

**Expected Output** (if no signals):
```
⚠️  No BloFin-backed TSSD documents found.
```

---

## Symbol Formats

### AFI Canonical Format
```
BTC/USDT
ETH/USDC
SOL/USDT
```

### BloFin Perp Format (Auto-Converted)
```
BTC/USDT:USDT
ETH/USDC:USDC
SOL/USDT:USDT
```

**Note**: Symbol normalization happens automatically via the symbol registry. Always use AFI canonical format in API calls.

---

## Provenance Metadata

All signals in TSSD vault include:

```json
{
  "market": {
    "symbol": "BTC/USDT",
    "timeframe": "1h",
    "market": "perp",
    "priceSource": "blofin",        // ✅ Required
    "venueType": "crypto_perps"     // ✅ Required
  }
}
```

**Validation**: TSSD vault writes are **blocked** if `priceSource` or `venueType` is missing.

---

## Common Issues

### "Price Feed: demo" when expecting BloFin

**Cause**: `AFI_PRICE_FEED_SOURCE` not set or set incorrectly.

**Solution**:
```bash
export AFI_PRICE_FEED_SOURCE=blofin
npm run start:demo
```

### "TSSD vault disabled: AFI_MONGO_URI not set"

**Cause**: MongoDB not configured.

**Solution**: See `docs/MONGO_SETUP.md` for MongoDB setup instructions.

### "No BloFin-backed TSSD documents found"

**Cause**: No signals have been processed yet, or MongoDB is empty.

**Solution**: Trigger a signal via `/demo/afi-eliza-demo` endpoint (see Full Pipeline Test above).

---

## File Locations

### Core Files
- **BloFin Adapter**: `src/adapters/exchanges/blofinPriceFeedAdapter.ts`
- **Symbol Registry**: `src/adapters/symbolRegistry.ts`
- **TSSD Schema**: `src/types/TssdSignalDocument.ts`
- **Froggy Service**: `src/services/froggyDemoService.ts`
- **Enrichment Plugin**: `plugins/froggy-enrichment-adapter.plugin.ts`

### Documentation
- **Provenance Hardening**: `docs/BLOFIN_PROVENANCE_HARDENING.md`
- **Validation Report**: `docs/BLOFIN_VALIDATION_REPORT.md`
- **MongoDB Setup**: `docs/MONGO_SETUP.md`
- **Quick Reference**: `docs/BLOFIN_QUICK_REFERENCE.md` (this file)

### Scripts
- **MongoDB Verification**: `scripts/verify-tssd-blofin.ts`

---

## NPM Scripts

```bash
npm run build                  # Build TypeScript
npm run start:demo             # Start AFI Reactor server
npm run verify:tssd:blofin     # Verify MongoDB TSSD documents
```

---

## Next Steps

1. **Set up MongoDB**: See `docs/MONGO_SETUP.md`
2. **Run BloFin mode**: `export AFI_PRICE_FEED_SOURCE=blofin && npm run start:demo`
3. **Trigger signals**: Use `/demo/afi-eliza-demo` endpoint
4. **Verify vault**: `npm run verify:tssd:blofin`
5. **Add more exchanges**: Extend `src/adapters/symbolRegistry.ts`

---

## Support

For detailed information, see:
- **Full Documentation**: `docs/BLOFIN_PROVENANCE_HARDENING.md`
- **MongoDB Setup**: `docs/MONGO_SETUP.md`
- **Validation Report**: `docs/BLOFIN_VALIDATION_REPORT.md`

