/**
 * INTERNAL scoring carrier: holds the afi-core scorer output VERBATIM between
 * the scoring step and the District-2 projection builders
 * (`src/evidence/provenance/builders.ts`). Never emitted outward — the outward
 * scored surface is the ScoredSignal v1 projection.
 * `scoredAt` comes from the runtime clock and is volatile metadata, excluded
 * from every content hash and never emitted.
 *
 * Extracted verbatim under DSC-GOV D-DSC-4 (the one shared cross-boundary
 * carrier between the live evidence construction and the D2 projection law).
 *
 * @internal
 */
export interface InternalScoringResult {
  signalId: string;
  uwrScore: number;
  uwrAxes: { structure: number; execution: number; risk: number; insight: number };
  analystScore: unknown; // afi-core AnalystScoreTemplate (verbatim)
  scoredAt: string; // volatile; EXCLUDED from all hashes; never emitted
  /**
   * Submitted side, carried verbatim from `scored.meta.direction` (= USS
   * `facts.direction`). The ScoredSignal projection reads THIS field so the
   * record satisfies the governed contract "aligned with USS v1.1
   * facts.direction" (scored-signal.schema.json); when absent, the projection
   * falls back to `analystScore.direction` (DIR-GOV D-DIR-2(1) binding term —
   * the analyst's own verdict is a different statement and is never
   * overwritten, DIR-GOV D-DIR-3).
   */
  direction?: "long" | "short" | "neutral";
}
