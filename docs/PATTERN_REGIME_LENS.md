# Pattern Regime Lens

## Overview

The **Pattern Regime Lens** extends AFI's pattern recognition beyond intra-timeframe candlestick patterns to include **multi-day market regime context**. This provides Froggy and other analysts with a broader view of market conditions when interpreting patterns.

## What is PatternRegimeSummary?

`PatternRegimeSummary` is an optional field in the `PatternLensV1` payload that provides:

- **Cycle Phase**: Where we are in the market cycle (early/mid/late bull, bear, sideways, capitulation, accumulation, euphoria)
- **Trend State**: Current trend direction (uptrend, downtrend, range, choppy)
- **Volatility Regime**: Current volatility level (low, normal, high, extreme)
- **Top/Bottom Risk**: Assessment of elevated risk at market extremes (top_risk, bottom_risk, neutral)
- **External Sentiment**: Fear & Greed Index overlay for sentiment context

## Data Sources

The regime lens uses **public, keyless APIs** (no authentication required):

### 1. CoinGecko API
- **Purpose**: Daily OHLC data for trend and volatility analysis
- **Endpoint**: `GET /coins/{id}/ohlc?vs_currency=usd&days=90`
- **Docs**: https://www.coingecko.com/en/api/documentation
- **Rate Limits**: 10-50 calls/minute (free tier)
- **Fail-soft**: Returns null if unavailable

### 2. Alternative.me Fear & Greed Index
- **Purpose**: External sentiment indicator (0-100 scale)
- **Endpoint**: `GET https://api.alternative.me/fng/?limit=90&format=json`
- **Docs**: https://alternative.me/crypto/fear-and-greed-index/
- **Rate Limits**: Generous (no documented limits)
- **Fail-soft**: Regime computed without sentiment overlay if unavailable

### 3. Blockchain.com Charts (Future/Optional)
- **Purpose**: On-chain metrics (transaction rate, hash rate, etc.)
- **Status**: Not yet implemented (infrastructure ready for future addition)
- **Docs**: https://api.blockchain.info/charts

## How It Works

### Computation Flow

1. **Symbol Mapping**: Trading symbol (e.g. "BTCUSDT") → CoinGecko coin ID (e.g. "bitcoin")
2. **Data Fetch**: Parallel fetch of 90 days OHLC + Fear & Greed history
3. **Trend Analysis**: Compute EMA-20 and EMA-50 to classify trend state
4. **Volatility Analysis**: Compute 30-day realized volatility (annualized)
5. **Price Position**: Determine where current price sits in 90-day range
6. **Regime Classification**: Combine trend, volatility, price position, and Fear & Greed to classify cycle phase
7. **Risk Assessment**: Flag top_risk or bottom_risk based on extremes

### Regime Classification Logic

**Late Bull / Top Risk**:
- Price near 90d highs (>85% of range)
- Uptrend confirmed
- Fear & Greed ≥ 70 (greed/extreme greed)

**Euphoria**:
- Price at 90d highs (>95% of range)
- Fear & Greed ≥ 85 (extreme greed)
- High volatility

**Capitulation / Bottom Risk**:
- Price near 90d lows (<15% of range)
- Downtrend confirmed
- Fear & Greed ≤ 30 (fear/extreme fear)

**Accumulation**:
- Price in lower range (<30%)
- Range-bound or choppy
- Fear & Greed ≤ 40 (fear)

**Mid Bull**:
- Healthy uptrend
- Price in middle range (40-80%)
- Normal volatility

**Early Bull**:
- Uptrend starting from lows
- Price <50% of range
- Fear & Greed <60

**Bear**:
- Downtrend confirmed
- Price <60% of range

**Sideways**:
- Range-bound or choppy price action

## BTC-Centric Design

**Current Limitation**: The regime lens is **BTC-centric** for now. This means:

- All symbols (BTCUSDT, ETHUSDT, etc.) map to their respective CoinGecko IDs
- However, the regime classification logic is optimized for Bitcoin's market cycles
- For altcoins, the regime provides a "global market context" rather than asset-specific regime

**Future Enhancement**: Asset-specific regime logic could be added by:
- Adjusting thresholds per asset class
- Incorporating asset-specific on-chain metrics
- Using correlation analysis to determine if asset follows BTC or has independent regime

## Integration with Froggy Pipeline

The regime lens is computed during the **enrichment stage** and attached to the pattern lens:

```typescript
// In froggy-enrichment-adapter.plugin.ts
const regimeSummary = await computePatternRegimeSummary(
  symbol,
  timeframe
);

if (regimeSummary && patternLensPayload) {
  patternLensPayload.regime = regimeSummary;
}
```

The enrichment summary includes regime context:

```
Pattern: pin bar. Regime: late_bull (uptrend, high vol, extreme_greed)
```

## Example Output

```json
{
  "type": "pattern",
  "version": "v1",
  "payload": {
    "pinBar": true,
    "patternName": "pin_bar",
    "patternConfidence": 75,
    "regime": {
      "cyclePhase": "late_bull",
      "trendState": "uptrend",
      "volRegime": "high",
      "topBottomRisk": "top_risk",
      "externalLabels": {
        "fearGreedValue": 82,
        "fearGreedLabel": "extreme_greed",
        "notes": "FG=82 (extreme_greed). Price at 92% of 90d range. Elevated top risk."
      }
    }
  }
}
```

## Backward Compatibility

All regime fields are **optional**. Existing code that only uses candlestick pattern fields will continue to work unchanged. The regime field is additive and does not break any existing functionality.

## Testing

See `test/enrichment/patternRegimeProfile.test.ts` for comprehensive test coverage including:
- Late bull / top risk scenarios
- Capitulation / bottom risk scenarios
- Sideways / neutral scenarios
- API failure handling
- Insufficient data handling

## Future Enhancements

1. **Blockchain.com Integration**: Add on-chain metrics (hash rate, transaction volume, etc.)
2. **Asset-Specific Regimes**: Customize thresholds and logic per asset class
3. **Multi-Timeframe Regime**: Combine daily, weekly, and monthly regime views
4. **Regime Transitions**: Detect and flag regime changes (e.g. mid_bull → late_bull)
5. **Historical Regime Accuracy**: Track regime classification accuracy over time

