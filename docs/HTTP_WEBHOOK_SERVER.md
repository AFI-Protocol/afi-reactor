# AFI-Reactor HTTP Webhook Server

## Overview

The AFI-Reactor HTTP webhook server is a **dev/demo-only** HTTP API that exposes the Froggy trend-pullback pipeline via webhook endpoints. It is designed for:

- **TradingView alerts**: Receive Pine Script alerts and run them through the Froggy pipeline
- **Local testing**: Test the complete pipeline without ElizaOS or other agent frameworks
- **Demos**: Show the Froggy pipeline in action with real-time webhook calls

⚠️ **DEV/DEMO ONLY**: This server does NOT execute trades, mint AFI tokens, or connect to real exchanges. It is **scored-only**: it returns a UWR-scored `ReactorScoredSignalV1` and performs no validator certification or execution (those are downstream / external responsibilities).

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
  "composition": "available"
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
  "composition": "available"
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

**Response:** Scored-only `ReactorScoredSignalV1`. The reactor returns a UWR score; it does **not** return a validator decision or an execution block (those are downstream / external responsibilities — see [Pipeline Flow](#pipeline-flow)).

```json
{
  "signalId": "froggy-abc123",
  "analystScore": {
    "uwrScore": 0.85,
    "uwrAxes": {
      "structure": 0.82,
      "execution": 0.88,
      "risk": 0.80,
      "insight": 0.90
    }
  },
  "scoredAt": "2025-12-06T21:30:00.000Z",
  "decayParams": {
    "halfLifeHours": 24
  },
  "meta": {
    "symbol": "BTCUSDT",
    "timeframe": "15m",
    "strategy": "froggy_trend_pullback_v1",
    "direction": "long",
    "source": "tradingview-webhook"
  }
}
```

The full envelope also carries `rawUss`, optional `lenses`, and optional `_priceFeedMetadata`. There is **no** `validatorDecision` and **no** `execution` field.

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

**Note**: For production use of the **dev/demo TradingView webhook**, you should:
- Deploy the server to a public endpoint (not localhost)
- Use HTTPS (not HTTP)
- Set `WEBHOOK_SHARED_SECRET` for authentication
- Implement rate limiting and request validation

This guidance concerns the dev/demo webhook. It does **not** apply to the direct
CPJ ingest route (`POST /api/ingest/cpj`), which is an internal trusted service
boundary and is not intended for direct public exposure — see
[Ingress trust boundaries](#ingress-trust-boundaries).

---

## Ingress trust boundaries

The Reactor is the **execution engine**, not a general public trust gateway. Two
ingress paths reach it, and they have different exposure postures.

- **`POST /api/webhooks/tradingview`** — the dev/demo webhook above; a Gateway
  client (`afi-gateway`, `POST /api/v1/signals`) is the intended structured-ingress
  front for it in a governed topology.
- **`POST /api/ingest/cpj`** — the direct community-provider-journal ingest, an
  **internal trusted service-to-service boundary**. It is **not** a public API,
  **not** an alternative public route around the Gateway, and **not** the
  designated public Institute oracle API. On this route, authentication is optional
  (a single shared secret via `WEBHOOK_SHARED_SECRET`, checked against a request-body
  field when set) and provider identity is self-asserted — which is exactly why it
  must not be exposed directly to the public internet.

**Designated public/partner posture.** Any future Institute-operated public or
partner CPJ access must terminate at a **separate authenticated oracle-ingress
boundary** — the designated AFI Research Institute oracle-ingress reference service,
or another conforming external trust boundary — which authenticates, registers
sources, and rate-limits before forwarding to this internal route:

```text
Institute or approved collector
  → Institute oracle-ingress service (auth · source registration · quotas · provider binding · validation · audit)
  → internal Reactor CPJ route (POST /api/ingest/cpj)
  → CPJ → USS → canonical AFI processing
```

That external oracle-ingress service is **designated, not implemented or deployed**.
This document does not change, rename, move, or expose the CPJ route — regardless of
exposure, provider-to-strategy binding, CPJ schema validation, and provenance
attribution remain **mandatory** on it, while ingest deduplication/replay protection is
opt-in (`AFI_INGEST_DEDUPE=1`) and off by default. See
[`AFI-GOV-AUTHORITY-INSTITUTE-REFERENCE-SERVICES-v0.1` (INST-GOV)](https://github.com/AFI-Protocol/afi-governance/blob/main/decisions/research-institute-reference-services-v0.1.md)
and the [reference-services spec](https://github.com/AFI-Protocol/afi-docs/blob/main/specs/AFI_RESEARCH_INSTITUTE_REFERENCE_SERVICES.v0.1.md).

---

## Pipeline Flow

The webhook endpoint runs the canonical **scored-only** pipeline. There is no hardcoded pipeline in source: the strategy is resolved from the provider binding (`src/config/strategyResolution.ts`), and the registered pipeline manifest is executed by the generic graph executor (`src/pipeline/executor.ts`) over the boot-validated registries (`src/config/runtimeComposition.ts`). The registered froggy composition enriches (technical+pattern ∥ sentiment+news → merge, optional AI/ML fail-soft), scores `trend_pullback_v1` from afi-core (UWR score), and persists the governed evidence record through the packaged afi-infra canonical store.

**Out of scope (not reactor stages):** Validator certification and trade execution are **downstream / external** concerns. The reactor emits a scored-only signal; external certification consumers and mint orchestration (`afi-mint`) act on it. Gateway clients submit drafts via the `SUBMIT_SIGNAL_DRAFT` action and retrieve the last scoring rationale via `EXPLAIN_LAST_DECISION`.

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
- [AGENTS.md](../AGENTS.md) — current architecture and constraints

---

**Version**: 1.0.0  
**Status**: Dev/Demo Only  
**Last Updated**: 2025-12-06

