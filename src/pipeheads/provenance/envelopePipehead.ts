/**
 * Envelope pipehead — wraps the normalized bundle's strategy-local enriched
 * view in a strict AnalystInputEnvelope v1 (District 2 M2 reference
 * implementation). This is the analyst-input boundary of the pipeline: the
 * scoring step consumes `envelope.strategyLocalView`, so the emitted envelope
 * is genuinely the analyst input, not a post-hoc wrapper.
 *
 * The strategy-local view stays OPAQUE and NON-CANONICAL: declared via
 * `strategyViewType` / `enrichedViewSchemaRef` and pinned only through the
 * explicit `strategyLocalViewHash` (afi.hash.v1). Nothing in the view becomes
 * protocol canon.
 *
 * Pure & deterministic given `(input, ctx)`: no I/O, no ambient time — the
 * only timestamps on the execution result come from `ctx.clock()` and are
 * volatile runtime metadata excluded from every content hash.
 *
 * ESM: relative imports use `.js`.
 */

import type { AfiCandle } from "../../types/AfiCandle.js";
import type {
  AnalysisBundle,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "../types.js";
import {
  buildAnalystInputEnvelope,
  buildEnrichmentProvenance,
  buildEvidenceRefs,
  buildSourceDisclosureProfiles,
  replayProfileRefFor,
} from "./builders.js";
import type { AnalystInputEnvelopeV1 } from "./types.js";

export const ENVELOPE_PIPEHEAD_ID = "analyst-input-envelope";

/** Input to the envelope pipehead: the normalized bundle + the OHLCV the wired lanes consumed. */
export interface EnvelopePipeheadInput {
  bundle: AnalysisBundle;
  candles: AfiCandle[];
}

/**
 * Build the full AnalystInputEnvelope v1 (with evidence refs, source
 * disclosure profiles, and per-lane enrichment provenance) from a normalized
 * bundle. Pure given `(bundle, candles, rawUss)`.
 */
export function buildEnvelopeFromBundle(
  bundle: AnalysisBundle,
  candles: AfiCandle[],
  rawUss: unknown
): AnalystInputEnvelopeV1 {
  const evidenceRefs = buildEvidenceRefs({
    signalId: bundle.signalId,
    candles,
    lanes: bundle.lanes,
  });
  const sourceDisclosureProfiles = buildSourceDisclosureProfiles();
  const enrichmentProvenance = buildEnrichmentProvenance(bundle, evidenceRefs);
  return buildAnalystInputEnvelope({
    bundle,
    rawUss,
    evidenceRefs,
    sourceDisclosureProfiles,
    enrichmentProvenance,
    replayProfileRef: replayProfileRefFor(bundle.signalId),
  });
}

/** The envelope step as a typed pipehead. */
export const envelopePipehead: Pipehead<EnvelopePipeheadInput, AnalystInputEnvelopeV1> = {
  id: ENVELOPE_PIPEHEAD_ID,
  kind: "envelope",
  async execute(
    input: EnvelopePipeheadInput,
    ctx: PipeheadContext
  ): Promise<PipeheadExecutionResult<AnalystInputEnvelopeV1>> {
    const startedAt = ctx.clock();
    const output = buildEnvelopeFromBundle(input.bundle, input.candles, ctx.rawUss);
    const finishedAt = ctx.clock();
    return {
      pipeheadId: this.id,
      kind: this.kind,
      status: "ok",
      provisional: false,
      output,
      startedAt,
      finishedAt,
    };
  },
};
