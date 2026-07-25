/**
 * MarkitTick (TradingView) → USS v1.1 mapper — TradingView Low-Latency Origin
 * Prep v0.1.
 *
 * The MarkitTick "Adaptive RSI Supertrend" Pine indicator emits alert() JSON
 * payloads shaped like:
 *   { "ticker": "BINANCE:BTCUSDT", "tf": "5", "event": "bull_cross",
 *     "arsi": "61.25", "merged": "58.90" }
 *
 * v0.1 supports ONLY the two directional cross events:
 *   bull_cross → BUY / LONG
 *   bear_cross → SELL / SHORT
 * The other emitted events (squeeze_breakout, st_flip_bull/bear, ob_entry,
 * os_entry) are explicitly DEFERRED and rejected with a typed reason.
 *
 * Design (per the reactor map): this is a THIN adapter that normalizes the
 * MarkitTick shape into the existing `TradingViewAlertPayload`, reuses the
 * existing `mapTradingViewToUssV11` (no change to that mapper, no canonical
 * schema change), and then stamps MarkitTick source metadata onto the USS
 * provenance free-form slots (provenance is `additionalProperties: true`).
 *
 * @module markitTickMapper
 */

import { UssV11Payload } from "./ussValidator.js";
import {
  mapTradingViewToUssV11,
  type TradingViewAlertPayload,
  type ResolvedStrategyIdentity,
} from "./tradingViewMapper.js";

/** The MarkitTick indicator identity this adapter targets (source metadata). */
export const MARKITTICK_INDICATOR_ID = "markittick_adaptive_rsi_supertrend_v1";

/** Default staging providerId for this indicator (drives provider-binding resolution). */
export const MARKITTICK_DEFAULT_PROVIDER_ID = "giovanni_tradingview_staging";

/** Origin mode until a REAL TradingView webhook fires (post plan upgrade). */
export const ORIGIN_MODE_PREFLIGHT = "captured-preflight";
export const ORIGIN_MODE_LIVE = "tradingview-webhook";

/** Raw MarkitTick alert payload shape. */
export interface MarkitTickAlertPayload {
  ticker: string; // e.g. "BINANCE:BTCUSDT"
  tf: string; // TradingView timeframe token, e.g. "5", "60", "240", "D"
  event: string; // e.g. "bull_cross" | "bear_cross" | ...
  arsi?: string | number; // adaptive RSI value (indicator reading)
  merged?: string | number; // merged signal value (indicator reading)
  providerId?: string; // optional explicit provider identity
  signalId?: string; // optional explicit signal id
  secret?: string; // optional shared secret (route auth)
  [key: string]: any;
}

/** v0.1 supported cross events → AFI direction. */
const EVENT_DIRECTION: Record<string, "long" | "short"> = {
  bull_cross: "long",
  bear_cross: "short",
};

/** Events the indicator emits but that v0.1 deliberately defers. */
const DEFERRED_EVENTS = new Set([
  "squeeze_breakout",
  "st_flip_bull",
  "st_flip_bear",
  "ob_entry",
  "os_entry",
]);

export interface MarkitTickReject {
  code: "missing_field" | "deferred_event" | "unsupported_event";
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * Split a TradingView ticker "EXCHANGE:PAIR" into its parts.
 *
 * CRITICAL: the CPJ symbol normalizer strips on the colon assuming the PAIR is
 * BEFORE it (CCXT "BTC/USDT:USDT"); MarkitTick puts the VENUE before the colon,
 * so it must be split here (take the segment AFTER the colon).
 */
export function splitTicker(ticker: string): { symbol: string; exchange?: string } {
  const raw = String(ticker).trim();
  const idx = raw.indexOf(":");
  if (idx === -1) return { symbol: raw };
  const exchange = raw.slice(0, idx).trim() || undefined;
  const symbol = raw.slice(idx + 1).trim();
  return { symbol, exchange };
}

/**
 * Normalize a TradingView timeframe token to the AFI form.
 *   "5" → "5m", "15" → "15m", "60" → "1h", "240" → "4h",
 *   "D" → "1d", "W" → "1w", "M" → "1M".
 * Unknown forms pass through unchanged (fail-open on format, not on ingest).
 */
export function normalizeTimeframe(tf: string): string {
  const t = String(tf).trim();
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (n >= 60 && n % 60 === 0) return `${n / 60}h`;
    return `${n}m`;
  }
  const up = t.toUpperCase();
  if (up === "D") return "1d";
  if (up === "W") return "1w";
  if (up === "M") return "1M";
  return t;
}

export interface MarkitTickAdaptResult {
  ok: boolean;
  tvPayload?: TradingViewAlertPayload;
  direction?: "long" | "short";
  event?: string;
  exchange?: string;
  /** Raw indicator readings, as-emitted (committed via ingestHash + echoed on the response). */
  arsi?: string | number;
  merged?: string | number;
  error?: MarkitTickReject;
}

/**
 * Adapt a raw MarkitTick payload into a `TradingViewAlertPayload`.
 * Returns a typed reject for missing fields or unsupported/deferred events.
 */
export function adaptMarkitTickToTradingView(
  payload: MarkitTickAlertPayload
): MarkitTickAdaptResult {
  for (const f of ["ticker", "tf", "event"] as const) {
    const v = payload?.[f];
    if (v === undefined || v === null || v === "") {
      return {
        ok: false,
        error: { code: "missing_field", message: `Missing required MarkitTick field: ${f}` },
      };
    }
  }

  const event = String(payload.event);
  const direction = EVENT_DIRECTION[event];
  if (!direction) {
    const code = DEFERRED_EVENTS.has(event) ? "deferred_event" : "unsupported_event";
    return {
      ok: false,
      error: {
        code,
        message: `MarkitTick event '${event}' is not supported in v0.1 (only bull_cross → LONG, bear_cross → SHORT)`,
        detail: { event },
      },
    };
  }

  const { symbol, exchange } = splitTicker(String(payload.ticker));
  const timeframe = normalizeTimeframe(String(payload.tf));

  const tvPayload: TradingViewAlertPayload = {
    symbol,
    timeframe,
    // The route resolves the strategy via the provider binding's defaultStrategy
    // (MarkitTick names none); this field only feeds the mapper's providerRef,
    // which we override to the indicatorId in the augmentation step below.
    strategy: MARKITTICK_INDICATOR_ID,
    direction,
    providerId: payload.providerId || MARKITTICK_DEFAULT_PROVIDER_ID,
    market: "perp",
    ...(payload.signalId ? { signalId: payload.signalId } : {}),
    // Raw indicator readings carried as-emitted on TOP-LEVEL payload keys so they
    // ENTER the mapper's ingestHash: generateIngestHash uses an array-replacer over
    // the payload's TOP-LEVEL keys (nested objects are dropped), so top-level
    // arsi/merged are committed into the ingestHash (→ Evidence V3 inputHash) as
    // strings — no raw floats in the afi.hash.v1 preimage. Two alerts differing
    // only in arsi/merged therefore produce different ingestHashes. mapTradingView-
    // ToUssV11 reads only its known fields, so these never reach USS facts/provenance.
    ...(payload.arsi !== undefined ? { arsi: payload.arsi } : {}),
    ...(payload.merged !== undefined ? { merged: payload.merged } : {}),
  };

  return {
    ok: true,
    tvPayload,
    direction,
    event,
    exchange,
    arsi: payload.arsi,
    merged: payload.merged,
  };
}

export interface MarkitTickMapResult {
  ok: boolean;
  uss?: UssV11Payload;
  error?: MarkitTickReject;
  meta?: {
    indicatorId: string;
    event: string;
    direction: "long" | "short";
    originMode: string;
    symbol: string;
    timeframe: string;
    exchange?: string;
    arsi?: string | number;
    merged?: string | number;
  };
}

/**
 * Map a raw MarkitTick payload to canonical USS v1.1 (adapter + reuse of the
 * TradingView mapper + source-metadata provenance augmentation).
 *
 * Source metadata (req 5) rides the USS provenance free-form slots — NO
 * canonical schema change: provenance is additionalProperties:true, and
 * providerType 'tradingview' is already an enum member.
 */
export function mapMarkitTickToUssV11(
  payload: MarkitTickAlertPayload,
  resolvedStrategy: ResolvedStrategyIdentity,
  opts?: { originMode?: string }
): MarkitTickMapResult {
  const adapted = adaptMarkitTickToTradingView(payload);
  if (!adapted.ok) return { ok: false, error: adapted.error };

  const tvPayload = adapted.tvPayload!;
  const uss = mapTradingViewToUssV11(tvPayload, resolvedStrategy);

  const originMode = opts?.originMode ?? ORIGIN_MODE_PREFLIGHT;

  // Source metadata via the free-form USS provenance slots (provenance is
  // additionalProperties:true) — all STRINGS, so no schema change and no raw
  // floats in the afi.hash.v1 evidence preimage. NOTE: provenance.providerType
  // here is free-form metadata, distinct from the provider-binding providerType
  // ENUM (webhook|cpj|gateway) — the giovanni binding is 'webhook'. The raw
  // arsi/merged readings are committed via the ingestHash (top-level payload
  // fields) and echoed on the response; they are not stamped as numbers here.
  uss.provenance.source = "tradingview";
  uss.provenance.providerType = "tradingview";
  uss.provenance.indicatorId = MARKITTICK_INDICATOR_ID;
  uss.provenance.indicatorEvent = adapted.event!;
  uss.provenance.originMode = originMode;
  uss.provenance.providerRef = MARKITTICK_INDICATOR_ID;
  if (adapted.exchange) uss.provenance.sourceExchange = adapted.exchange;

  return {
    ok: true,
    uss,
    meta: {
      indicatorId: MARKITTICK_INDICATOR_ID,
      event: adapted.event!,
      direction: adapted.direction!,
      originMode,
      symbol: tvPayload.symbol,
      timeframe: tvPayload.timeframe,
      ...(adapted.exchange ? { exchange: adapted.exchange } : {}),
      ...(adapted.arsi !== undefined ? { arsi: adapted.arsi } : {}),
      ...(adapted.merged !== undefined ? { merged: adapted.merged } : {}),
    },
  };
}
