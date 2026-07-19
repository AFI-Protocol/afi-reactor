/**
 * tiny-brains.hash.v1 — the reactor-side KAT-proven verifier implementation
 * of the Tiny Brains service canonicalization law (EV3-GOV D-EV3-4(5)).
 *
 * The service law (afi-tiny-brains tiny_brains_service/orchestration/
 * invocation_record.py) is:
 *
 *   canonical_json(value) = json.dumps(value, sort_keys=True,
 *                                      separators=(",", ":"),
 *                                      ensure_ascii=False)
 *   hash_payload(value)   = sha256(utf8(canonical_json(value))).hexdigest()
 *
 * This module reproduces that law byte-exactly over the PROVEN DOMAIN and
 * FAILS CLOSED outside it. These are OPAQUE boundary commitments — a THIRD
 * canonicalization law, distinct from BOTH afi.hash.v1 laws; they are plain
 * hex digests, never CanonicalHash objects, and must never be recomputed
 * under either afi.hash.v1 law.
 *
 * Python-vs-JS number formatting (the entire reason this module exists):
 *  - Python floats repr in decimal for 1e-4 <= |x| < 1e16 (shortest
 *    round-trip — identical to the ECMAScript shortest form there);
 *  - INTEGRAL floats print "N.0" ("0.0", "1.0") — JSON cannot distinguish
 *    0.0 from 0 after parsing, so callers DECLARE which keys are float
 *    fields (the closed response contract carries exactly one:
 *    `convictionScore`);
 *  - 0 < |x| < 1e-4 prints in exponent form with a two-digit zero-padded
 *    exponent ("1e-06", "5e-05", "1.5e-05");
 *  - |x| >= 1e16, NaN, Infinity, and negative zero are OUTSIDE the proven
 *    domain → fail closed (TinyBrainsHashDomainError).
 *
 * Strings: ensure_ascii=False → raw UTF-8 pass-through; Python escapes
 * exactly what JSON.stringify escapes (", \\, control chars < 0x20 with the
 * short escapes \b \t \n \f \r and \uXXXX otherwise); lone surrogates are
 * not UTF-8-encodable in Python → fail closed. Object keys sort by Unicode
 * CODE POINT (Python str ordering), not UTF-16 code units.
 *
 * Proven by the vendored Python-generated KAT vectors
 * (test/providers/fixtures/tiny_brains_hash_v1_kats.json).
 */

import { createHash } from "node:crypto";

/** The service canonicalization-law identifier this module implements. */
export const TINY_BRAINS_HASH_LAW = "tiny-brains.hash.v1" as const;

/** A value outside the KAT-proven tiny-brains.hash.v1 domain (fail closed). */
export class TinyBrainsHashDomainError extends Error {
  readonly path: string;
  constructor(path: string, detail: string) {
    super(`tiny-brains.hash.v1 domain violation at ${path}: ${detail}`);
    this.name = "TinyBrainsHashDomainError";
    this.path = path;
  }
}

export interface TinyBrainsCanonicalJsonOptions {
  /**
   * Keys whose numeric values are DECLARED floats by the closed service
   * contract (Python floats serialize "0.0"/"1.0" for integral values —
   * indistinguishable from ints after JSON.parse without this declaration).
   */
  floatKeys?: ReadonlySet<string>;
}

/** The /predict/froggy prediction payload's single declared float field. */
export const PREDICT_FROGGY_FLOAT_KEYS: ReadonlySet<string> = new Set(["convictionScore"]);

/** Lone-surrogate detector (not UTF-8-encodable → Python would throw). */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++; // well-formed pair
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/**
 * Python float repr over the proven domain. `declaredFloat` forces the
 * integral-float form ("N.0"); an undeclared integral number serializes as a
 * Python int.
 */
export function pyNumberRepr(value: number, declaredFloat: boolean, path: string): string {
  if (!Number.isFinite(value)) {
    throw new TinyBrainsHashDomainError(path, `non-finite number (${String(value)})`);
  }
  if (Object.is(value, -0)) {
    throw new TinyBrainsHashDomainError(path, "negative zero is outside the proven domain");
  }
  const abs = Math.abs(value);
  if (abs >= 1e16) {
    throw new TinyBrainsHashDomainError(
      path,
      `|${String(value)}| >= 1e16 is outside the proven domain`
    );
  }
  if (Number.isInteger(value)) {
    // Python int ("0") vs integral float ("0.0") — declaration decides.
    return declaredFloat ? `${String(value)}.0` : String(value);
  }
  if (abs < 1e-4) {
    // Python exponent form: shortest mantissa + 'e-' + two-digit exponent.
    const exp = value.toExponential(); // shortest mantissa, e.g. "1e-6", "1.5e-5"
    const m = /^(-?\d(?:\.\d+)?)e([+-])(\d+)$/.exec(exp);
    if (!m) {
      throw new TinyBrainsHashDomainError(path, `unexpected exponential form '${exp}'`);
    }
    const [, mantissa, sign, digits] = m;
    if (sign !== "-") {
      throw new TinyBrainsHashDomainError(path, `unexpected positive exponent for ${exp}`);
    }
    const padded = digits.length < 2 ? `0${digits}` : digits;
    return `${mantissa}e-${padded}`;
  }
  // 1e-4 <= |x| < 1e16: ECMAScript shortest round-trip coincides with Python repr.
  return String(value);
}

function pyString(value: string, path: string): string {
  if (hasLoneSurrogate(value)) {
    throw new TinyBrainsHashDomainError(path, "lone surrogate is not UTF-8-encodable");
  }
  // JSON.stringify matches Python json.dumps(ensure_ascii=False) string
  // escaping exactly: ", \\ and control chars < 0x20 (short escapes
  // \b \t \n \f \r, \uXXXX otherwise); everything else raw.
  return JSON.stringify(value);
}

/** Python `sorted()` over str keys — Unicode CODE POINT order. */
function codePointCompare(a: string, b: string): number {
  const aa = Array.from(a);
  const bb = Array.from(b);
  const n = Math.min(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const ca = aa[i].codePointAt(0)!;
    const cb = bb[i].codePointAt(0)!;
    if (ca !== cb) return ca - cb;
  }
  return aa.length - bb.length;
}

function canonicalValue(
  value: unknown,
  path: string,
  floatKeys: ReadonlySet<string>,
  declaredFloat: boolean
): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return pyString(value, path);
  if (typeof value === "number") return pyNumberRepr(value, declaredFloat, path);
  if (Array.isArray(value)) {
    return `[${value
      .map((item, i) => canonicalValue(item, `${path}[${i}]`, floatKeys, declaredFloat))
      .join(",")}]`;
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort(codePointCompare);
    const members: string[] = [];
    for (const key of keys) {
      const child = source[key];
      if (child === undefined) {
        throw new TinyBrainsHashDomainError(
          `${path}.${key}`,
          "undefined members have no Python JSON form (absence-not-null contract)"
        );
      }
      members.push(
        `${pyString(key, `${path}.${key}`)}:${canonicalValue(
          child,
          `${path}.${key}`,
          floatKeys,
          floatKeys.has(key)
        )}`
      );
    }
    return `{${members.join(",")}}`;
  }
  throw new TinyBrainsHashDomainError(path, `${typeof value} values have no Python JSON form`);
}

/**
 * Byte-exact replica of the service's canonical_json() over the proven
 * domain; fails closed (TinyBrainsHashDomainError) outside it.
 */
export function tinyBrainsCanonicalJson(
  value: unknown,
  options: TinyBrainsCanonicalJsonOptions = {}
): string {
  return canonicalValue(value, "$", options.floatKeys ?? new Set(), false);
}

/** sha256 hex over the UTF-8 bytes of the canonical JSON (hash_payload). */
export function tinyBrainsHashPayload(
  value: unknown,
  options: TinyBrainsCanonicalJsonOptions = {}
): string {
  return createHash("sha256")
    .update(tinyBrainsCanonicalJson(value, options), "utf-8")
    .digest("hex");
}
