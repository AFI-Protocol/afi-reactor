/**
 * Deterministic canonical hashing for the pipehead demo.
 *
 * Generalizes the canonical-JSON precedent in
 * `src/uss/tradingViewMapper.ts#generateIngestHash` into a recursive,
 * key-SORTED canonicalizer that drops a fixed set of runtime timestamp keys
 * before hashing, so identical content always yields an identical sha256 digest
 * regardless of key insertion order or human-facing timestamps.
 */

import crypto from "crypto";
import type { DemoScoredSignal } from "./types.js";

/**
 * Runtime timestamp keys stripped from every object before hashing. These are
 * for humans only and must never influence a content hash.
 */
export const EXCLUDED_TIMESTAMP_KEYS = [
  "scoredAt",
  "issuedAt",
  "producedAt",
  "normalizedAt",
  "startedAt",
  "finishedAt",
  "at",
  "timestamp",
] as const;

export interface CanonicalizeOptions {
  /** Additional keys to drop, in union with {@link EXCLUDED_TIMESTAMP_KEYS}. */
  excludeKeys?: readonly string[];
}

function canonicalValue(value: unknown, exclude: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalValue(item, exclude));
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (exclude.has(key)) {
        continue;
      }
      const child = source[key];
      if (child === undefined) {
        continue;
      }
      out[key] = canonicalValue(child, exclude);
    }
    return out;
  }
  return value;
}

/**
 * Produce a canonical, key-sorted JSON string with timestamp keys (and any
 * extra `excludeKeys`) removed recursively.
 */
export function canonicalize(value: unknown, options: CanonicalizeOptions = {}): string {
  const exclude = new Set<string>([
    ...EXCLUDED_TIMESTAMP_KEYS,
    ...(options.excludeKeys ?? []),
  ]);
  return JSON.stringify(canonicalValue(value, exclude));
}

/** sha256 of the canonical form, as a 64-char lowercase hex string. */
export function canonicalHash(value: unknown, options: CanonicalizeOptions = {}): string {
  return crypto.createHash("sha256").update(canonicalize(value, options)).digest("hex");
}

export interface ScoringProjection {
  uwrScore: number;
  uwrAxes: { structure: number; execution: number; risk: number; insight: number };
  analystId: unknown;
  strategyId: unknown;
  direction: unknown;
  riskBucket: unknown;
  conviction: unknown;
}

/**
 * Build the explicit deterministic projection of a scored signal that
 * `outputHash` commits to: never the raw timestamped object. Identity and
 * risk fields are read from the embedded afi-core AnalystScoreTemplate.
 */
export function buildScoringProjection(scored: DemoScoredSignal): ScoringProjection {
  const analyst = (scored.analystScore ?? {}) as Record<string, unknown>;
  return {
    uwrScore: scored.uwrScore,
    uwrAxes: scored.uwrAxes,
    analystId: analyst.analystId,
    strategyId: analyst.strategyId,
    direction: analyst.direction,
    riskBucket: analyst.riskBucket,
    conviction: analyst.conviction,
  };
}
