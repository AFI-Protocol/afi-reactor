/**
 * AFI Reactor HTTP Server
 *
 * Reactor's responsibility: ingest → enrich → score → persist.
 *
 * Endpoints:
 *   - GET /health
 *   - POST /api/webhooks/tradingview
 *   - POST /api/ingest/cpj
 *
 * Returns ReactorScoredSignalV1:
 *   - signalId, analystScore, scoredAt, decayParams, lenses, rawUss
 *
 * NOT Reactor's responsibility:
 *   - Validator certification (moved to external certification layer)
 *   - Execution (moved to consumer/adapter layer)
 *   - Minting/emissions (moved to afi-mint)
 *
 * Environment variables:
 * - PORT: Server port (Render sets this automatically)
 * - AFI_REACTOR_PORT: Server port fallback (default: 8080)
 * - WEBHOOK_SHARED_SECRET: Optional shared secret for webhook authentication
 * - COINALYZE_API_KEY: Optional API key for Coinalyze perp sentiment data
 * - AFI_PRICE_FEED_SOURCE: Price feed source (demo, blofin, coinbase)
 *
 * @module server
 */

// ⚠️ CRITICAL: Load environment variables FIRST before any other imports
import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import {
  runFroggyTrendPullbackFromTradingView,
  runFroggyTrendPullbackFromCanonicalUss,
  type TradingViewAlertPayload,
} from "./services/froggyDemoService.js";
import { validateUsignalV11 } from "./uss/ussValidator.js";
import { mapTradingViewToUssV11 } from "./uss/tradingViewMapper.js";
import { validateCpjV01 } from "./cpj/cpjValidator.js";
import { mapCpjToUssV11 } from "./uss/cpjMapper.js";
import {
  initDedupeCache,
  checkDuplicate,
  recordIngest,
} from "./services/ingestDedupeService.js";
import { startTelegramCollector } from "./collectors/telegram/telegramCollector.js";
import { createMtprotoClientFromEnv } from "./collectors/telegram_mtproto/mtprotoClient.js";
import { startMtprotoCollector } from "./collectors/telegram_mtproto/mtprotoCollector.js";

const app = express();

// Initialize dedupe cache if enabled
initDedupeCache();

// Middleware
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next) => {
  console.log(`🔥 ${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// Test endpoints removed - Reactor is scoring-only

/**
 * Health check endpoint.
 * 
 * GET /health
 * 
 * Returns:
 * {
 *   "status": "ok",
 *   "service": "afi-reactor",
 *   "froggyPipeline": "available"
 * }
 */
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "afi-reactor",
    froggyPipeline: "available",
  });
});

/**
 * Debug endpoint to check environment variables (GATED: OFF by default).
 *
 * GET /debug/env
 *
 * Security: Only enabled when DEBUG_ENDPOINTS_ENABLED=true AND NODE_ENV !== production.
 * Shows only allowlisted keys with redacted values.
 */
if (process.env.DEBUG_ENDPOINTS_ENABLED === "true" && process.env.NODE_ENV !== "production") {
  app.get("/debug/env", (req: Request, res: Response) => {
    // Allowlist of safe keys to expose (never return secret material)
    const allowlist = [
      "AFI_PRICE_FEED_SOURCE",
      "AFI_REACTOR_PORT",
      "NODE_ENV",
      "COINALYZE_API_KEY",
      "DEBUG_ENDPOINTS_ENABLED",
    ];

    const safeEnv: Record<string, string | boolean> = {};
    for (const key of allowlist) {
      const value = process.env[key];
      const isSensitive = /KEY|SECRET|TOKEN/i.test(key);

      if (isSensitive) {
        safeEnv[`${key}_PRESENT`] = Boolean(value);
      } else if (value) {
        safeEnv[key] = value;
      } else {
        safeEnv[key] = "NOT SET";
      }
    }

    res.json({
      warning: "DEBUG ENDPOINT - NOT FOR PRODUCTION",
      env: safeEnv,
    });
  });
  console.log("⚠️  /debug/env endpoint ENABLED (DEBUG_ENDPOINTS_ENABLED=true)");
} else {
  console.log("✅ /debug/env endpoint DISABLED (secure default)");
}

/**
 * TradingView webhook endpoint.
 * 
 * POST /api/webhooks/tradingview
 * 
 * Expected payload:
 * {
 *   "symbol": "BTCUSDT",
 *   "timeframe": "15m",
 *   "strategy": "froggy_trend_pullback_v1",
 *   "direction": "long",
 *   "setupSummary": "Bullish pullback",
 *   "notes": "Optional notes",
 *   "enrichmentProfile": { ... },
 *   "signalId": "optional-id",
 *   "secret": "optional-shared-secret"
 * }
 * 
 * Returns:
 * {
 *   "signalId": "...",
 *   "validatorDecision": { ... },
 *   "execution": { ... },
 *   "meta": { ... },
 *   "score": 0.75,
 *   "confidence": 0.85
 * }
 */
app.post("/api/webhooks/tradingview", async (req: Request, res: Response) => {
  try {
    const rawPayload = req.body as TradingViewAlertPayload;

    // Basic payload validation
    if (!rawPayload || typeof rawPayload !== "object") {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    // Validate required TradingView fields
    if (!rawPayload.symbol) {
      return res.status(400).json({ error: "Missing required field: symbol" });
    }

    if (!rawPayload.timeframe) {
      return res.status(400).json({ error: "Missing required field: timeframe" });
    }

    if (!rawPayload.strategy) {
      return res.status(400).json({ error: "Missing required field: strategy" });
    }

    if (!rawPayload.direction) {
      return res.status(400).json({ error: "Missing required field: direction" });
    }

    // Validate direction
    if (!["long", "short", "neutral"].includes(rawPayload.direction)) {
      return res.status(400).json({
        error: 'Invalid direction. Must be "long", "short", or "neutral"',
      });
    }

    // Optional: Validate shared secret
    const expectedSecret = process.env.WEBHOOK_SHARED_SECRET;
    if (expectedSecret && rawPayload.secret !== expectedSecret) {
      console.warn(`⚠️ Webhook authentication failed: invalid secret`);
      return res.status(401).json({ error: "Unauthorized: invalid secret" });
    }

    console.log(`📨 TradingView webhook received:`, {
      symbol: rawPayload.symbol,
      timeframe: rawPayload.timeframe,
      strategy: rawPayload.strategy,
      direction: rawPayload.direction,
    });

    // ✅ CANONICAL USS v1.1 INGESTION
    // Map TradingView payload to canonical USS v1.1
    const canonicalUss = mapTradingViewToUssV11(rawPayload);

    // Validate canonical USS against schema
    const validation = validateUsignalV11(canonicalUss);
    if (!validation.ok) {
      console.error(`❌ USS v1.1 validation failed:`, validation.errors);
      return res.status(400).json({
        error: "invalid_uss",
        message: "Payload does not conform to USS v1.1 schema",
        details: validation.errors,
      });
    }

    console.log(`✅ Canonical USS v1.1 validated:`, {
      signalId: canonicalUss.provenance.signalId,
      providerId: canonicalUss.provenance.providerId,
      source: canonicalUss.provenance.source,
    });

    // ✅ Run the Froggy scoring pipeline with canonical USS v1.1
    // The canonical USS is now the single source of truth passed into the DAG
    const result = await runFroggyTrendPullbackFromCanonicalUss(canonicalUss);

    console.log(`✅ Froggy scoring complete:`, {
      signalId: result.signalId,
      uwrScore: result.analystScore.uwrScore,
    });

    // Return result
    return res.status(200).json(result);
  } catch (err: any) {
    console.error(`❌ Error processing TradingView webhook:`, err);
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error",
    });
  }
});

/**
 * CPJ Ingestion endpoint (Telegram/Discord signals).
 *
 * POST /api/ingest/cpj
 *
 * Expected payload: CPJ v0.1 format
 * {
 *   "schema": "afi.cpj.v0.1",
 *   "provenance": {
 *     "providerType": "telegram",
 *     "providerId": "telegram-channel-123",
 *     "messageId": "msg-456",
 *     "postedAt": "2024-12-16T10:00:00Z",
 *     "rawText": "..."
 *   },
 *   "extracted": {
 *     "symbolRaw": "BTCUSDT",
 *     "side": "long",
 *     "entry": 42500,
 *     "stopLoss": 41800,
 *     "takeProfits": [{ "price": 43500 }],
 *     "timeframeHint": "4h",
 *     "venueHint": "blofin",
 *     "marketTypeHint": "perp"
 *   },
 *   "parse": {
 *     "parserId": "telegram-signal-parser",
 *     "parserVersion": "1.0.0",
 *     "confidence": 0.95
 *   },
 *   "secret": "optional-shared-secret"
 * }
 *
 * Returns:
 * {
 *   "ok": true,
 *   "signalId": "cpj-telegram-channel123-msg456",
 *   "providerId": "telegram-channel-123",
 *   "ingestHash": "...",
 *   "uss": { ... },
 *   "pipelineResult": { ... }
 * }
 */
app.post("/api/ingest/cpj", async (req: Request, res: Response) => {
  try {
    const rawPayload = req.body;

    // Basic payload validation
    if (!rawPayload || typeof rawPayload !== "object") {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    // Optional: Validate shared secret
    const expectedSecret = process.env.WEBHOOK_SHARED_SECRET;
    if (expectedSecret && rawPayload.secret !== expectedSecret) {
      console.warn(`⚠️ CPJ ingestion authentication failed: invalid secret`);
      return res.status(401).json({ error: "Unauthorized: invalid secret" });
    }

    console.log(`📨 CPJ ingestion received:`, {
      providerType: rawPayload.provenance?.providerType,
      providerId: rawPayload.provenance?.providerId,
      messageId: rawPayload.provenance?.messageId,
      symbolRaw: rawPayload.extracted?.symbolRaw,
    });

    // ✅ STEP 1: Validate CPJ v0.1
    const cpjValidation = validateCpjV01(rawPayload);
    if (!cpjValidation.ok) {
      console.error(`❌ CPJ v0.1 validation failed:`, cpjValidation.errors);
      return res.status(400).json({
        error: "invalid_cpj",
        message: "Payload does not conform to CPJ v0.1 schema",
        details: cpjValidation.errors,
      });
    }

    console.log(`✅ CPJ v0.1 validated:`, {
      providerType: rawPayload.provenance.providerType,
      providerId: rawPayload.provenance.providerId,
      parseConfidence: rawPayload.parse.confidence,
    });

    // ✅ STEP 2: Map CPJ → USS v1.1 with strict symbol validation
    const mappingResult = mapCpjToUssV11(rawPayload);

    // Check for symbol normalization failures
    if (!mappingResult.success) {
      console.error(`❌ Symbol normalization failed:`, mappingResult.error);
      return res.status(422).json({
        error: "symbol_normalization_failed",
        message: "Could not normalize symbol to canonical BASE/QUOTE format",
        symbolRaw: mappingResult.error!.symbolRaw,
        symbolNormalizedAttempt: mappingResult.error!.symbolNormalizedAttempt,
        reason: mappingResult.error!.reason,
        details: mappingResult.error!.details,
      });
    }

    const canonicalUss = mappingResult.uss!;

    console.log(`✅ CPJ mapped to USS v1.1:`, {
      signalId: canonicalUss.provenance.signalId,
      providerId: canonicalUss.provenance.providerId,
      symbol: canonicalUss.facts?.symbol,
      market: canonicalUss.facts?.market,
    });

    // ✅ STEP 3: Validate USS v1.1
    const ussValidation = validateUsignalV11(canonicalUss);
    if (!ussValidation.ok) {
      console.error(`❌ USS v1.1 validation failed:`, ussValidation.errors);
      return res.status(400).json({
        error: "invalid_uss",
        message: "Mapped USS does not conform to USS v1.1 schema",
        details: ussValidation.errors,
      });
    }

    console.log(`✅ USS v1.1 validated:`, {
      signalId: canonicalUss.provenance.signalId,
      providerId: canonicalUss.provenance.providerId,
    });

    // ✅ STEP 3.5: Check for duplicate ingestion (if dedupe enabled)
    const ingestHash = canonicalUss.provenance.ingestHash;
    const signalId = canonicalUss.provenance.signalId;

    const duplicate = checkDuplicate(ingestHash);
    if (duplicate) {
      console.warn(`⚠️  Duplicate CPJ ingestion detected:`, {
        ingestHash,
        signalId,
        firstSeenAt: duplicate.firstSeenAt,
      });
      return res.status(409).json({
        ok: false,
        duplicate: true,
        ingestHash,
        signalId,
        firstSeenAt: duplicate.firstSeenAt,
        message: "Duplicate signal already ingested recently",
      });
    }

    // Record this ingest for future dedupe checks
    recordIngest(ingestHash, signalId);

    // ✅ STEP 4: Run the Froggy scoring pipeline with canonical USS v1.1
    const pipelineResult = await runFroggyTrendPullbackFromCanonicalUss(canonicalUss);

    console.log(`✅ Froggy scoring complete (CPJ ingestion):`, {
      signalId: pipelineResult.signalId,
      uwrScore: pipelineResult.analystScore.uwrScore,
    });

    // Return result
    return res.status(200).json({
      ok: true,
      signalId: canonicalUss.provenance.signalId,
      providerId: canonicalUss.provenance.providerId,
      ingestHash: canonicalUss.provenance.ingestHash,
      uss: canonicalUss,
      pipelineResult,
    });
  } catch (err: any) {
    console.error(`❌ Error processing CPJ ingestion:`, err);
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error",
    });
  }
});

// Replay and demo endpoints removed - Reactor is scoring-only

// Export the app for testing
export default app;

/**
 * Start server only when run directly (not when imported for tests).
 *
 * This allows tests to import the app without starting the server,
 * while still allowing `npm run start:demo` to work normally.
 *
 * We check for NODE_ENV !== 'test' to avoid starting the server during Jest tests.
 */
if (process.env.NODE_ENV !== "test") {
  const PORT = parseInt(process.env.PORT || process.env.AFI_REACTOR_PORT || "8080", 10);

  app.listen(PORT, async () => {
    console.log(`🚀 AFI REACTOR - Scoring Pipeline`);
    console.log(`   Listening on http://localhost:${PORT}`);
    console.log(`   Endpoints:`);
    console.log(`     GET  /health`);
    console.log(`     POST /api/webhooks/tradingview`);
    console.log(`     POST /api/ingest/cpj (CPJ v0.1 ingestion - Telegram/Discord signals)`);
    console.log(``);
    console.log(`   Returns: ReactorScoredSignalV1 (signalId, analystScore, scoredAt, decayParams, lenses, rawUss)`);
    console.log(`   Price Feed: ${process.env.AFI_PRICE_FEED_SOURCE || "demo (mock data)"}`);
    console.log(``);

    // Start Telegram Bot API collector if enabled
    const telegramCollector = await startTelegramCollector();
    if (telegramCollector) {
      console.log(`✅ Telegram Bot API collector started`);
    }

    // Start Telegram MTProto collector if enabled
    const mtprotoClient = createMtprotoClientFromEnv();
    if (mtprotoClient) {
      try {
        await mtprotoClient.connect();
        const mtprotoCollector = await startMtprotoCollector(mtprotoClient);
        if (mtprotoCollector) {
          console.log(`✅ Telegram MTProto collector started`);
        }
      } catch (error: any) {
        console.error(`❌ Failed to start MTProto collector:`, error.message);
      }
    }
  });
}
