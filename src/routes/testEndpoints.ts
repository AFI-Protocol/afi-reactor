/**
 * AFI Pipeline Test Endpoints
 * 
 * Stage-specific HTTP endpoints for testing individual pipeline stages in isolation.
 * These endpoints are intended for development and testing only.
 * 
 * Usage:
 *   POST /test/enrichment - Test enrichment stage only
 *   POST /test/analysis   - Test analysis stage only
 *   POST /test/validator  - Test validator stage only
 * 
 * @module testEndpoints
 */

import { Router } from "express";
import froggyEnrichmentAdapter from "../../plugins/froggy-enrichment-adapter.plugin.js";
import froggyAnalyst from "../../plugins/froggy.trend_pullback_v1.plugin.js";
import validatorDecisionEvaluator from "../../plugins/validator-decision-evaluator.plugin.js";

const router = Router();

/**
 * Test Enrichment Stage Only
 * 
 * Accepts a structured signal and returns enriched signal.
 * Bypasses ingestion and structuring stages.
 * 
 * Example payload:
 * {
 *   "signalId": "test-001",
 *   "score": 0,
 *   "confidence": 0.5,
 *   "timestamp": "2025-12-09T12:00:00Z",
 *   "meta": {
 *     "symbol": "BTC/USDT",
 *     "market": "spot",
 *     "timeframe": "1h",
 *     "strategy": "froggy_trend_pullback_v1",
 *     "direction": "long",
 *     "enrichmentProfile": {
 *       "technical": { "enabled": true, "preset": "trend_pullback" }
 *     }
 *   },
 *   "structured": {
 *     "normalizedTimestamp": "2025-12-09T12:00:00Z",
 *     "hasValidMeta": true,
 *     "structuredBy": "test"
 *   }
 * }
 */
router.post("/enrichment", async (req, res) => {
  try {
    const structuredSignal = req.body;
    
    if (!structuredSignal.signalId) {
      return res.status(400).json({ error: "Missing signalId" });
    }
    
    const enriched = await froggyEnrichmentAdapter.run(structuredSignal);
    
    res.json({
      stage: "enrichment",
      input: structuredSignal,
      output: enriched,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("Enrichment test failed:", error);
    res.status(500).json({ 
      error: "Enrichment test failed", 
      message: error.message 
    });
  }
});

/**
 * Test Analysis Stage Only
 * 
 * Accepts an enriched signal and returns analyzed signal with UWR score.
 * Bypasses ingestion, structuring, and enrichment stages.
 * 
 * Example payload: See afi-reactor/test/fixtures/enriched-signal.json
 */
router.post("/analysis", async (req, res) => {
  try {
    const enrichedSignal = req.body;
    
    if (!enrichedSignal.signalId) {
      return res.status(400).json({ error: "Missing signalId" });
    }
    
    if (!enrichedSignal.enriched) {
      return res.status(400).json({ error: "Missing enriched data" });
    }
    
    const analyzed = await froggyAnalyst.run(enrichedSignal);
    
    res.json({
      stage: "analysis",
      input: enrichedSignal,
      output: analyzed,
      uwrScore: analyzed.analysis.uwrScore,
      uwrAxes: analyzed.analysis.uwrAxes,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("Analysis test failed:", error);
    res.status(500).json({ 
      error: "Analysis test failed", 
      message: error.message 
    });
  }
});

/**
 * Test Validator Stage Only
 * 
 * Accepts an analyzed signal and returns validator decision.
 * Bypasses all upstream stages.
 * 
 * Example payload:
 * {
 *   "signalId": "test-001",
 *   "analysis": {
 *     "uwrScore": 0.78,
 *     "uwrAxes": {
 *       "structureAxis": 0.8,
 *       "executionAxis": 0.7,
 *       "riskAxis": 0.6,
 *       "insightAxis": 0.9
 *     },
 *     "notes": []
 *   }
 * }
 */
router.post("/validator", async (req, res) => {
  try {
    const analyzedSignal = req.body;

    if (!analyzedSignal.signalId) {
      return res.status(400).json({ error: "Missing signalId" });
    }

    if (!analyzedSignal.analysis || typeof analyzedSignal.analysis.uwrScore !== "number") {
      return res.status(400).json({ error: "Missing or invalid analysis data" });
    }

    const decision = await validatorDecisionEvaluator.run(analyzedSignal);

    res.json({
      stage: "validator",
      input: analyzedSignal,
      output: decision,
      decision: decision.decision,
      uwrConfidence: decision.uwrConfidence,
      reasonCodes: decision.reasonCodes,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("Validator test failed:", error);
    res.status(500).json({
      error: "Validator test failed",
      message: error.message
    });
  }
});

export default router;

