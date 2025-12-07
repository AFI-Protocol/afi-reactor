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
 * 
 * @module server
 */

import express, { Request, Response } from "express";
import {
  runFroggyTrendPullbackFromTradingView,
  type TradingViewAlertPayload,
} from "./services/froggyDemoService.js";

const app = express();

// Middleware
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next) => {
  console.log(`🔥 ${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

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
 * Prize Demo endpoint.
 *
 * POST /demo/prize-froggy
 *
 * DEMO-ONLY: Runs a pre-configured BTC trend-pullback signal through the Froggy pipeline
 * with detailed stage-by-stage summaries for the "Pipeline with Friends" demo.
 *
 * This endpoint:
 * - Uses a fixed, deterministic demo payload (BTC/USDT 1h trend-pullback)
 * - Returns stage summaries showing Alpha → Pixel Rick → Froggy → Val Dook flow
 * - Includes enrichment categories and persona names for each stage
 * - Marks the response with isDemo: true
 *
 * No tokenomics, emissions, or real trading. Demo purposes only.
 */
app.post("/demo/prize-froggy", async (req: Request, res: Response) => {
  try {
    console.log(`🏆 Prize Demo endpoint called`);

    // Fixed demo payload for deterministic results
    const demoPayload: TradingViewAlertPayload = {
      symbol: "BTC/USDT",
      market: "spot",
      timeframe: "1h",
      strategy: "froggy_trend_pullback_v1",
      direction: "long",
      setupSummary: "Bullish pullback to 20 EMA after liquidity sweep below $67.2k. Volume increasing on bounce. Structure intact (higher highs).",
      notes: "DEMO-ONLY: Prize pipeline sample for ElizaOS demo",
      enrichmentProfile: {
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

    console.log(`✅ Prize Demo complete:`, {
      signalId: result.signalId,
      decision: result.validatorDecision?.decision,
      stages: result.stageSummaries?.length,
    });

    // Return result with stage summaries
    return res.status(200).json(result);
  } catch (err: any) {
    console.error(`❌ Error in Prize Demo:`, err);
    return res.status(500).json({
      error: "internal_error",
      message: err.message || "Unknown error",
    });
  }
});

// Start server
const PORT = parseInt(process.env.AFI_REACTOR_PORT || "8080", 10);

app.listen(PORT, () => {
  console.log(`🚀 AFI-REACTOR HTTP DEMO SERVER`);
  console.log(`   Listening on http://localhost:${PORT}`);
  console.log(`   Endpoints:`);
  console.log(`     GET  /health`);
  console.log(`     POST /api/webhooks/tradingview`);
  console.log(`     POST /demo/prize-froggy (Prize Demo with stage summaries)`);
  console.log(``);
  console.log(`   ⚠️  DEV/DEMO ONLY - No real trading or emissions`);
  console.log(``);
});

export default app;

