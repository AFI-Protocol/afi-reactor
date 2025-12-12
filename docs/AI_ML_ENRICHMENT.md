# AI/ML Enrichment (Tiny Brains Integration)

## Overview

Froggy's enrichment pipeline now supports an optional **AI/ML enrichment lane** powered by an external Python microservice called **Tiny Brains**. This integration provides ML-based predictions that can be used as additional context for signal analysis.

**Important:**
- The `aiMl` field is **optional** and **read-only context** for now.
- **UWR (Universal Weighting Rule) scoring does NOT currently depend on this field.**
- **Froggy strategy logic (e.g., trend_pullback_v1) does NOT currently use this field.**
- This is a **future integration point** for ML-based signals.

---

## Architecture

### Tiny Brains Service

The Tiny Brains service is a separate Python microservice that:
- Receives enrichment context (technical, pattern, sentiment, newsFeatures)
- Runs ML models to generate predictions
- Returns predictions in the `FroggyAiMlV1` format

**Service Endpoint:**
```
POST {TINY_BRAINS_URL}/predict/froggy
```

**Request Headers:**
```
Content-Type: application/json
X-AFI-Client: afi-reactor-froggy-v1
```

**Request Body:**
```json
{
  "signalId": "signal-001",
  "symbol": "BTCUSDT",
  "timeframe": "1h",
  "traceId": "signal-001",
  "technical": { ... },
  "pattern": { ... },
  "sentiment": { ... },
  "newsFeatures": { ... }
}
```

**Response Body (FroggyAiMlV1):**
```json
{
  "convictionScore": 0.85,
  "direction": "long",
  "regime": "bull",
  "riskFlag": false,
  "notes": "Strong uptrend detected by ensemble model"
}
```

### Integration Flow

1. **Enrichment Profile Check**: If `aiMl.enabled === true` in the enrichment profile
2. **Service Availability Check**: If `TINY_BRAINS_URL` is set in environment
3. **Build Input**: Create lightweight snapshot of enrichment context
4. **Call Service**: POST to `/predict/froggy` with 1.5s timeout
5. **Attach Result**: If successful, attach to `FroggyEnrichedView.aiMl`
6. **Fail-Soft**: If service unavailable or errors, continue without `aiMl`

### Observability

The Tiny Brains integration includes built-in observability features for service-side monitoring and debugging:

#### **Client Identification Header**
Every request to the Tiny Brains service includes the following header:
```
X-AFI-Client: afi-reactor-froggy-v1
```

This allows the Tiny Brains service to:
- Identify requests coming from the Froggy enrichment pipeline
- Track client versions for compatibility monitoring
- Apply client-specific rate limiting or routing if needed

#### **Trace ID Passthrough**
Every request includes a `traceId` field in the JSON payload:
```json
{
  "signalId": "signal-001",
  "traceId": "signal-001",
  ...
}
```

**Behavior:**
- Currently, `traceId` defaults to the `signalId` value (no separate trace infrastructure yet)
- Future: If AFI implements distributed tracing (e.g., OpenTelemetry), this field will carry the trace context
- The Tiny Brains service can use this field to correlate predictions with upstream signal processing

**Use cases:**
- Debugging: Trace a specific signal's journey through enrichment → ML prediction → validation
- Performance analysis: Correlate ML prediction latency with signal characteristics
- Error investigation: Link failed predictions back to the originating signal

---

## Configuration

### Environment Variables

Add to your `.env` file:

```env
# Base URL for Tiny Brains AI/ML microservice (optional)
# If set, Froggy enrichment will call this service to get ML predictions
# If not set or unavailable, enrichment continues without aiMl data (fail-soft)
TINY_BRAINS_URL=http://localhost:8090
```

**Optional:**
- If `TINY_BRAINS_URL` is not set, AI/ML enrichment is skipped (no error)
- If the service is unreachable, enrichment continues without `aiMl` (fail-soft)

### Enrichment Profile

Enable AI/ML enrichment in your enrichment profile:

```typescript
const enrichmentProfile = {
  technical: { enabled: true },
  pattern: { enabled: true },
  sentiment: { enabled: true },
  news: { enabled: true },
  aiMl: { enabled: true }, // Enable Tiny Brains integration
};
```

Or use the `FROGGY_MAX_ENRICHMENT_PROFILE` preset (which has `aiMl` disabled by default):

```typescript
import { FROGGY_MAX_ENRICHMENT_PROFILE } from "./src/config/enrichmentProfiles.js";

// Override to enable aiMl
const profile = {
  ...FROGGY_MAX_ENRICHMENT_PROFILE,
  aiMl: { enabled: true },
};
```

---

## Usage Example

### Local Development

1. **Start Tiny Brains service** (separate Python microservice):
   ```bash
   cd tiny-brains-service
   python -m uvicorn main:app --host 0.0.0.0 --port 8090
   ```

2. **Configure afi-reactor**:
   ```bash
   # In afi-reactor/.env
   TINY_BRAINS_URL=http://localhost:8090
   ```

3. **Enable aiMl in enrichment profile**:
   ```typescript
   const profile = {
     technical: { enabled: true },
     pattern: { enabled: true },
     sentiment: { enabled: false },
     news: { enabled: false },
     aiMl: { enabled: true }, // Enable Tiny Brains
   };
   ```

4. **Run enrichment**:
   ```bash
   curl -X POST "http://localhost:8080/test/enrichment" \
     -H "Content-Type: application/json" \
     -d '{
       "signalId": "test-001",
       "symbol": "BTCUSDT",
       "timeframe": "1h",
       "enrichmentProfile": {
         "technical": { "enabled": true },
         "pattern": { "enabled": true },
         "aiMl": { "enabled": true }
       }
     }'
   ```

5. **Check output**:
   ```json
   {
     "output": {
       "signalId": "test-001",
       "symbol": "BTCUSDT",
       "aiMl": {
         "convictionScore": 0.85,
         "direction": "long",
         "regime": "bull",
         "riskFlag": false,
         "notes": "Strong uptrend detected"
       }
     }
   }
   ```

---

## Fail-Soft Behavior

The AI/ML enrichment is designed to **never break** the enrichment pipeline:

- ✅ **Service not configured** (`TINY_BRAINS_URL` unset): Skip AI/ML, continue enrichment
- ✅ **Service unreachable** (network error): Log debug message, continue without `aiMl`
- ✅ **Service timeout** (>1.5s): Abort request, continue without `aiMl`
- ✅ **Service error** (non-2xx response): Log warning, continue without `aiMl`
- ✅ **Invalid response** (missing required fields): Log warning, continue without `aiMl`

**Result:** Enrichment always succeeds, with or without AI/ML data.

---

## Future Integration

The `aiMl` field is currently **read-only context**. Future work may include:

1. **UWR Integration**: Use `convictionScore` or `riskFlag` in UWR scoring
2. **Strategy Integration**: Use `direction` or `regime` hints in Froggy strategies
3. **Validator Integration**: Use `riskFlag` in Val Dook's validation logic
4. **Multi-Model Ensemble**: Support multiple Tiny Brains models with different specializations

For now, the field is available for **experimentation and analysis** without affecting production behavior.

