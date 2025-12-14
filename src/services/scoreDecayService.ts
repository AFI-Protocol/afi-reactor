/**
 * Score Decay Service
 *
 * Provides utilities for computing time-decayed scores from TSSD vault documents
 * using Greeks-style exponential decay.
 *
 * This service bridges the gap between stored signal data and real-time score calculations,
 * enabling time-aware ranking and filtering of signals.
 */

import { applyTimeDecay } from "afi-core/decay";
import type { TssdSignalDocument } from "../types/TssdSignalDocument.js";

/**
 * Compute the time-decayed UWR score for a stored signal document.
 *
 * @param doc - TSSD signal document from vault
 * @param nowIso - ISO timestamp representing "now" (for deterministic testing)
 * @returns Decayed UWR score in [0, 1] range, or null if scoring data is incomplete
 *
 * @example
 * ```typescript
 * const doc = await tssdVault.findOne({ signalId: "sig-123" });
 * const decayedScore = computeDecayedUwrScore(doc, new Date().toISOString());
 * // => 0.5 (if one half-life has elapsed)
 * ```
 */
export function computeDecayedUwrScore(
  doc: TssdSignalDocument,
  nowIso: string
): number | null {
  // Require all necessary fields
  const uwrScore = doc.pipeline.analystScore?.uwrScore;
  const scoredAt = doc.pipeline.scoredAt;
  const halfLifeMinutes = doc.pipeline.decayParams?.halfLifeMinutes;

  // Return null if any required field is missing
  if (
    uwrScore === undefined ||
    scoredAt === undefined ||
    halfLifeMinutes === undefined
  ) {
    return null;
  }

  // Apply exponential time decay
  return applyTimeDecay(uwrScore, scoredAt, nowIso, { halfLifeMinutes });
}

