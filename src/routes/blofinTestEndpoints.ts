/**
 * BloFin Test Endpoints
 * 
 * HTTP endpoints for testing BloFin price feed adapter.
 * These are dev/demo-only endpoints for manual verification.
 * 
 * Endpoints:
 * - GET /test/blofin/ohlcv?symbol=BTC/USDT&timeframe=1h&limit=50
 * - GET /test/blofin/ticker?symbol=BTC/USDT
 * - GET /test/blofin/status
 */

import { Router } from "express";
import { getPriceFeedAdapter, listAvailablePriceSources } from "../adapters/exchanges/priceFeedRegistry.js";

const router = Router();

/**
 * GET /test/blofin/ohlcv
 * 
 * Fetch OHLCV candles from BloFin
 * 
 * Query params:
 * - symbol: Trading pair (e.g., "BTC/USDT")
 * - timeframe: Candle timeframe (e.g., "1m", "5m", "1h", "1d")
 * - limit: Number of candles (default: 50, max: 500)
 */
router.get("/ohlcv", async (req, res) => {
  try {
    const symbol = req.query.symbol as string;
    const timeframe = req.query.timeframe as string;
    const limit = parseInt(req.query.limit as string, 10) || 50;

    if (!symbol || !timeframe) {
      return res.status(400).json({
        error: "Missing required parameters",
        message: "Both 'symbol' and 'timeframe' query parameters are required",
        example: "/test/blofin/ohlcv?symbol=BTC/USDT&timeframe=1h&limit=50",
      });
    }

    if (limit > 500) {
      return res.status(400).json({
        error: "Invalid limit",
        message: "Limit must be <= 500",
      });
    }

    // Fetch OHLCV from BloFin
    const adapter = getPriceFeedAdapter("blofin");
    const candles = await adapter.getOHLCV({
      symbol,
      timeframe,
      limit,
    });

    res.json({
      source: "blofin",
      symbol,
      timeframe,
      candleCount: candles.length,
      candles,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("BloFin OHLCV test endpoint error:", error);
    res.status(500).json({
      error: "BloFin OHLCV fetch failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /test/blofin/ticker
 * 
 * Fetch current ticker snapshot from BloFin
 * 
 * Query params:
 * - symbol: Trading pair (e.g., "BTC/USDT")
 */
router.get("/ticker", async (req, res) => {
  try {
    const symbol = req.query.symbol as string;

    if (!symbol) {
      return res.status(400).json({
        error: "Missing required parameter",
        message: "'symbol' query parameter is required",
        example: "/test/blofin/ticker?symbol=BTC/USDT",
      });
    }

    // Fetch ticker from BloFin
    const adapter = getPriceFeedAdapter("blofin");
    const ticker = await adapter.getTicker(symbol);

    res.json({
      source: "blofin",
      ticker,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("BloFin ticker test endpoint error:", error);
    res.status(500).json({
      error: "BloFin ticker fetch failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /test/blofin/status
 * 
 * Check BloFin adapter status and available price sources
 */
router.get("/status", async (req, res) => {
  try {
    const adapter = getPriceFeedAdapter("blofin");
    const availableSources = listAvailablePriceSources();

    res.json({
      status: "ok",
      adapter: {
        id: adapter.id,
        name: adapter.name,
        supportsPerps: adapter.supportsPerps,
        supportsSpot: adapter.supportsSpot,
      },
      availableSources,
      env: {
        AFI_PRICE_FEED_SOURCE: process.env.AFI_PRICE_FEED_SOURCE || "demo",
        BLOFIN_API_BASE_URL: process.env.BLOFIN_API_BASE_URL || "(default)",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("BloFin status endpoint error:", error);
    res.status(500).json({
      error: "BloFin status check failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;

