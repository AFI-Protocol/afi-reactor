# Price Feed Architecture

**Last Updated**: 2025-12-10  
**Status**: Active Development

---

## Overview

AFI Reactor supports multiple price feed sources for real-time market data. The architecture is designed to be extensible, allowing new exchanges to be added without modifying core pipeline logic.

**Supported Exchanges**:
- **demo** - Mock data generator (no external API calls)
- **blofin** - BloFin exchange (spot + perpetual futures)
- **coinbase** - Coinbase exchange (spot markets)

---

## Architecture Components

### 1. Price Feed Selection

Price feed source is controlled via environment variable:

```bash
export AFI_PRICE_FEED_SOURCE=demo      # Mock data (default)
export AFI_PRICE_FEED_SOURCE=blofin    # BloFin exchange
export AFI_PRICE_FEED_SOURCE=coinbase  # Coinbase exchange
```

**Selection Flow**:
```
Environment Variable (AFI_PRICE_FEED_SOURCE)
  ↓
priceFeedRegistry.getDefaultPriceSource()
  ↓
priceFeedRegistry.getPriceFeedAdapter(source)
  ↓
Concrete Adapter (BloFinPriceFeedAdapter | CoinbasePriceFeedAdapter | DemoPriceFeedAdapter)
```

### 2. Symbol Registry

**Location**: `src/adapters/symbolRegistry.ts`

**Purpose**: Centralized symbol normalization between AFI canonical format and venue-specific formats.

**AFI Canonical Format**: `"BTC/USDT"`, `"ETH/USDC"` (BASE/QUOTE)

**Venue-Specific Formats**:
- **BloFin Spot**: `"BTC/USDT"` (same as canonical)
- **BloFin Perps**: `"BTC/USDT:USDT"` (BASE/QUOTE:SETTLEMENT)
- **Coinbase**: `"BTC-USDT"` (hyphen instead of slash)
- **Demo**: `"BTC/USDT"` (same as canonical)

**Key Functions**:
```typescript
// Convert AFI canonical → venue-specific
toVenueSymbol({ venue: 'blofin', canonical: 'BTC/USDT', marketType: 'perp' })
// Returns: "BTC/USDT:USDT"

// Convert venue-specific → AFI canonical
fromVenueSymbol({ venue: 'blofin', venueSymbol: 'BTC/USDT:USDT' })
// Returns: "BTC/USDT"
```

### 3. Provenance Metadata

**Purpose**: Track data lineage for audit and debugging.

**Required Fields** (enforced at runtime):
- `priceSource` - Which adapter provided the data (e.g., "blofin", "coinbase", "demo")
- `venueType` - Type of market venue (e.g., "crypto_spot", "crypto_perps", "demo")
- `marketType` - Market type (e.g., "spot", "perp", "futures")

**Flow**:
```
Price Feed Adapter
  ↓
Enrichment Plugin (froggy-enrichment-adapter.plugin.ts)
  ↓
_priceFeedMetadata = { priceSource, venueType, marketType }
  ↓
Froggy Demo Service (froggyDemoService.ts)
  ↓
TSSD Vault Write (MongoDB)
```

**Validation**: TSSD vault writes are **blocked** if provenance metadata is missing.

### 4. Adapter Interface

**Location**: `src/adapters/exchanges/types.ts`

All price feed adapters must implement:

```typescript
interface PriceFeedAdapter {
  id: string;                    // e.g., "blofin", "coinbase"
  name: string;                  // e.g., "BloFin", "Coinbase"
  supportsPerps: boolean;        // Supports perpetual futures?
  supportsSpot: boolean;         // Supports spot markets?
  
  getOHLCV(params): Promise<OHLCVCandle[]>;
  getTicker(symbol): Promise<TickerSnapshot>;
}
```

### 5. Price Feed Registry

**Location**: `src/adapters/exchanges/priceFeedRegistry.ts`

**Purpose**: Central registry mapping price source IDs to adapter instances.

```typescript
const PRICE_FEED_ADAPTERS = {
  blofin: blofinPriceFeedAdapter,
  coinbase: coinbasePriceFeedAdapter,
  demo: demoPriceFeedAdapter,
};
```

**Key Functions**:
- `getPriceFeedAdapter(source)` - Get adapter by ID
- `getDefaultPriceSource()` - Read from env var
- `listAvailablePriceSources()` - List all registered adapters

---

## Demo vs Real Exchanges

### Demo Mode
- **Purpose**: Development and testing without external API calls
- **Data**: Plausible mock data (randomized but realistic)
- **Provenance**: `priceSource: "demo"`, `venueType: "demo"`
- **Use Case**: Local development, CI/CD, unit tests

### Real Exchanges (BloFin, Coinbase)
- **Purpose**: Production-grade price data
- **Data**: Real-time market data via ccxt library
- **Provenance**: `priceSource: "blofin"` or `"coinbase"`, `venueType: "crypto_spot"` or `"crypto_perps"`
- **Use Case**: Live signals, backtesting with real data, production

---

## Adding a New Exchange

To add a new exchange (e.g., Binance):

1. **Create Adapter**: `src/adapters/exchanges/binancePriceFeedAdapter.ts`
2. **Implement Interface**: Implement `PriceFeedAdapter` interface
3. **Register Adapter**: Add to `priceFeedRegistry.ts`
4. **Update Symbol Registry**: Add venue-specific symbol mapping
5. **Add Test Endpoints**: Create `src/routes/binanceTestEndpoints.ts`
6. **Update Docs**: Add to this file and create quick reference guide

---

## Related Documentation

- **BloFin Quick Reference**: `docs/BLOFIN_QUICK_REFERENCE.md`
- **Coinbase Quick Reference**: `docs/COINBASE_QUICK_REFERENCE.md`
- **Provenance Hardening**: `docs/BLOFIN_PROVENANCE_HARDENING.md`
- **Market Type Mapping**: `docs/MARKET_TYPE_MAPPING.md`
- **Symbol Registry**: `src/adapters/symbolRegistry.ts`

