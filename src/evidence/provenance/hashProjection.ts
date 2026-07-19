/**
 * Hash-projection layer — the NARROW field-specific number policy for
 * afi.hash.v1 preimages (District 2 M2; reference implementation).
 *
 * CanonicalHash v1 (`canonicalHashV1.ts`) rejects every raw non-integer
 * number, unconditionally — there is deliberately no flag that admits
 * arbitrary floats. Some merged D2 schemas, however, declare specific numeric
 * surfaces (the ScoredSignal v1 projection types `uwrScore` / `uwrAxes` /
 * `conviction` as JSON numbers), and this reference implementation's
 * enrichment lanes and OHLCV evidence fixtures carry number-typed fields.
 *
 * This module bridges the two SAFELY:
 *
 *  - Each hashed surface declares EXACTLY which keys may carry numeric
 *    values ({@link SCORE_DECIMAL_KEYS}, {@link ENRICHMENT_DECIMAL_KEYS},
 *    {@link OHLCV_DECIMAL_KEYS}).
 *  - {@link projectDecimalFieldsForHash} converts the values of those declared
 *    keys — ALWAYS, integer or not, so a field's preimage type never flips
 *    with its value — into deterministic canonical decimal STRINGS via
 *    {@link toCanonicalDecimalString}.
 *  - Everything else keeps the strict policy: any non-integer number left
 *    under an UNDECLARED key is still rejected by the canonicalizer
 *    (fail-closed).
 *  - The projection affects the HASH PREIMAGE ONLY. Emitted artifacts keep
 *    their schema-conformant JSON numbers.
 *  - Decimal representations are plain-notation shortest round-trip decimal
 *    strings ("0.1875", "42000.5") — NEVER scaled base-unit integer
 *    encodings (0.1875 projects to "0.1875", not a wei-style shifted value).
 *
 * ESM: relative imports use `.js`.
 */

import { CanonicalHashPolicyError } from "./canonicalHashV1.js";

/**
 * Known score-surface numeric keys (the merged ScoredSignal v1 schema types
 * these as JSON numbers): the aggregate UWR score, analyst conviction, and
 * the four UWR axis components used by this reference implementation.
 */
export const SCORE_DECIMAL_KEYS = [
  "uwrScore",
  "conviction",
  "structure",
  "execution",
  "risk",
  "insight",
] as const;

/**
 * Known enrichment-surface numeric keys carried by this reference
 * implementation's lane payloads / strategy-local enriched view (indicator
 * values, pattern confidence, sentiment score, AI/ML conviction, lane
 * confidence). Strategy-local field names — an implementation profile, not
 * protocol canon.
 */
export const ENRICHMENT_DECIMAL_KEYS = [
  "ema20",
  "ema50",
  "rsi14",
  "atr14",
  "emaDistancePct",
  "patternConfidence",
  "score",
  "convictionScore",
  "confidence",
] as const;

/** Known OHLCV evidence numeric keys (candle fixtures). */
export const OHLCV_DECIMAL_KEYS = [
  "open",
  "high",
  "low",
  "close",
  "volume",
] as const;

/**
 * Known numeric keys carried on the USS signal-input surface that is committed
 * by the input hash. The CPJ→USS mapper records the parser's confidence — a
 * fractional 0..1 value — at `provenance.cpjParseConfidence`; declaring it here
 * projects it to a canonical decimal STRING (afi.hash.v1-compatible), exactly as
 * the score/enrichment/OHLCV surfaces already handle their numbers, instead of
 * the strict canonicalizer failing closed on a raw non-integer float. A raw
 * decimal under any UNDECLARED USS key still fails closed. (TradingView-mapped
 * USS carries no numeric fields, so this is a structural no-op there.)
 */
export const USS_INPUT_DECIMAL_KEYS = ["cpjParseConfidence"] as const;

/**
 * Deterministically convert a finite number to its canonical decimal string:
 * the ECMAScript shortest round-trip decimal representation, expanded to
 * PLAIN notation (no exponent). `0.1875 -> "0.1875"`, `0 -> "0"`,
 * `-0 -> "0"`, `1e21 -> "1000000000000000000000"`. Never a scaled base-unit
 * integer encoding.
 */
export function toCanonicalDecimalString(value: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CanonicalHashPolicyError(
      "non-finite-number",
      "$",
      `cannot project non-finite number (${String(value)}) to a canonical decimal string`
    );
  }
  if (Object.is(value, -0)) {
    return "0";
  }
  const repr = String(value);
  if (!repr.includes("e") && !repr.includes("E")) {
    return repr;
  }
  return expandExponentNotation(repr);
}

/**
 * Expand an ECMAScript exponent-notation decimal string ("1.5e-7", "1e+21")
 * into plain decimal notation via deterministic string arithmetic (no
 * floating-point re-parsing).
 */
function expandExponentNotation(repr: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(repr);
  if (!match) {
    throw new CanonicalHashPolicyError(
      "unsupported-value",
      "$",
      `unrecognized numeric representation "${repr}"`
    );
  }
  const [, sign, intPart, fracPart = "", expPart] = match;
  const exponent = Number.parseInt(expPart, 10);
  const digits = `${intPart}${fracPart}`;
  // Decimal point sits after intPart.length digits; shift it by the exponent.
  const pointIndex = intPart.length + exponent;

  let out: string;
  if (pointIndex <= 0) {
    out = `0.${"0".repeat(-pointIndex)}${digits}`;
  } else if (pointIndex >= digits.length) {
    out = `${digits}${"0".repeat(pointIndex - digits.length)}`;
  } else {
    out = `${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
  }
  // Trim redundant zeros without changing the value.
  if (out.includes(".")) {
    out = out.replace(/0+$/, "").replace(/\.$/, "");
  }
  out = out.replace(/^0+(?=\d)/, "");
  return `${sign}${out}`;
}

/**
 * Recursively project a value for hashing: every entry whose key is in the
 * declared set and whose value is a number becomes its canonical decimal
 * string (integers included, so the preimage type of a declared field never
 * depends on its value). All other members pass through untouched — a
 * non-integer number under an undeclared key is later rejected by the strict
 * canonicalizer (fail-closed). Input is never mutated.
 */
export function projectDecimalFieldsForHash(
  value: unknown,
  declaredKeys: readonly string[]
): unknown {
  const declared: ReadonlySet<string> = new Set(declaredKeys);

  const project = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(project);
    }
    if (node !== null && typeof node === "object") {
      const source = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(source)) {
        if (child === undefined) {
          continue;
        }
        if (declared.has(key) && typeof child === "number") {
          out[key] = toCanonicalDecimalString(child);
        } else {
          out[key] = project(child);
        }
      }
      return out;
    }
    return node;
  };

  return project(value);
}
