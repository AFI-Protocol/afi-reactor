/**
 * Normalize pipehead — a REFERENCE ADAPTER / implementation profile, not the
 * canonical AFI normalization process. Fans-in the five
 * {@link AnalysisLaneResult}s into a single INTERNAL {@link AnalysisBundle}
 * whose `lanes` record ALWAYS carries the five lane keys of this reference
 * profile and whose `enrichedView` is a strategy-local `FroggyEnrichedView`
 * projection the afi-core scorer consumes verbatim.
 *
 * NORMALIZATION BOUNDARY (District 2): USS v1.1 COMPATIBILITY is the
 * canonical requirement; the method used here to adapt validated USS +
 * lane results into a bundle/enriched view is an implementation-profile /
 * adapter choice. Other analysts, providers, validators, and AFI-compatible
 * agents may use different parsers, mappers, and normalization methods as
 * long as they emit valid USS objects, preserve required provenance, expose
 * evidence/source references where required, satisfy the D2 hash/disclosure/
 * replay requirements, and do not falsify or silently discard material
 * signal intent.
 *
 * Mapping (validation-contract VAL-BUNDLE-001..008; reference profile):
 *  - WIRED `technical-indicators` -> `enrichedView.technical` (emaDistancePct +
 *    EMA/RSI/ATR `indicators`).
 *  - WIRED `pattern-recognition` -> `enrichedView.pattern` (patternName /
 *    patternConfidence / regime).
 *  - PROVISIONAL `social` -> `enrichedView.sentiment` ({ score, tags }).
 *  - PROVISIONAL `news`/`ai-ml` -> `enrichedView.news` / `enrichedView.aiMl`
 *    (read-only context; not used by UWR scoring).
 *
 * Identity (signalId/symbol/market/timeframe) is carried THROUGH from the
 * validated USS fixture (never fabricated): `signalId` from `provenance`,
 * `symbol`/`market`/`timeframe` from `facts`. `provenance` binds the bundle to
 * the validated input via the afi.hash.v1 signal-input digest of the rawUss.
 *
 * Pure & deterministic given `(laneResults, rawUss)`: no `Math.random`, no
 * `Date.now`, no network, no DB, no filesystem. Execution timestamps come from
 * `ctx.clock()` and are excluded from every content hash (afi.hash.v1
 * timestamp policy).
 *
 * ESM: relative imports use `.js`; the afi-core `FroggyEnrichedView` is a
 * TYPE-only import (erased at runtime; scoring stays 100% in afi-core).
 */

import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
import type {
  AnalysisBundle,
  AnalysisLaneId,
  AnalysisLaneResult,
  BundleProvenance,
  Pipehead,
  PipeheadContext,
  PipeheadExecutionResult,
} from "./types.js";
import { computeCanonicalHashV1, D2_DOMAIN_TAGS } from "./provenance/canonicalHashV1.js";
import {
  indexLaneResults,
  isDegradedLaneResult,
  PROVISIONAL_LANE_IDS,
} from "./fanOut.js";
import type { TechnicalLanePayload } from "./lanes/technicalLane.js";
import type { PatternLanePayload } from "./lanes/patternLane.js";
import type { SocialLanePayload } from "./lanes/socialLane.js";
import type { NewsLanePayload } from "./lanes/newsLane.js";
import type { AimlLanePayload } from "./lanes/aimlLane.js";

export const NORMALIZE_PIPEHEAD_ID = "normalize";

/**
 * Explicit provisional-lane list carried on every bundle. Exactly
 * `['news','social','ai-ml']` in stable order (VAL-BUNDLE-002).
 */
export const BUNDLE_PROVISIONAL_LANES: AnalysisLaneId[] = [...PROVISIONAL_LANE_IDS];

/** Identity facts carried through from the validated USS fixture. */
export interface BundleIdentity {
  signalId: string;
  symbol: string;
  market: string;
  timeframe: string;
}

/** Field-level structured error describing one malformed identity field. */
export interface IdentityValidationError {
  field: string;
  message: string;
}

/** Structured result of {@link validateBundleIdentity} (clean seam, no throw). */
export type IdentityValidationResult =
  | { ok: true; identity: BundleIdentity }
  | { ok: false; errors: IdentityValidationError[] };

/**
 * Structured error thrown by {@link normalizeToBundle} when the validated USS is
 * missing a required identity field, or carries a non-string / empty one. It
 * exposes field-level `errors` so callers can inspect the failure instead of
 * silently propagating an empty-string identity.
 */
export class NormalizeIdentityError extends Error {
  readonly stage = "normalize-identity";
  readonly errors: IdentityValidationError[];

  constructor(errors: IdentityValidationError[]) {
    super(
      `normalize: invalid USS identity (${errors.map((e) => e.field).join(", ")})`
    );
    this.name = "NormalizeIdentityError";
    this.errors = errors;
  }
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Where each required identity field is sourced from in the USS. */
const IDENTITY_FIELD_SOURCES: ReadonlyArray<{
  field: keyof BundleIdentity;
  container: "provenance" | "facts";
  path: string;
}> = [
  { field: "signalId", container: "provenance", path: "provenance.signalId" },
  { field: "symbol", container: "facts", path: "facts.symbol" },
  { field: "market", container: "facts", path: "facts.market" },
  { field: "timeframe", container: "facts", path: "facts.timeframe" },
];

/**
 * Collect the field-level errors for the identity carried by the validated USS.
 * Each required field (`signalId` from `provenance`; `symbol`/`market`/
 * `timeframe` from `facts`) must be present, a string, and non-empty. Returns an
 * empty array when the identity is well-formed.
 */
function collectIdentityErrors(rawUss: unknown): IdentityValidationError[] {
  const uss = asRecord(rawUss);
  const containers = {
    provenance: asRecord(uss.provenance),
    facts: asRecord(uss.facts),
  };
  const errors: IdentityValidationError[] = [];

  for (const { field, container, path } of IDENTITY_FIELD_SOURCES) {
    const source = containers[container];
    const value = source[field];
    if (!(field in source)) {
      errors.push({ field: path, message: `missing required identity field "${path}"` });
    } else if (typeof value !== "string") {
      errors.push({
        field: path,
        message: `identity field "${path}" must be a string (received ${
          value === null ? "null" : typeof value
        })`,
      });
    } else if (value.trim() === "") {
      errors.push({ field: path, message: `identity field "${path}" must not be empty` });
    }
  }

  return errors;
}

/**
 * Strictly validate the identity carried by the validated USS. Returns a
 * STRUCTURED result (never throws), so callers can branch on `ok`. This is the
 * clean seam that backs {@link normalizeToBundle}'s hardening.
 */
export function validateBundleIdentity(rawUss: unknown): IdentityValidationResult {
  const errors = collectIdentityErrors(rawUss);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, identity: extractIdentityFromUss(rawUss) };
}

/**
 * Carry the identity through from the validated USS fixture (never fabricated):
 * `signalId` from `provenance`, `symbol`/`market`/`timeframe` from `facts`.
 *
 * NOTE: this is the LENIENT accessor (returns empty strings for absent fields)
 * used to derive a best-effort `signalId` BEFORE schema validation runs. The
 * STRICT, structured check is {@link validateBundleIdentity}, enforced by
 * {@link normalizeToBundle}.
 */
export function extractIdentityFromUss(rawUss: unknown): BundleIdentity {
  const uss = asRecord(rawUss);
  const provenance = asRecord(uss.provenance);
  const facts = asRecord(uss.facts);
  return {
    signalId: readString(provenance, "signalId"),
    symbol: readString(facts, "symbol"),
    market: readString(facts, "market"),
    timeframe: readString(facts, "timeframe"),
  };
}

function wiredPayload<P>(result: AnalysisLaneResult | undefined): P | undefined {
  if (result === undefined || isDegradedLaneResult(result)) {
    return undefined;
  }
  return result.payload as P;
}

function projectTechnical(
  result: AnalysisLaneResult | undefined
): FroggyEnrichedView["technical"] | undefined {
  const payload = wiredPayload<TechnicalLanePayload>(result);
  if (payload === undefined) {
    return undefined;
  }
  return {
    emaDistancePct: payload.emaDistancePct,
    indicators: {
      ema20: payload.ema20,
      ema50: payload.ema50,
      rsi14: payload.rsi14,
      atr14: payload.atr14,
    },
  };
}

function projectPattern(
  result: AnalysisLaneResult | undefined
): FroggyEnrichedView["pattern"] | undefined {
  const payload = wiredPayload<PatternLanePayload>(result);
  if (payload === undefined) {
    return undefined;
  }
  return {
    patternName: payload.patternName ?? null,
    patternConfidence: payload.patternConfidence ?? null,
    regime: payload.regime,
  };
}

function projectSentiment(
  result: AnalysisLaneResult | undefined
): FroggyEnrichedView["sentiment"] | undefined {
  const payload = wiredPayload<SocialLanePayload>(result);
  if (payload === undefined) {
    return undefined;
  }
  return { score: payload.score, tags: payload.tags };
}

function projectNews(
  result: AnalysisLaneResult | undefined
): FroggyEnrichedView["news"] | undefined {
  const payload = wiredPayload<NewsLanePayload>(result);
  if (payload === undefined) {
    return undefined;
  }
  return {
    hasShockEvent: payload.hasShockEvent,
    shockDirection: payload.shockDirection,
    headlines: payload.headlines,
    items: payload.items,
  };
}

function projectAiMl(
  result: AnalysisLaneResult | undefined
): FroggyEnrichedView["aiMl"] | undefined {
  const payload = wiredPayload<AimlLanePayload>(result);
  if (payload === undefined) {
    return undefined;
  }
  return {
    convictionScore: payload.convictionScore,
    direction: payload.direction,
    regime: payload.regime,
    riskFlag: payload.riskFlag,
    notes: payload.notes,
  };
}

/**
 * Project the indexed lane results onto a `FroggyEnrichedView` the afi-core
 * scorer consumes directly. Identity is always present; a degraded wired lane
 * simply omits its section (the scorer falls back to conservative defaults).
 */
export function buildEnrichedView(
  identity: BundleIdentity,
  lanes: Record<AnalysisLaneId, AnalysisLaneResult>
): FroggyEnrichedView {
  const view: FroggyEnrichedView = {
    signalId: identity.signalId,
    symbol: identity.symbol,
    market: identity.market,
    timeframe: identity.timeframe,
  };

  const technical = projectTechnical(lanes["technical-indicators"]);
  if (technical !== undefined) {
    view.technical = technical;
  }
  const pattern = projectPattern(lanes["pattern-recognition"]);
  if (pattern !== undefined) {
    view.pattern = pattern;
  }
  const sentiment = projectSentiment(lanes.social);
  if (sentiment !== undefined) {
    view.sentiment = sentiment;
  }
  const news = projectNews(lanes.news);
  if (news !== undefined) {
    view.news = news;
  }
  const aiMl = projectAiMl(lanes["ai-ml"]);
  if (aiMl !== undefined) {
    view.aiMl = aiMl;
  }

  return view;
}

/**
 * Fan-in the five lane results into an {@link AnalysisBundle}. The `lanes`
 * record always carries all five canonical keys; `provisionalLanes` is exactly
 * `['news','social','ai-ml']`; identity and `provenance` are carried through
 * from the validated `rawUss`. Pure and deterministic for a fixed input.
 */
export function normalizeToBundle(
  laneResults: AnalysisLaneResult[],
  rawUss: unknown
): AnalysisBundle {
  const lanes = indexLaneResults(laneResults);
  const identityErrors = collectIdentityErrors(rawUss);
  if (identityErrors.length > 0) {
    throw new NormalizeIdentityError(identityErrors);
  }
  const identity = extractIdentityFromUss(rawUss);
  const enrichedView = buildEnrichedView(identity, lanes);
  const provenance: BundleProvenance = {
    signalId: identity.signalId,
    inputHash: computeCanonicalHashV1(rawUss, {
      domainTag: D2_DOMAIN_TAGS.signalInput,
    }).value,
  };

  return {
    signalId: identity.signalId,
    symbol: identity.symbol,
    market: identity.market,
    timeframe: identity.timeframe,
    lanes,
    provisionalLanes: [...BUNDLE_PROVISIONAL_LANES],
    enrichedView,
    provenance,
  };
}

/**
 * The normalize step as a typed pipehead. `execute(laneResults, ctx)` fans the
 * five lane results into an `AnalysisBundle`, reading the validated USS from
 * `ctx.rawUss`. Timestamps come from `ctx.clock()` and are excluded from every
 * content hash.
 */
export const normalizePipehead: Pipehead<AnalysisLaneResult[], AnalysisBundle> = {
  id: NORMALIZE_PIPEHEAD_ID,
  kind: "normalize",
  async execute(
    laneResults: AnalysisLaneResult[],
    ctx: PipeheadContext
  ): Promise<PipeheadExecutionResult<AnalysisBundle>> {
    const startedAt = ctx.clock();
    const bundle = normalizeToBundle(laneResults, ctx.rawUss);
    const finishedAt = ctx.clock();
    return {
      pipeheadId: this.id,
      kind: this.kind,
      status: "ok",
      provisional: false,
      output: bundle,
      startedAt,
      finishedAt,
    };
  },
};
