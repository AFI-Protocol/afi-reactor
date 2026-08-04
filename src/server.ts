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
 * - AFI_PRICE_FEED_SOURCE: Price feed source (blofin, coinbase)
 *
 * @module server
 */

// ⚠️ CRITICAL: Load environment variables FIRST before any other imports
import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import { validateUsignalV11 } from "./uss/ussValidator.js";
import {
  mapTradingViewToUssV11,
  type TradingViewAlertPayload,
} from "./uss/tradingViewMapper.js";
import {
  mapMarkitTickToUssV11,
  MARKITTICK_DEFAULT_PROVIDER_ID,
  ORIGIN_MODE_PREFLIGHT,
  type MarkitTickAlertPayload,
} from "./uss/markitTickMapper.js";
import { evaluateSourceIp, allowlistFromEnv } from "./utils/sourceIpAllowlist.js";
import { validateCpjV01 } from "./cpj/cpjValidator.js";
import { mapCpjToUssV11 } from "./uss/cpjMapper.js";
import {
  getRuntimeComposition,
  initRuntimeComposition,
} from "./config/runtimeComposition.js";
// Boot warm-up only (perf/platform-floor-v0.1) — see the warm-up block below.
import { getPriceFeedAdapter } from "./adapters/exchanges/priceFeedRegistry.js";
import { warmEvidenceStore } from "./evidence/evidenceStore.js";
import {
  resolveStrategyForProvider,
  resolveWebhookProviderId,
  StrategyResolutionError,
} from "./config/strategyResolution.js";
import { scoreRegisteredStrategyFromCanonicalUss } from "./services/graphScoringService.js";
import type { Server as HttpServer } from "http";
import {
  initDedupeCache,
  checkDuplicate,
  recordIngest,
  shutdownDedupeCache,
} from "./services/ingestDedupeService.js";
import {
  getEvidenceStore,
  submitScoredSignalEvidence,
  ReactorEvidencePersistenceError,
  closeEvidenceStore,
} from "./evidence/index.js";
import { captureScoringContext } from "./analytics/scoringContextStore.js";
import { startTelegramCollector } from "./collectors/telegram/telegramCollector.js";
import { createMtprotoClientFromEnv } from "./collectors/telegram_mtproto/mtprotoClient.js";
import { startMtprotoCollector } from "./collectors/telegram_mtproto/mtprotoCollector.js";

const app = express();

/**
 * Honest failure response. A canonical-persistence failure NEVER returns a
 * success: it maps to its first-class HTTP status (409 conflict / 503 store
 * unavailable / 500 internal) and reports `persisted: false`. Logs carry only
 * the signalId + category/code — never the full record or payload.
 */
function respondWithFailure(res: Response, err: unknown, context: string): Response {
  if (err instanceof StrategyResolutionError) {
    // Honest resolution rejection (W3 spec section 4): no binding / inactive
    // binding / unauthorized strategy → 403 with the typed discriminator.
    console.warn(`⚠️ ${context}: strategy resolution refused`, {
      code: err.code,
      providerId: err.providerId,
      requestedStrategy: err.requestedStrategy,
    });
    return res.status(err.httpStatus).json({
      error: err.code,
      message: err.message,
    });
  }
  if (err instanceof ReactorEvidencePersistenceError) {
    console.error(`❌ ${context}: canonical persistence failed`, {
      signalId: err.signalId,
      category: err.category,
      code: (err.cause as { code?: string } | undefined)?.code,
    });
    return res.status(err.httpStatus).json({
      error: `evidence_persistence_${err.category}`,
      message: err.message,
      signalId: err.signalId,
      persisted: false,
    });
  }
  console.error(`❌ ${context}:`, (err as Error)?.message ?? String(err));
  return res.status(500).json({
    error: "internal_error",
    message: (err as Error)?.message || "Unknown error",
  });
}

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
 *   "composition": "available"
 * }
 */
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "afi-reactor",
    composition: "available",
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
 *   "strategy": "trend_pullback_v1",  (a registered strategyId, the full analystId/strategyId@version form, or free text resolved to the binding defaultStrategy)
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

    // ✅ STRATEGY RESOLUTION (W3 spec section 4) — BEFORE USS mapping, so
    // facts.strategy is the RESOLVED registered strategyId. Resolution runs
    // against the boot-validated provider-binding registry; every rejection
    // is an honest 403 (no silent froggy fallback).
    const providerId = resolveWebhookProviderId(rawPayload);
    const resolution = resolveStrategyForProvider(
      {
        providerId,
        providerType: "webhook",
        requestedStrategy: rawPayload.strategy,
      },
      getRuntimeComposition().runtime
    );

    console.log(`✅ Strategy resolved:`, {
      providerId,
      bindingId: resolution.binding.bindingId,
      strategy: `${resolution.triple.analystId}/${resolution.triple.strategyId}@${resolution.triple.strategyVersion}`,
    });

    // ✅ CANONICAL USS v1.1 INGESTION
    // Map TradingView payload to canonical USS v1.1 (resolved strategy in)
    const canonicalUss = mapTradingViewToUssV11(rawPayload, resolution.triple);

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

    // ✅ Execute the RESOLVED registered composition through the
    // manifest-driven GraphExecutor (boot-validated registry composition —
    // the production switch of SLOT-FCP-REACTOR).
    const run = await scoreRegisteredStrategyFromCanonicalUss(
      canonicalUss,
      resolution.strategy
    );

    console.log(`✅ Scoring complete:`, {
      signalId: run.scored.signalId,
      uwrScore: run.scored.analystScore.uwrScore,
    });

    // Canonical evidence persistence is a REQUIRED step of the scoring run
    // (MONGO-GOV D-MONGO-3): submit the governed v3 record (with its
    // composition provenance + the five captured invocation proofs,
    // EV3-GOV) through the afi-infra interface. A persistence failure is a
    // first-class, honestly-reported failure — never a masked 200.
    const persistence = await submitScoredSignalEvidence(run.scored, getEvidenceStore(), {
      composition: run.composition,
      registration: run.registration,
      invocations: run.invocations,
    });

    // Operational analytics capture — fail-open, never awaited (D-MONGO-4).
    void captureScoringContext(run.scored, persistence, "tradingview-webhook");

    return res.status(200).json({ ...run.scored, persistence });
  } catch (err: any) {
    return respondWithFailure(res, err, "Error processing TradingView webhook");
  }
});

/**
 * Map executor lane status → the mission's per-lane status vocabulary.
 * NOTE: a REQUIRED (critical, fail-closed) lane that times out or fails aborts
 * the whole synchronous run BEFORE settling, so it never appears here — it
 * surfaces as a request-level failure (respondWithFailure), not a lane status.
 */
function mapLaneStatus(status: string): string {
  switch (status) {
    case "executed":
      return "resolved";
    case "degraded":
      return "degraded";
    case "skipped":
      return "skipped";
    case "failed-optional":
      return "failed_optional";
    default:
      return status;
  }
}

/**
 * MarkitTick TradingView webhook endpoint — low-latency origin prep v0.1.
 *
 * POST /api/webhooks/tradingview/markittick
 *
 * Accepts the raw MarkitTick "Adaptive RSI Supertrend" alert shape:
 *   { "ticker": "BINANCE:BTCUSDT", "tf": "5", "event": "bull_cross",
 *     "arsi": "61.25", "merged": "58.90", "secret"?: "...", "providerId"?: "..." }
 * v0.1 supports ONLY bull_cross → LONG and bear_cross → SHORT.
 *
 * Same score + persist pipeline as the other ingress routes (a REAL synchronous
 * scored signal), plus a fully-instrumented `latency` block (total / ingest /
 * mapper / scorer / persistence + per-lane latency & status + selectedProfileId)
 * and a `source` block (source=tradingview, indicatorId, originMode). Latency is
 * emitted on the HTTP response ONLY — never in the canonical evidence record.
 *
 * Persistence is included + measured by default; set AFI_MARKITTICK_PERSIST=false
 * to exclude it by config (e.g. a pure latency benchmark) — reported honestly as
 * outcome "skipped-by-config".
 *
 * originMode is "captured-preflight" until a real TradingView webhook fires
 * after the account's plan upgrade (set AFI_MARKITTICK_ORIGIN_MODE to override).
 */
app.post("/api/webhooks/tradingview/markittick", async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    // Source-IP gate FIRST — cheapest rejection, and it must run before the body
    // is trusted at all. Disabled while the allowlist env var is unset (preflight);
    // it MUST be enabled before `allUsers` invoker is granted, not after.
    const ipDecision = evaluateSourceIp(
      req.headers["x-forwarded-for"],
      allowlistFromEnv(process.env.AFI_MARKITTICK_ALLOWED_IPS),
      Number(process.env.AFI_MARKITTICK_XFF_HOPS_FROM_RIGHT ?? 0),
      req.socket?.remoteAddress
    );
    if (!ipDecision.allowed) {
      // Log the full chain: a wrong hop count and a genuine stranger look
      // identical from the outside, and only the chain tells them apart.
      console.warn(
        `⚠️ MarkitTick webhook rejected (${ipDecision.reason}): ip=${ipDecision.clientIp ?? "unknown"} chain=[${ipDecision.chain.join(" | ")}]`
      );
      // Deliberately unspecific: never confirm the allowlist's contents.
      return res.status(403).json({ error: "forbidden", message: "Forbidden" });
    }

    const rawPayload = req.body as MarkitTickAlertPayload;
    if (!rawPayload || typeof rawPayload !== "object") {
      return res.status(400).json({ error: "invalid_payload", message: "Invalid JSON payload" });
    }

    // Optional shared secret (same convention as the TV/CPJ routes).
    const expectedSecret = process.env.WEBHOOK_SHARED_SECRET;
    if (expectedSecret && rawPayload.secret !== expectedSecret) {
      console.warn(`⚠️ MarkitTick webhook authentication failed: invalid secret`);
      return res.status(401).json({ error: "unauthorized", message: "Unauthorized: invalid secret" });
    }

    // MarkitTick alerts carry no provider identity — inject the staging provider
    // (or an env override) so provider-binding resolution reaches the binding.
    const providerId =
      (typeof rawPayload.providerId === "string" && rawPayload.providerId) ||
      process.env.AFI_MARKITTICK_PROVIDER_ID ||
      MARKITTICK_DEFAULT_PROVIDER_ID;
    const originMode = process.env.AFI_MARKITTICK_ORIGIN_MODE || ORIGIN_MODE_PREFLIGHT;

    console.log(`📨 MarkitTick webhook received:`, {
      ticker: rawPayload.ticker,
      tf: rawPayload.tf,
      event: rawPayload.event,
      providerId,
    });

    // Strategy resolution: MarkitTick names no strategy → the provider binding's
    // defaultStrategy governs (unknown/inactive provider → honest 403).
    const resolution = resolveStrategyForProvider(
      { providerId, providerType: "webhook", requestedStrategy: null },
      getRuntimeComposition().runtime
    );
    const ingestLatencyMs = Date.now() - t0;

    // Normalize MarkitTick → canonical USS v1.1 (adapter + source metadata),
    // then validate. (mapperLatencyMs covers normalize + USS validation.)
    const mapStart = Date.now();
    const mapped = mapMarkitTickToUssV11({ ...rawPayload, providerId }, resolution.triple, {
      originMode,
    });
    if (!mapped.ok) {
      const status = mapped.error!.code === "missing_field" ? 400 : 422;
      return res.status(status).json({
        error: mapped.error!.code,
        message: mapped.error!.message,
        ...(mapped.error!.detail ? { detail: mapped.error!.detail } : {}),
      });
    }
    const canonicalUss = mapped.uss!;
    const ussValidation = validateUsignalV11(canonicalUss);
    if (!ussValidation.ok) {
      return res.status(400).json({
        error: "invalid_uss",
        message: "Mapped MarkitTick USS does not conform to USS v1.1",
        details: ussValidation.errors,
      });
    }
    const mapperLatencyMs = Date.now() - mapStart;

    // Score synchronously through the resolved composition (lanes run in
    // parallel dependency waves inside the GraphExecutor).
    const scoreStart = Date.now();
    const run = await scoreRegisteredStrategyFromCanonicalUss(canonicalUss, resolution.strategy);
    const scorerLatencyMs = Date.now() - scoreStart;

    // Evidence V3 persistence — included + measured by default; excludable by
    // config (AFI_MARKITTICK_PERSIST=false) with an honest reported outcome.
    const persistEnabled =
      (process.env.AFI_MARKITTICK_PERSIST ?? "true").toLowerCase() !== "false";
    let persistence: unknown;
    let persistenceLatencyMs = 0;
    if (persistEnabled) {
      const persistStart = Date.now();
      persistence = await submitScoredSignalEvidence(run.scored, getEvidenceStore(), {
        composition: run.composition,
        registration: run.registration,
        invocations: run.invocations,
      });
      persistenceLatencyMs = Date.now() - persistStart;
    } else {
      persistence = {
        outcome: "skipped-by-config",
        reason: "AFI_MARKITTICK_PERSIST=false (persistence excluded by config for this run)",
      };
    }

    // Operational analytics capture — fail-open, never awaited (D-MONGO-4).
    void captureScoringContext(run.scored, persistence, "markittick");

    const totalLatencyMs = Date.now() - t0;
    const selectedProfileId = `${run.registration.analystId}/${run.registration.strategyId}@${run.registration.strategyVersion}`;

    console.log(`✅ MarkitTick scored:`, {
      signalId: run.scored.signalId,
      uwrScore: run.scored.analystScore.uwrScore,
      totalLatencyMs,
    });

    return res.status(200).json({
      ...run.scored,
      persistence,
      // `origin` (not `source`) — ReactorScoredSignalV1 already reserves a
      // top-level optional `source` (UwrProfileStampSource); this block is the
      // MarkitTick signal-origin metadata and must not shadow it.
      origin: {
        source: "tradingview",
        indicatorId: mapped.meta!.indicatorId,
        event: mapped.meta!.event,
        direction: mapped.meta!.direction,
        symbol: mapped.meta!.symbol,
        timeframe: mapped.meta!.timeframe,
        ...(mapped.meta!.arsi !== undefined ? { arsi: mapped.meta!.arsi } : {}),
        ...(mapped.meta!.merged !== undefined ? { merged: mapped.meta!.merged } : {}),
        providerId,
        originMode,
      },
      latency: {
        selectedProfileId,
        clock: "Date.now-ms",
        totalLatencyMs,
        ingestLatencyMs,
        mapperLatencyMs,
        scorerLatencyMs,
        persistenceLatencyMs,
        persistence: persistEnabled ? "included" : "excluded-by-config",
        lanes: (run.laneTimings ?? []).map((l) => ({
          lane: l.category,
          nodeId: l.nodeId,
          wave: l.wave,
          latencyMs: l.durationMs,
          status: mapLaneStatus(l.status),
        })),
      },
    });
  } catch (err: any) {
    return respondWithFailure(res, err, "Error processing MarkitTick TradingView webhook");
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

    // ✅ STEP 1.5: STRATEGY RESOLUTION (W3 spec section 4) — BEFORE USS
    // mapping, so facts.strategy is the RESOLVED registered strategyId
    // (replaces the removed cpj-ingested constant). CPJ payloads name no
    // strategy: the provider binding's defaultStrategy resolves; absence of a
    // binding is an honest 403 rejection, never a silent default composition.
    const resolution = resolveStrategyForProvider(
      {
        providerId: rawPayload.provenance.providerId,
        providerType: "cpj",
      },
      getRuntimeComposition().runtime
    );

    console.log(`✅ Strategy resolved (CPJ):`, {
      providerId: rawPayload.provenance.providerId,
      bindingId: resolution.binding.bindingId,
      strategy: `${resolution.triple.analystId}/${resolution.triple.strategyId}@${resolution.triple.strategyVersion}`,
    });

    // ✅ STEP 2: Map CPJ → USS v1.1 with strict symbol validation
    const mappingResult = mapCpjToUssV11(rawPayload, resolution.triple);

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

    // The governed USS v1.1 schema requires only source/providerId/signalId, so
    // provenance.ingestHash is legitimately optional. mapCpjToUssV11 always
    // populates it, so these guards are no-ops on every payload this route can
    // produce today. They exist because an absent hash would otherwise be used
    // as a literal cache key: with dedupe enabled (AFI_INGEST_DEDUPE=1) the
    // first hashless signal would be recorded under `undefined` and every
    // subsequent hashless signal rejected 409 as a duplicate. See D6.
    const duplicate = ingestHash ? checkDuplicate(ingestHash) : undefined;
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
    if (ingestHash) recordIngest(ingestHash, signalId);

    // ✅ STEP 4: Execute the RESOLVED registered composition through the
    // manifest-driven GraphExecutor (boot-validated registry composition).
    const run = await scoreRegisteredStrategyFromCanonicalUss(
      canonicalUss,
      resolution.strategy
    );
    const pipelineResult = run.scored;

    console.log(`✅ Scoring complete (CPJ ingestion):`, {
      signalId: pipelineResult.signalId,
      uwrScore: pipelineResult.analystScore.uwrScore,
    });

    // Canonical evidence persistence (REQUIRED; failure is first-class) —
    // the governed v3 record with its composition provenance + the five
    // captured invocation proofs (EV3-GOV).
    const persistence = await submitScoredSignalEvidence(pipelineResult, getEvidenceStore(), {
      composition: run.composition,
      registration: run.registration,
      invocations: run.invocations,
    });

    // Operational analytics capture — fail-open, never awaited (D-MONGO-4).
    void captureScoringContext(pipelineResult, persistence, "cpj");

    // Return result
    return res.status(200).json({
      ok: true,
      signalId: canonicalUss.provenance.signalId,
      providerId: canonicalUss.provenance.providerId,
      ingestHash: canonicalUss.provenance.ingestHash,
      uss: canonicalUss,
      pipelineResult,
      persistence,
    });
  } catch (err: any) {
    return respondWithFailure(res, err, "Error processing CPJ ingestion");
  }
});

// Replay and demo endpoints removed - Reactor is scoring-only

// Export the app for testing
export default app;

/**
 * Graceful shutdown: stop accepting requests (close the HTTP server), then
 * release every long-lived handle — the canonical afi-infra evidence store's
 * MongoDB connection and the ingest dedupe cache — so the process exits
 * naturally. This is SIGTERM-compatible for a Cloud Run deployment. Safe to call
 * without a live server (compiled integration tests import the app but do not
 * listen); passing no server just closes the store + cache.
 */
export async function shutdownReactor(server?: HttpServer): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
  shutdownDedupeCache();
  await closeEvidenceStore();
}

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

  // ✅ BOOT-TIME REGISTRY VALIDATION (W3 spec section 3; D-FCP-8): validate
  // the ENTIRE active registry composition (schemas, hashes, plugin bindings,
  // scorer/UWR/decay refs, provider bindings) BEFORE accepting any request.
  // ANY invalid ACTIVE entry throws here and the process refuses to serve —
  // no lazy discovery at request time, no partial boot.
  try {
    const composition = initRuntimeComposition();
    console.log(
      `✅ Runtime registry composition validated:`,
      {
        strategies: [...composition.runtime.strategies.keys()],
        bindings: composition.runtime.bindings.size,
        plugins: composition.pluginRegistry.keys().length,
      }
    );
  } catch (err) {
    console.error(
      `❌ BOOT REFUSED — the active registry composition is invalid (D-FCP-8 honest failure):`,
      (err as Error)?.message ?? String(err)
    );
    throw err;
  }

  // ⚡ BOOT WARM-UP (perf/platform-floor-v0.1) — FAIL OPEN. Never a boot gate.
  //
  // Three initialisations used to fire lazily on the FIRST REQUEST of every
  // container instance: ccxt's import + BloFin loadMarkets (measured 3.7-4.7s
  // hosted), and the evidence store's mongodb import + Atlas connect + topology
  // discovery + collection/index bootstrap + afi-infra's lazy schema compile.
  // Together they made the first real request ~6.9s against ~2.2s warm. Doing
  // them here moves that cliff off the request path.
  //
  // MUST run BEFORE app.listen. Cloud Run's startup probe is a TCP probe on the
  // port, so the instance is marked ready the moment the port binds; anything
  // scheduled after that runs post-readiness, after startup CPU boost has ended
  // and with CPU throttling on — i.e. starved of exactly the CPU it needs.
  //
  // Deliberately DISTINCT from the BOOT REFUSED path above (D-FCP-8): an
  // invalid registry composition must refuse to serve, but a transient BloFin
  // or Atlas blip must degrade to one slow first request, never to an outage.
  // Every step is individually bounded and individually caught.
  const bootAndListen = async (): Promise<void> => {
    const warmStep = async (label: string, budgetMs: number, run: () => Promise<unknown>) => {
      const startedAt = Date.now();
      try {
        await Promise.race([
          run(),
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error(`warm-up budget ${budgetMs}ms exceeded`)), budgetMs)
          ),
        ]);
        console.log(`   ⚡ warm-up ${label}: ok (${Date.now() - startedAt}ms)`);
      } catch (err) {
        // Fail OPEN — log and continue booting.
        console.warn(
          `   ⚠️  warm-up ${label}: skipped after ${Date.now() - startedAt}ms — ` +
            `${(err as Error)?.message ?? String(err)} (first request will pay this cost)`
        );
      }
    };

    const warmPriceSource = process.env.AFI_PRICE_FEED_SOURCE?.trim();
    if (warmPriceSource) {
      await warmStep(`price-feed:${warmPriceSource}`, 20_000, async () => {
        // Forces the ccxt module import, exchange construction and loadMarkets.
        // NOTE: getOHLCV takes the AFI CANONICAL symbol and applies
        // toVenueSymbol() itself — passing a venue-formatted symbol here
        // double-suffixes it ("BTC/USDT:USDT" -> "BTC/USDT:USDT:USDT:USDT").
        const adapter = getPriceFeedAdapter(warmPriceSource);
        await adapter.getOHLCV({ symbol: "BTC/USDT", timeframe: "5m", limit: 2 });
      });
    }

    if (process.env.AFI_EVIDENCE_MONGODB_URI) {
      await warmStep("evidence-store", 20_000, () => warmEvidenceStore());
    }

    const server = app.listen(PORT, async () => {
      console.log(`🚀 AFI REACTOR - Scoring Pipeline`);
      console.log(`   Listening on http://localhost:${PORT}`);
      console.log(`   Endpoints:`);
      console.log(`     GET  /health`);
      console.log(`     POST /api/webhooks/tradingview`);
      console.log(`     POST /api/ingest/cpj (CPJ v0.1 ingestion - Telegram/Discord signals)`);
      console.log(``);
      console.log(`   Returns: ReactorScoredSignalV1 (signalId, analystScore, scoredAt, decayParams, lenses, rawUss)`);
      const priceSource = process.env.AFI_PRICE_FEED_SOURCE;
      console.log(`   Price Feed: ${priceSource ?? "(unset)"}`);
      if (!priceSource) {
        console.warn(
          `   ⚠️  AFI_PRICE_FEED_SOURCE is UNSET — live scoring will FAIL CLOSED ` +
            `(no silent synthetic fallback). Set AFI_PRICE_FEED_SOURCE=blofin|coinbase.`
        );
      }
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

    // SIGTERM-compatible graceful shutdown (Cloud Run sends SIGTERM).
    const onSignal = (signal: string) => {
      console.log(`\n📴 ${signal} received — shutting down AFI Reactor gracefully...`);
      shutdownReactor(server)
        .then(() => {
          console.log("✅ Clean shutdown complete.");
          process.exit(0);
        })
        .catch((err) => {
          console.error("❌ Shutdown error:", err);
          process.exit(1);
        });
    };
    process.once("SIGTERM", () => onSignal("SIGTERM"));
    process.once("SIGINT", () => onSignal("SIGINT"));
  };

  // Unexpected boot failure after registry validation must still be loud:
  // warm-up steps fail OPEN individually, so anything reaching here is real.
  void bootAndListen().catch((err) => {
    console.error("❌ BOOT FAILED:", (err as Error)?.message ?? String(err));
    process.exit(1);
  });
}
