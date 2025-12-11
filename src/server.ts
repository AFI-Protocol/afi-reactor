/**
 * 🚦 AFI-REACTOR HTTP DEMO SERVER
 *
 * This server is for dev/demo only. It exposes:
 *   - GET /health
 *   - POST /api/webhooks/tradingview
 *
 * It runs the Froggy trend-pullback pipeline using simulated execution.
 *
 * ⚠️ DEV/DEMO ONLY:
 * - No real trading or token emissions occur here
 * - Execution is simulated only
 * - No real exchange API calls
 * - Uses demo enrichment data
 *
 * Environment variables:
 * - AFI_REACTOR_PORT: Server port (default: 8080)
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
  type TradingViewAlertPayload,
} from "./services/froggyDemoService.js";
import { replaySignalById } from "./services/vaultReplayService.js";
import { getSimpleReplayViewBySignalId } from "./services/tssdSimpleReplayService.js";
import testEndpointsRouter from "./routes/testEndpoints.js";
import blofinTestEndpointsRouter from "./routes/blofinTestEndpoints.js";
import coinbaseTestEndpointsRouter from "./routes/coinbaseTestEndpoints.js";

const app = express();

// Middleware
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next) => {
  console.log(`🔥 ${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// Mount test endpoints router (dev/demo only)
app.use("/test", testEndpointsRouter);

// Mount BloFin test endpoints (dev/demo only)
app.use("/test/blofin", blofinTestEndpointsRouter);

// Mount Coinbase test endpoints (dev/demo only)
app.use("/test/coinbase", coinbaseTestEndpointsRouter);

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
 * Debug endpoint to check environment variables (dev/demo only).
 *
 * GET /debug/env
 */
app.get("/debug/env", (req: Request, res: Response) => {
  const coinalyzeKey = process.env.COINALYZE_API_KEY;
  const priceFeedSource = process.env.AFI_PRICE_FEED_SOURCE;

  res.json({
    COINALYZE_API_KEY: coinalyzeKey ? `${coinalyzeKey.substring(0, 8)}...` : "NOT SET",
    AFI_PRICE_FEED_SOURCE: priceFeedSource || "NOT SET (defaults to 'demo')",
    AFI_REACTOR_PORT: process.env.AFI_REACTOR_PORT || "NOT SET (defaults to 8080)",
    NODE_ENV: process.env.NODE_ENV || "NOT SET",
  });
});

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
    const payload = req.body as TradingViewAlertPayload;

    // Validate required fields
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    if (!payload.symbol) {
      return res.status(400).json({ error: "Missing required field: symbol" });
    }

    if (!payload.timeframe) {
      return res.status(400).json({ error: "Missing required field: timeframe" });
    }

    if (!payload.strategy) {
      return res.status(400).json({ error: "Missing required field: strategy" });
    }

    if (!payload.direction) {
      return res.status(400).json({ error: "Missing required field: direction" });
    }

    // Validate direction
    if (!["long", "short", "neutral"].includes(payload.direction)) {
      return res.status(400).json({
        error: 'Invalid direction. Must be "long", "short", or "neutral"',
      });
    }

    // Optional: Validate shared secret
    const expectedSecret = process.env.WEBHOOK_SHARED_SECRET;
    if (expectedSecret && payload.secret !== expectedSecret) {
      console.warn(`⚠️ Webhook authentication failed: invalid secret`);
      return res.status(401).json({ error: "Unauthorized: invalid secret" });
    }

    console.log(`📨 TradingView webhook received:`, {
      symbol: payload.symbol,
      timeframe: payload.timeframe,
      strategy: payload.strategy,
      direction: payload.direction,
    });

    // Run the Froggy pipeline
    const result = await runFroggyTrendPullbackFromTradingView(payload);

    console.log(`✅ Froggy pipeline complete:`, {
      signalId: result.signalId,
      decision: result.validatorDecision?.decision,
      executionStatus: result.execution?.status,
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
 * Vault Replay endpoint.
 *
 * GET /replay/signal/:signalId
 * GET /replay/signal/:signalId?mode=simple
 * GET /replay/signal/:signalId?mode=full
 *
 * READ-ONLY: Fetches a signal from the TSSD vault.
 *
 * Two modes:
 * 1. Simple mode (default, or ?mode=simple):
 *    - Fast read-only view of stored signal
 *    - No pipeline re-run
 *    - Returns clean JSON view for UIs/dashboards
 *
 * 2. Full mode (?mode=full):
 *    - Re-runs the Froggy pipeline deterministically
 *    - Compares stored vs recomputed values
 *    - Returns detailed comparison for auditing
 *
 * Simple mode returns:
 * {
 *   "replay": {
 *     "signalId": "...",
 *     "createdAt": "...",
 *     "source": "...",
 *     "market": { ... },
 *     "strategy": { ... },
 *     "pipeline": { ... },
 *     "raw": { ... }
 *   }
 * }
 *
 * Full mode returns:
 * {
 *   "signalId": "...",
 *   "stored": { ... },
 *   "recomputed": { ... },
 *   "comparison": { "uwrScoreDelta": 0.0021, "decisionChanged": false, "changes": [...] },
 *   "replayMeta": { "ranAt": "...", "pipelineVersion": "...", "notes": "..." }
 * }
 */
app.get("/replay/signal/:signalId", async (req: Request, res: Response) => {
  try {
    const { signalId } = req.params;
    const mode = (req.query.mode as string) || "simple";

    // Validate signalId
    if (!signalId) {
      return res.status(400).json({
        error: "bad_request",
        message: "Missing required parameter: signalId"
      });
    }

    // Validate mode
    if (mode !== "simple" && mode !== "full") {
      return res.status(400).json({
        error: "bad_request",
        message: `Invalid mode: '${mode}'. Must be 'simple' or 'full'`,
      });
    }

    // Simple mode: Fast read-only view
    if (mode === "simple") {
      console.log(`📖 Simple replay requested: ${signalId}`);

      const simpleView = await getSimpleReplayViewBySignalId(signalId);

      if (!simpleView) {
        console.warn(`⚠️  Signal not found: ${signalId}`);
        return res.status(404).json({
          error: "signal_not_found",
          message: `Signal with ID '${signalId}' not found in TSSD vault`,
          signalId,
        });
      }

      console.log(`✅ Simple replay complete: ${signalId}`);
      return res.status(200).json({ replay: simpleView });
    }

    // Full mode: Re-run pipeline and compare
    console.log(`🔄 Full replay requested: ${signalId}`);

    const replayResult = await replaySignalById(signalId);

    if (!replayResult) {
      console.warn(`⚠️  Signal not found: ${signalId}`);
      return res.status(404).json({
        error: "signal_not_found",
        message: `Signal with ID '${signalId}' not found in TSSD vault`,
        signalId,
      });
    }

    console.log(`✅ Full replay complete: ${signalId}`, {
      uwrScoreDelta: replayResult.comparison.uwrScoreDelta,
      decisionChanged: replayResult.comparison.decisionChanged,
    });

    return res.status(200).json(replayResult);
  } catch (err: any) {
    console.error(`❌ Error in vault replay:`, err);

    // Check if it's a vault unavailable error
    if (err.message && err.message.includes("not configured")) {
      return res.status(503).json({
        error: "vault_unavailable",
        message: "TSSD replay unavailable",
        reason: "MongoDB not configured (AFI_MONGO_URI not set)",
      });
    }

    // Generic internal error
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error during replay",
    });
  }
});

/**
 * AFI Eliza Demo endpoint.
 *
 * POST /demo/afi-eliza-demo
 *
 * DEMO-ONLY: Runs a pre-configured BTC trend-pullback signal through the Froggy pipeline
 * with detailed stage-by-stage summaries for the AFI Eliza Demo.
 *
 * This endpoint:
 * - Uses a fixed, deterministic demo payload (BTC/USDT 1h trend-pullback)
 * - Returns stage summaries showing Alpha → Pixel Rick → Froggy → Val Dook flow
 * - Includes enrichment categories and persona names for each stage
 * - Marks the response with isDemo: true
 *
 * No tokenomics, emissions, or real trading. Demo purposes only.
 */
app.post("/demo/afi-eliza-demo", async (req: Request, res: Response) => {
  try {
    console.log(`🎯 AFI Eliza Demo endpoint called`);

    // Use request body to allow customization (symbol, market, timeframe, etc.)
    // Fall back to demo defaults if not provided
    const demoPayload: TradingViewAlertPayload = {
      symbol: req.body.symbol || "BTC/USDT",
      market: req.body.market || "spot",
      timeframe: req.body.timeframe || "1h",
      strategy: req.body.strategy || "froggy_trend_pullback_v1",
      direction: req.body.direction || "long",
      setupSummary: req.body.setupSummary || "Bullish pullback to 20 EMA after liquidity sweep below $67.2k. Volume increasing on bounce. Structure intact (higher highs).",
      notes: req.body.notes || "DEMO-ONLY: AFI Eliza Demo sample for ElizaOS integration",
      enrichmentProfile: req.body.enrichmentProfile || {
        technical: { enabled: true, preset: "trend_pullback" },
        pattern: { enabled: true, preset: "reversal_patterns" },
        sentiment: { enabled: false },
        news: { enabled: false },
        aiMl: { enabled: false },
      },
    };

    // Run the Froggy pipeline with stage summaries enabled
    const result = await runFroggyTrendPullbackFromTradingView(demoPayload, {
      includeStageSummaries: true,
      isDemo: true,
    });

    console.log(`✅ AFI Eliza Demo complete:`, {
      signalId: result.signalId,
      decision: result.validatorDecision?.decision,
      stages: result.stageSummaries?.length,
    });

    // Return result with stage summaries
    return res.status(200).json(result);
  } catch (err: any) {
    console.error(`❌ Error in AFI Eliza Demo:`, err);
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error",
    });
  }
});

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
  const PORT = parseInt(process.env.AFI_REACTOR_PORT || "8080", 10);

  app.listen(PORT, () => {
    console.log(`🚀 AFI-REACTOR HTTP DEMO SERVER`);
    console.log(`   Listening on http://localhost:${PORT}`);
    console.log(`   Endpoints:`);
    console.log(`     GET  /health`);
    console.log(`     POST /api/webhooks/tradingview`);
    console.log(`     POST /demo/afi-eliza-demo (AFI Eliza Demo with stage summaries)`);
    console.log(`     GET  /replay/signal/:signalId (Simple replay - read-only view)`);
    console.log(`     GET  /replay/signal/:signalId?mode=full (Full replay - re-run pipeline)`);
    console.log(``);
    console.log(`   Test Endpoints (dev/demo only):`);
    console.log(`     POST /test/enrichment - Test enrichment stage only`);
    console.log(`     POST /test/analysis   - Test analysis stage only`);
    console.log(`     POST /test/validator  - Test validator stage only`);
    console.log(``);
    console.log(`   BloFin Test Endpoints (dev/demo only):`);
    console.log(`     GET  /test/blofin/ohlcv?symbol=BTC/USDT&timeframe=1h&limit=50`);
    console.log(`     GET  /test/blofin/ticker?symbol=BTC/USDT`);
    console.log(`     GET  /test/blofin/status`);
    console.log(``);
    console.log(`   Coinbase Test Endpoints (dev/demo only):`);
    console.log(`     GET  /test/coinbase/ohlcv?symbol=BTC/USDT&timeframe=1h&limit=50`);
    console.log(`     GET  /test/coinbase/ticker?symbol=BTC/USDT`);
    console.log(`     GET  /test/coinbase/status`);
    console.log(``);
    console.log(`   Price Feed: ${process.env.AFI_PRICE_FEED_SOURCE || "demo (mock data)"}`);
    console.log(`   ⚠️  DEV/DEMO ONLY - No real trading or emissions`);
    console.log(``);
  });
}

