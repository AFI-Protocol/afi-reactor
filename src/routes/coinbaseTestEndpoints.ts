/**
 * Coinbase Test Endpoints
 * 
 * HTTP endpoints for testing Coinbase price feed adapter.
 * These are dev/demo-only endpoints for manual verification.
 * 
 * Endpoints:
 * - GET /test/coinbase/ohlcv?symbol=BTC/USDT&timeframe=1h&limit=50
 * - GET /test/coinbase/ticker?symbol=BTC/USDT
 * - GET /test/coinbase/status
 */

import { Router } from "express";
import { getPriceFeedAdapter, listAvailablePriceSources } from "../adapters/exchanges/priceFeedRegistry.js";

const router = Router();

/**
 * GET /test/coinbase/ohlcv
 * 
 * Fetch OHLCV candles from Coinbase
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
        example: "/test/coinbase/ohlcv?symbol=BTC/USDT&timeframe=1h&limit=50",
      });
    }

    if (limit > 500) {
      return res.status(400).json({
        error: "Invalid limit",
        message: "Limit must be <= 500",
      });
    }

    // Fetch OHLCV from Coinbase
    const adapter = getPriceFeedAdapter("coinbase");
    const candles = await adapter.getOHLCV({
      symbol,
      timeframe,
      limit,
    });

    res.json({
      source: "coinbase",
      symbol,
      timeframe,
      candleCount: candles.length,
      candles,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Coinbase OHLCV test endpoint error:", error);
    res.status(500).json({
      error: "Coinbase OHLCV fetch failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /test/coinbase/ticker
 * 
 * Fetch current ticker snapshot from Coinbase
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
        example: "/test/coinbase/ticker?symbol=BTC/USDT",
      });
    }

    // Fetch ticker from Coinbase
    const adapter = getPriceFeedAdapter("coinbase");
    const ticker = await adapter.getTicker(symbol);

    res.json({
      source: "coinbase",
      ticker,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Coinbase ticker test endpoint error:", error);
    res.status(500).json({
      error: "Coinbase ticker fetch failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /test/coinbase/status
 * 
 * Check Coinbase adapter status and available price sources
 */
router.get("/status", async (req, res) => {
  try {
    const adapter = getPriceFeedAdapter("coinbase");
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
        COINBASE_API_BASE_URL: process.env.COINBASE_API_BASE_URL || "(default)",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Coinbase status endpoint error:", error);
    res.status(500).json({
      error: "Coinbase status check failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;

