/**
 * Pure helpers for capture-outcomes (DH-GOV D-DH-2 / D-DH-3).
 * No I/O here — everything is unit-testable via test/operational/.
 */

export const CANDLE_MS = 5 * 60_000;
const HOUR_MIN = 60;

/**
 * DH-GOV D-DH-2(3) cutover instant: scoring-context docs captured BEFORE this
 * instant complete their capture under the legacy global set (1h/4h/24h);
 * docs captured at/after it derive {H/4, H/2, H} from their stamped
 * decayParams. Set to the deploy timestamp of the DH-GOV program image.
 *
 * Set 2026-08-03 as the final act before the DH-GOV program image build
 * (D-DH-2(3); DH-GOV accepted via afi-governance PR #37, merge e7b85e3).
 * Docs captured before this instant complete under legacy law; any doc
 * scored by the pre-DH image during the build/deploy window carries a
 * swing stamp and lawfully derives that stamp's windows (stamped-value law).
 */
export const DH_CUTOVER_ISO = "2026-08-03T06:31:14Z";

/** Legacy global horizon set (pre-DH-GOV law; also the defensive fallback). */
export const LEGACY_HORIZON_MINUTES = [60, 240, 1440];

/**
 * D-DH-2(1): {ceil(H/4), ceil(H/2), H} minutes from the stamped half-life.
 * H is used exactly as stamped (never rewritten); a fractional inline H only
 * ceils where the law says ceil — the outer window ceils solely to keep
 * whole-minute labels, which for every governed (integer) template is H itself.
 */
export function deriveHorizonMinutes(halfLifeMinutes) {
  if (!Number.isFinite(halfLifeMinutes) || halfLifeMinutes <= 0) return null;
  const H = halfLifeMinutes;
  return [Math.ceil(H / 4), Math.ceil(H / 2), Math.ceil(H)];
}

/** D-DH-2(1) label grammar: whole hours render "<n>h", otherwise "<n>m". */
export function horizonLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes % HOUR_MIN === 0 ? `${minutes / HOUR_MIN}h` : `${minutes}m`;
}

/** Inverse of horizonLabel; used to validate --horizons operator overrides. */
export function parseHorizonLabel(label) {
  const m = /^(\d+)(m|h)$/.exec(String(label).trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2] === "h" ? n * HOUR_MIN : n;
}

/**
 * Resolve the horizon plan for one scoring-context doc.
 * Returns { basis, horizons: [{label, minutes, fractionOfHalfLife?}], decayRef? }.
 *  - operator override (explicit --horizons) wins outright;
 *  - docs captured before the cutover, or with an unusable decay stamp,
 *    fall back to the legacy global set (D-DH-2(3)/(4));
 *  - otherwise horizons derive from the stamped decayParams (D-DH-2(1)).
 */
export function resolveHorizonPlan(ctx, { overrideMinutes = null, cutoverIso = DH_CUTOVER_ISO } = {}) {
  if (Array.isArray(overrideMinutes) && overrideMinutes.length > 0) {
    return {
      basis: "operator-override",
      horizons: overrideMinutes.map((m) => ({ label: horizonLabel(m), minutes: m })),
    };
  }
  const capturedMs = Date.parse(ctx?.capturedAt ?? "");
  const cutoverMs = Date.parse(cutoverIso);
  const half = ctx?.decayParams?.halfLifeMinutes;
  const templateId = ctx?.decayParams?.greeksTemplateId;
  const derived = deriveHorizonMinutes(half);
  // Fail-closed (D-DH-2(3)): derivation requires a PARSEABLE cutover the doc
  // is at-or-after. An unparseable cutover (NaN) must send everything to the
  // legacy branch — `capturedMs >= NaN` is false, so the guard below is
  // NaN-safe by construction; callers (the capture script) additionally
  // refuse to run at all on an unparseable DH_CUTOVER_ISO.
  const atOrAfterCutover = Number.isFinite(cutoverMs) && capturedMs >= cutoverMs;
  if (!Number.isFinite(capturedMs) || !atOrAfterCutover || derived === null || typeof templateId !== "string") {
    return {
      basis: "legacy-global",
      horizons: LEGACY_HORIZON_MINUTES.map((m) => ({ label: horizonLabel(m), minutes: m })),
    };
  }
  const fractions = [0.25, 0.5, 1];
  return {
    basis: "decay-derived",
    decayRef: { greeksTemplateId: templateId, halfLifeMinutes: half },
    horizons: derived.map((m, i) => ({ label: horizonLabel(m), minutes: m, fractionOfHalfLife: fractions[i] })),
  };
}

/**
 * D-DH-4(1) window selection with head assertion: from a fetched candle
 * array, keep candles in [sinceMs, endMs] and REFUSE a window whose first
 * candle opens after the capture instant — a front-truncated fetch (e.g. an
 * exchange returning only its newest candles) must throw loudly rather than
 * let a wrong entry price write a permanent row.
 */
export function selectWindow(candles, sinceMs, endMs, capturedMs) {
  const inWindow = (candles ?? []).filter(([ts]) => ts >= sinceMs && ts <= endMs);
  if (inWindow.length < 2) {
    throw new Error(`insufficient candles (${inWindow.length})`);
  }
  if (inWindow[0][0] > capturedMs) {
    throw new Error(
      `window head missing: first candle ${new Date(inWindow[0][0]).toISOString()} opens after capture ${new Date(capturedMs).toISOString()} (front-truncated fetch)`
    );
  }
  return inWindow;
}

/**
 * Governed-fact symbol translation (unchanged law — reactor #70): the USS
 * market fact, never symbol notation, decides the ccxt mapping; the legacy
 * ".P" suffix is still honored; no market fact → null (honest skip).
 */
export function toCcxtSymbol(symbol, market) {
  if (typeof symbol !== "string" || !symbol.includes("/")) return null;
  if (symbol.endsWith(".P")) return `${symbol.slice(0, -2)}:USDT`;
  if (market === "perp") {
    const quote = symbol.split("/")[1];
    return quote === "USDT" ? `${symbol}:USDT` : null;
  }
  if (market === "spot") return symbol;
  return null;
}

/**
 * D-DH-3(2): direction-adjusted excursion values AND their timing.
 * `inWindow` is the ordered [ts, o, h, l, c] candle array; `sign` is
 * +1 long / -1 short / 0 neutral (neutral follows the long branch, matching
 * the v0 mfe/mae convention). First occurrence wins on ties (strict compare).
 * Returns { mfePct, maePct, mfeAtMinutes, maeAtMinutes }.
 */
export function excursions(inWindow, entryPrice, sign) {
  let maxHigh = -Infinity, minLow = Infinity, maxHighTs = null, minLowTs = null;
  for (const [ts, , high, low] of inWindow) {
    if (high > maxHigh) { maxHigh = high; maxHighTs = ts; }
    if (low < minLow) { minLow = low; minLowTs = ts; }
  }
  const entryTs = inWindow[0][0];
  const mins = (ts) => Math.round((ts - entryTs) / 60_000);
  const favorable = sign >= 0
    ? { pct: ((maxHigh - entryPrice) / entryPrice) * 100, ts: maxHighTs }
    : { pct: ((entryPrice - minLow) / entryPrice) * 100, ts: minLowTs };
  const adverse = sign >= 0
    ? { pct: ((entryPrice - minLow) / entryPrice) * 100, ts: minLowTs }
    : { pct: ((maxHigh - entryPrice) / entryPrice) * 100, ts: maxHighTs };
  return {
    mfePct: favorable.pct,
    maePct: adverse.pct,
    mfeAtMinutes: mins(favorable.ts),
    maeAtMinutes: mins(adverse.ts),
  };
}
