# AFI-Reactor HTTP Webhook Server

## Overview

The AFI-Reactor HTTP webhook server is a **dev/demo-only** HTTP API that exposes the Froggy trend-pullback pipeline via webhook endpoints. It is designed for:

- **TradingView alerts**: Receive Pine Script alerts and run them through the Froggy pipeline
- **Local testing**: Test the complete pipeline without ElizaOS or other agent frameworks
- **Demos**: Show the Froggy pipeline in action with real-time webhook calls

⚠️ **DEV/DEMO ONLY**: This server does NOT execute real trades, mint AFI tokens, or connect to real exchanges. All execution is simulated.

---

## Quick Start

### 1. Build the project

```bash
npm run build
```

### 2. Start the server

```bash
npm run start:demo
```

The server will start on `http://localhost:8080` (or the port specified in `AFI_REACTOR_PORT` env var).

### 3. Test the health endpoint

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "afi-reactor",
  "froggyPipeline": "available"
}
```

---

## Endpoints

### GET /health

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "service": "afi-reactor",
  "froggyPipeline": "available"
}
```

---

### POST /api/webhooks/tradingview

TradingView webhook endpoint. Receives alert payloads and runs them through the Froggy trend-pullback pipeline.

**Request Body:**

```json
{
  "symbol": "BTCUSDT",
  "market": "perp",
  "timeframe": "15m",
  "strategy": "froggy_trend_pullback_v1",
  "direction": "long",
  "setupSummary": "15m bullish pullback into 4h trend",
  "notes": "Breaker block retest with volume spike",
  "enrichmentProfile": {
    "technical": { "enabled": true, "preset": "trend_pullback" },
    "pattern": { "enabled": true, "preset": "reversal_patterns" },
    "sentiment": { "enabled": false },
    "news": { "enabled": false },
    "aiMl": { "enabled": false }
  },
  "signalId": "optional-external-id",
  "secret": "optional-shared-secret"
}
```

**Required Fields:**

- `symbol` (string): Trading symbol (e.g., "BTCUSDT", "BTC/USDT")
- `timeframe` (string): Timeframe (e.g., "1m", "5m", "15m", "1h", "4h", "1d")
- `strategy` (string): Strategy identifier (e.g., "froggy_trend_pullback_v1")
- `direction` (string): Trade direction ("long", "short", or "neutral")

**Optional Fields:**

- `market` (string): Market type (default: "spot")
- `setupSummary` (string): Brief setup description
- `notes` (string): Additional notes
- `enrichmentProfile` (object): Enrichment configuration (see EnrichmentProfile spec)
- `signalId` (string): External signal ID (auto-generated if not provided)
- `secret` (string): Shared secret for webhook authentication

**Response:**

```json
{
  "signalId": "alpha-abc123",
  "validatorDecision": {
    "decision": "approve",
    "uwrConfidence": 0.85,
    "reasonCodes": ["score-high", "froggy-demo"]
  },
  "execution": {
    "status": "simulated",
    "type": "buy",
    "asset": "BTC/USDT",
    "amount": 0.01,
    "simulatedPrice": 55432.12,
    "timestamp": "2025-12-06T21:30:00.000Z",
    "notes": "Simulated BUY based on validator approval (confidence: 0.85)"
  },
  "meta": {
    "symbol": "BTCUSDT",
    "timeframe": "15m",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long",
    "source": "tradingview-webhook"
  },
  "uwrScore": 0.85
}
```

**Error Responses:**

- `400 Bad Request`: Missing required fields or invalid payload
- `401 Unauthorized`: Invalid shared secret (if `WEBHOOK_SHARED_SECRET` env var is set)
- `500 Internal Server Error`: Pipeline execution error

---

## Environment Variables

### AFI_REACTOR_PORT

Server port (default: `8080`).

```bash
export AFI_REACTOR_PORT=3000
npm run start:demo
```

### WEBHOOK_SHARED_SECRET

Optional shared secret for webhook authentication. If set, all webhook requests must include a matching `secret` field in the payload.

```bash
export WEBHOOK_SHARED_SECRET=my-secret-key
npm run start:demo
```

Then include the secret in webhook payloads:

```json
{
  "symbol": "BTCUSDT",
  "timeframe": "15m",
  "strategy": "froggy_trend_pullback_v1",
  "direction": "long",
  "secret": "my-secret-key"
}
```

---

## Example curl Commands

### Minimal payload (required fields only)

```bash
curl -X POST http://localhost:8080/api/webhooks/tradingview \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTCUSDT",
    "timeframe": "15m",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long"
  }'
```

### Full payload with enrichment profile

```bash
curl -X POST http://localhost:8080/api/webhooks/tradingview \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTCUSDT",
    "market": "perp",
    "timeframe": "15m",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long",
    "setupSummary": "Bullish pullback to EMA with liquidity sweep",
    "notes": "Strong volume spike on retest",
    "enrichmentProfile": {
      "technical": { "enabled": true, "preset": "trend_pullback" },
      "pattern": { "enabled": true, "preset": "reversal_patterns" },
      "sentiment": { "enabled": false },
      "news": { "enabled": false },
      "aiMl": { "enabled": false }
    }
  }'
```

### TA-only enrichment profile

```bash
curl -X POST http://localhost:8080/api/webhooks/tradingview \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "ETHUSDT",
    "timeframe": "1h",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "short",
    "enrichmentProfile": {
      "technical": { "enabled": true, "preset": "full_suite" },
      "pattern": { "enabled": true, "preset": "default" },
      "sentiment": { "enabled": false },
      "news": { "enabled": false },
      "aiMl": { "enabled": false }
    }
  }'
```

---

## TradingView Integration

To configure TradingView alerts to send webhooks to this server:

1. Create a Pine Script alert in TradingView
2. In the alert settings, set the webhook URL to: `http://your-server:8080/api/webhooks/tradingview`
3. In the alert message, use JSON format:

```
{
  "symbol": "{{ticker}}",
  "timeframe": "{{interval}}",
  "strategy": "froggy_trend_pullback_v1",
  "direction": "long",
  "setupSummary": "TradingView alert triggered",
  "notes": "Price: {{close}}, Volume: {{volume}}"
}
```

**Note**: For production use, you should:
- Deploy the server to a public endpoint (not localhost)
- Use HTTPS (not HTTP)
- Set `WEBHOOK_SHARED_SECRET` for authentication
- Implement rate limiting and request validation

---

## Pipeline Flow

The webhook endpoint runs the following pipeline:

1. **Alpha Scout Ingest** → Converts TradingView payload to reactor signal envelope
2. **Signal Structurer (Pixel Rick)** → Normalizes and validates signal
3. **Froggy Enrichment Adapter** → Adds technical/pattern/sentiment enrichment (honors EnrichmentProfile)
4. **Froggy Analyst** → Runs trend_pullback_v1 strategy from afi-core (UWR scoring)
5. **Validator Decision Evaluator (Val Dook)** → Approve/reject/flag based on UWR score
6. **Execution Agent Sim** → Simulates trade execution (dev/demo only)

---

## Troubleshooting

### Server won't start

- Check that port 8080 is not already in use
- Try a different port: `AFI_REACTOR_PORT=3000 npm run start:demo`

### 401 Unauthorized

- Check that `WEBHOOK_SHARED_SECRET` matches the `secret` field in your payload
- Or unset `WEBHOOK_SHARED_SECRET` to disable authentication

### 500 Internal Server Error

- Check server logs for detailed error messages
- Ensure all required plugins are built: `npm run build`

---

## Related Documentation

- [EnrichmentProfile Specification](../../afi-core/docs/ENRICHMENT_PROFILE_SPEC.v0.1.md)
- [Froggy Pipeline Tests](../test/froggyPipeline.test.ts)
- [AFI Orchestrator Doctrine](../AFI_ORCHESTRATOR_DOCTRINE.md)

---

**Version**: 1.0.0  
**Status**: Dev/Demo Only  
**Last Updated**: 2025-12-06

