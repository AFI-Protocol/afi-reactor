/**
 * DLC-GOV D-DLC-3: the read-side decay derivation — the visible dynamic
 * process. Computes the DERIVED decayed value for a scored signal at
 * serving time from exactly three inputs: the sealed score, the
 * determination's stamped `decayParams.halfLifeMinutes` (TDR-GOV stamp),
 * and elapsed time since the sealed scoring timestamp.
 *
 * Binding properties (D-DLC-3(1)-(3)):
 * - READ-SIDE ONLY: this block exists on the HTTP response layer of the
 *   existing scored-signal serving surface. It is never persisted — it
 *   enters no evidence byte, no hash preimage, no golden, and no
 *   analytics capture (the scoring-context store copies members of the
 *   scored payload, never this response-layer block).
 * - FAIL-CLOSED: no stamped params (or a malformed stamp/timestamp) means
 *   NO derived decay — no default half-life, no unit guess. The silent
 *   24h fallback is retired (D-DLC-3(2)).
 * - LABELED DERIVED: the block names its law and carries `derived: true`.
 *   The sealed score never changes; `decayedScore` is a derivation any
 *   reader can recompute from the sealed record plus the registered
 *   configuration its analystConfigHash pins (D-DLC-1).
 *
 * The math is afi-core's canonical minutes-based `applyTimeDecay`
 * (src/decay), bit-exact against the governed 32-vector
 * apply-time-decay KAT (afi-config kats/uwr-profile/v0).
 */
import { applyTimeDecay } from "afi-core/decay";
import type { ReactorScoredSignalV1 } from "../types/ReactorScoredSignalV1.js";

export interface DerivedDecayBlock {
  /** Always true: this is presentation of a derivation, never a sealed value. */
  derived: true;
  /** The canonical decay law (DLC-GOV D-DLC-1), stated for the reader. */
  law: "decayed = sealedScore * 0.5^(elapsedMinutes / halfLifeMinutes)";
  sealedScore: number;
  decayedScore: number;
  elapsedMinutes: number;
  halfLifeMinutes: number;
  greeksTemplateId: string;
  scoredAt: string;
  asOf: string;
}

/**
 * Build the derived-decay response block for a scored signal, or return
 * undefined (fail-closed) when the determination carries no usable stamp.
 */
export function buildDerivedDecayBlock(
  scored: Pick<ReactorScoredSignalV1, "analystScore" | "scoredAt" | "decayParams">,
  nowIso: string = new Date().toISOString()
): DerivedDecayBlock | undefined {
  const params = scored.decayParams;
  if (
    !params ||
    typeof params.halfLifeMinutes !== "number" ||
    !Number.isFinite(params.halfLifeMinutes) ||
    params.halfLifeMinutes <= 0 ||
    typeof params.greeksTemplateId !== "string"
  ) {
    return undefined; // no stamp → no derived decay (D-DLC-3(2))
  }
  const sealedScore = scored.analystScore?.uwrScore;
  if (typeof sealedScore !== "number" || !Number.isFinite(sealedScore)) {
    return undefined;
  }
  const scoredAtMs = Date.parse(scored.scoredAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(scoredAtMs) || !Number.isFinite(nowMs)) {
    return undefined;
  }
  // Same clamp the canonical applier uses internally: a future-dated
  // scoredAt derives as elapsed 0, never a negative age.
  const elapsedMinutes = Math.max(0, (nowMs - scoredAtMs) / 60_000);
  const decayedScore = applyTimeDecay(sealedScore, scored.scoredAt, nowIso, {
    halfLifeMinutes: params.halfLifeMinutes,
  });
  return {
    derived: true,
    law: "decayed = sealedScore * 0.5^(elapsedMinutes / halfLifeMinutes)",
    sealedScore,
    decayedScore,
    elapsedMinutes,
    halfLifeMinutes: params.halfLifeMinutes,
    greeksTemplateId: params.greeksTemplateId,
    scoredAt: scored.scoredAt,
    asOf: nowIso,
  };
}
