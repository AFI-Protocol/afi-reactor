/**
 * DEM-PRODUCER-PLAN — the technical lane's trade-plan verification law
 * (DEM-GOV D-DEM-5(6); §9 DEM-PRODUCER-PLAN, owner-authorized 2026-08-25).
 *
 * "No producer may emit as its own output a value whose sole origin is an
 * assertion by the party who submitted the signal, unless that value is
 * verifiable against observed market data and is validated as such by the
 * producer that emits it … and refused when it cannot be checked."
 *
 * THE LAW (pure; no I/O; reads NO submitted side — plan geometry is derived
 * from the submitted PRICES only, so DIR-GOV D-DIR-3 is honored by
 * construction):
 *   envelope   L = min(low), H = max(high) over the fetched window; W = H − L
 *              (W > 0 required — a flat window cannot verify anything);
 *   band       every submitted level (entry bound(s), stop, each target) must
 *              lie within [L − W, H + W]: one observed-range width around the
 *              observed window. Breakout entries above the range and limit
 *              entries below it are lawful; a level a full range-width away
 *              from anything the market printed is not verifiable;
 *   geometry   (only when a stop AND at least one target are submitted) every
 *              target lies on the same side of the stop, and the ENTIRE entry
 *              — both bounds of a range — lies strictly between the stop and
 *              every target. R:R is computed at the conservative bound
 *              (nearest the targets: smallest reward, largest risk);
 *   R:R        |firstTarget − entry| / |entry − stop| where firstTarget is the
 *              target nearest the entry, quantised to 4 decimals (see roundRr).
 * Any violation REFUSES the determination (TradePlanVerificationError — a
 * NodeConfigurationError: no retry, pipeline abort, no score, no record).
 *
 * Declared producer absences (D-DEM-5(4)(b)): no stop or no target → no
 * `rrToFirstTarget` (nothing to verify: no R:R was claimed); an entry range
 * with no stop/target geometry → no `entryPrice`.
 *
 * This is profile math of the reference technical lane (MATH-GOV): it
 * promotes nothing into afi-math and sets no scoring-law value.
 */
import { NodeConfigurationError } from "../pipeline/nodeSdk.js";
import type { AfiCandle } from "../types/AfiCandle.js";
import type { TechnicalPlanFacts, TradePlanV1 } from "../types/TradePlan.js";

export class TradePlanVerificationError extends NodeConfigurationError {
  readonly code = "trade_plan_unverifiable" as const;
  readonly reason: string;
  constructor(reason: string) {
    super(`trade plan unverifiable against the fetched candles: ${reason}`);
    this.name = "TradePlanVerificationError";
    this.reason = reason;
  }
}

const DECIMAL_STRING = /^[0-9]+(\.[0-9]+)?$/;

function refuse(reason: string): never {
  throw new TradePlanVerificationError(reason);
}

function parsePrice(label: string, raw: unknown): number {
  if (typeof raw !== "string" || !DECIMAL_STRING.test(raw)) {
    refuse(`${label} is not a decimal-string price (${JSON.stringify(raw)})`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) refuse(`${label} is not a positive finite price (${raw})`);
  return value;
}

/**
 * The R:R quantisation: `Math.round(value · 1e4) / 1e4` — IEEE-754 binary
 * arithmetic, DETERMINISTIC for every input (what a sealed record needs), not
 * exact decimal half-up: a decimal tie such as 0.00015 is not representable in
 * binary and rounds by its stored value (0.00015 → 0.0001). R:R is a ratio of
 * float prices, so an exact decimal tie is not reachable in practice.
 */
export function roundRr(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

export function verifyTradePlan(plan: TradePlanV1, candles: readonly AfiCandle[]): TechnicalPlanFacts {
  if (
    !plan ||
    typeof plan !== "object" ||
    plan.schema !== "afi.trade-plan.v1" ||
    !plan.levels ||
    typeof plan.levels !== "object" ||
    Array.isArray(plan.levels)
  ) {
    refuse("plan is not an afi.trade-plan.v1 object");
  }
  if (candles.length === 0) refuse("no fetched candles to verify against");

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const c of candles) {
    if (!Number.isFinite(c.low) || !Number.isFinite(c.high) || c.low <= 0 || c.high < c.low) {
      refuse("fetched window carries a malformed candle");
    }
    if (c.low < low) low = c.low;
    if (c.high > high) high = c.high;
  }
  const width = high - low;
  if (!(width > 0)) refuse("fetched window is flat (zero observed range)");
  const bandLow = low - width;
  const bandHigh = high + width;
  // The band is INCLUSIVE at both edges. `low - width` is computed in binary
  // floating point, so a level submitted as the exact decimal edge can land a
  // few ulps outside it; compare with a relative tolerance so the inclusive
  // law holds for non-integer windows too (fail-closed direction unchanged:
  // this only prevents a spurious refusal at the edge itself).
  const EDGE_ULPS = 1e-12;
  const tolerance = (bound: number): number => Math.abs(bound) * EDGE_ULPS;
  const show = (value: number): string => Number(value.toPrecision(12)).toString();
  const inBand = (label: string, price: number): number => {
    if (price < bandLow - tolerance(bandLow) || price > bandHigh + tolerance(bandHigh)) {
      refuse(
        `${label} ${show(price)} lies outside the observed band [${show(bandLow)}, ${show(bandHigh)}] ` +
          `(window low ${show(low)}, high ${show(high)}, ${candles.length} candles)`
      );
    }
    return price;
  };

  // --- entry (single price or range) ---
  const entryRaw = plan.levels.entry;
  let entryLow: number;
  let entryHigh: number;
  if (typeof entryRaw === "string") {
    entryLow = entryHigh = inBand("entry", parsePrice("entry", entryRaw));
  } else if (entryRaw && typeof entryRaw === "object") {
    entryLow = inBand("entry.min", parsePrice("entry.min", (entryRaw as { min?: unknown }).min));
    entryHigh = inBand("entry.max", parsePrice("entry.max", (entryRaw as { max?: unknown }).max));
    if (entryLow > entryHigh) refuse(`entry range is inverted (min ${entryLow} > max ${entryHigh})`);
  } else {
    refuse("entry is neither a price nor a range");
  }

  // --- stop / targets (each verified against the band whenever present) ---
  const stopPrice =
    plan.levels.stopLoss !== undefined
      ? inBand("stopLoss", parsePrice("stopLoss", plan.levels.stopLoss))
      : undefined;
  const rawTargets = plan.levels.takeProfits;
  if (rawTargets !== undefined && !Array.isArray(rawTargets)) {
    refuse(`takeProfits is not an array (${typeof rawTargets})`);
  }
  const targets: number[] = [];
  for (const [i, tp] of (rawTargets ?? []).entries()) {
    targets.push(inBand(`takeProfits[${i}].price`, parsePrice(`takeProfits[${i}].price`, tp?.price)));
  }

  const facts: TechnicalPlanFacts = {
    entryLow,
    entryHigh,
    targetCount: targets.length,
    envelopeLow: low,
    envelopeHigh: high,
    barCount: candles.length,
  };
  if (entryLow === entryHigh) facts.entryPrice = entryLow;
  if (stopPrice !== undefined) facts.stopPrice = stopPrice;

  // --- geometry + R:R only when a stop AND a target were submitted ---
  if (stopPrice === undefined || targets.length === 0) return facts;

  const above = targets.filter((t) => t > stopPrice).length;
  const below = targets.filter((t) => t < stopPrice).length;
  if (above > 0 && below > 0) refuse("targets lie on both sides of the stop");
  if (above === 0 && below === 0) refuse("a target equals the stop");
  const longGeometry = above > 0;
  // Conservative entry bound: nearest the targets (smallest reward, largest
  // risk). The stop is checked against the FAR bound as well, so an entry
  // RANGE that contains — or sits the wrong side of — its own stop refuses
  // rather than being verified at one end (review finding, 2026-08-25).
  const entryPrice = longGeometry ? entryHigh : entryLow;
  const entryFar = longGeometry ? entryLow : entryHigh;
  if (longGeometry) {
    if (!(stopPrice < entryFar)) {
      refuse(
        entryFar === entryPrice
          ? `stop ${stopPrice} is not below the entry ${entryPrice}`
          : `stop ${stopPrice} is not below the whole entry range [${entryLow}, ${entryHigh}]`
      );
    }
    for (const t of targets) if (!(t > entryPrice)) refuse(`target ${t} is not above the entry ${entryPrice}`);
  } else {
    if (!(stopPrice > entryFar)) {
      refuse(
        entryFar === entryPrice
          ? `stop ${stopPrice} is not above the entry ${entryPrice}`
          : `stop ${stopPrice} is not above the whole entry range [${entryLow}, ${entryHigh}]`
      );
    }
    for (const t of targets) if (!(t < entryPrice)) refuse(`target ${t} is not below the entry ${entryPrice}`);
  }
  let firstTarget = targets[0];
  for (const t of targets) if (Math.abs(t - entryPrice) < Math.abs(firstTarget - entryPrice)) firstTarget = t;
  const risk = Math.abs(entryPrice - stopPrice);
  const reward = Math.abs(firstTarget - entryPrice);
  facts.entryPrice = entryPrice;
  facts.firstTargetPrice = firstTarget;
  facts.rrToFirstTarget = roundRr(reward / risk);
  return facts;
}
