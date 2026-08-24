/**
 * DLC-GOV DLC-CHECKPOINT (D-DLC-4) — pure derivation half of the half-life
 * checkpoint reader. No Mongo, no network: everything here is a deterministic
 * function of the scoring-context document (the sealed assertion's analytics
 * copy), the signal_outcomes rows (the captured realization), and a clock.
 *
 * The artifact this builds is afi.signal-reassessment.v1
 * (afi-config schemas/signal-reassessment/v1) — the sealed comparison of
 * assertion vs realization for ONE signal. It never mutates the scored
 * record (immutability attaches at SCORED); it links by signalId; its
 * member set is EXHAUSTIVE per D-DLC-4(3).
 *
 * Sealing (the D-DLC-4(3) answer, quoted from the schema's
 * x-afiConstraints.sealingDiscipline): canonical-json-hashing.v1
 * (afi.hash.v1) — seal.value is the sha256 of the canonical serialization
 * of the document with the single TOP-LEVEL member 'seal' excluded; the
 * domain tag afi.checkpoint.signal-reassessment is carried, never hashed.
 */
import { createHash } from "node:crypto";

export const REASSESSMENT_SCHEMA_ID = "afi.signal-reassessment.v1";
export const REASSESSMENT_DOMAIN_TAG = "afi.checkpoint.signal-reassessment";
export const READING_RULE = "signedReturnPct-sign-v1";

// --- canonical-json-hashing.v1 reference implementation (spec §2) -----------
export function canonicalize(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize(v[k]))
      .join(",") +
    "}"
  );
}

export function sealReassessment(doc) {
  const stripped = {};
  for (const k of Object.keys(doc)) if (k !== "seal") stripped[k] = doc[k];
  const value = createHash("sha256")
    .update(Buffer.from(canonicalize(stripped), "utf-8"))
    .digest("hex");
  return {
    ...doc,
    seal: {
      algorithm: "sha256",
      canonicalizationVersion: "afi.hash.v1",
      domainTag: REASSESSMENT_DOMAIN_TAG,
      value,
    },
  };
}

/**
 * D-DLC-4(1): checkpoint eligibility is a derived time predicate —
 * elapsedMinutes since the SEALED SCORING TIMESTAMP >= the stamped
 * halfLifeMinutes. Fail-closed: no stamped decayParams (or an unparseable
 * scoredAt, or a non-positive half-life) is NEVER eligible — no default,
 * no unit guess (the D-DLC-3(2) doctrine applied to the checkpoint).
 * Returns { eligible, elapsedMinutes, halfLifeMinutes } or
 * { eligible: false, reason }.
 */
export function checkpointEligibility(ctx, nowMs) {
  const params = ctx?.decayParams;
  if (
    !params ||
    typeof params.halfLifeMinutes !== "number" ||
    !Number.isFinite(params.halfLifeMinutes) ||
    params.halfLifeMinutes <= 0
  ) {
    return { eligible: false, reason: "no-stamped-decay-params" };
  }
  const scoredAtMs = Date.parse(ctx.scoredAt);
  if (!Number.isFinite(scoredAtMs)) {
    return { eligible: false, reason: "unparseable-scoredAt" };
  }
  const elapsedMinutes = (nowMs - scoredAtMs) / 60_000;
  if (elapsedMinutes < params.halfLifeMinutes) {
    return {
      eligible: false,
      reason: "before-half-life",
      elapsedMinutes,
      halfLifeMinutes: params.halfLifeMinutes,
    };
  }
  return { eligible: true, elapsedMinutes, halfLifeMinutes: params.halfLifeMinutes };
}

/** The governed classification rule (schema const READING_RULE). */
export function classifyOutcome(signedReturnPct) {
  if (signedReturnPct === null || signedReturnPct === undefined) return "indeterminate";
  if (typeof signedReturnPct !== "number" || !Number.isFinite(signedReturnPct)) {
    return "indeterminate";
  }
  if (signedReturnPct > 0) return "favorable";
  if (signedReturnPct < 0) return "adverse";
  return "flat";
}

/** Overall over the non-indeterminate horizons (schema x-afiConstraints). */
export function overallReading(outcomes) {
  const determinate = outcomes.filter((o) => o !== "indeterminate");
  if (determinate.length === 0) return "indeterminate";
  if (determinate.every((o) => o === "favorable")) return "confirmed";
  if (determinate.every((o) => o === "adverse")) return "contradicted";
  return "mixed";
}

/** Sort key for horizon labels (DH-GOV grammar: <n>m | <n>h). */
export function horizonMinutes(label) {
  const m = /^([1-9][0-9]*)([mh])$/.exec(label);
  if (!m) return null;
  return Number(m[1]) * (m[2] === "h" ? 60 : 1);
}

const GOVERNED_HORIZON_BASES = new Set(["decay-derived", "operator-override"]);

/**
 * Build the sealed reassessment artifact from the scoring-context doc
 * (the decay clock's TDR-GOV stamp surface), that signal's outcome rows
 * (sorted by horizon length), and the SEALED assertion members read from
 * the canonical evidence record (D-DLC-4(2): the checkpoint reads the
 * sealed record — `sealedAssertion.direction` comes from
 * evidenceRecord.scoredSignal.direction, never from the analytics copy).
 * Throws on malformed inputs — the caller's log-and-skip arm decides; a
 * partial, guessed, or defaulted artifact is never built. In particular:
 * no direction is ever substituted (the D-DLC-3(2) doctrine), a legacy
 * row without a governed horizonBasis refuses (a sealed artifact must
 * validate against afi.signal-reassessment.v1 — never seal what the
 * schema would reject), and duplicate horizon labels refuse.
 */
export function buildReassessment(ctx, outcomeRows, nowIso, sealedAssertion) {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) throw new Error(`unparseable checkpoint instant: ${nowIso}`);
  const elig = checkpointEligibility(ctx, nowMs);
  if (!elig.eligible) throw new Error(`not checkpoint-eligible: ${elig.reason}`);
  if (!Array.isArray(outcomeRows) || outcomeRows.length === 0) {
    throw new Error("no captured outcome rows — capture incomplete, nothing to read");
  }
  const direction = sealedAssertion?.direction;
  if (!["long", "short", "neutral"].includes(direction)) {
    throw new Error(
      `sealed record carries no recognized asserted direction (got ${String(direction)}) — ` +
        "never substituted (D-DLC-4(2))"
    );
  }

  const rows = [...outcomeRows].sort(
    (a, b) => (horizonMinutes(a.horizon) ?? 0) - (horizonMinutes(b.horizon) ?? 0)
  );
  for (const r of rows) {
    if (horizonMinutes(r.horizon) === null) {
      throw new Error(`outcome row with unrecognized horizon label: ${String(r.horizon)}`);
    }
    if (!GOVERNED_HORIZON_BASES.has(r.horizonBasis)) {
      throw new Error(
        `outcome row ${r.horizon} carries no governed horizonBasis ` +
          `(got ${String(r.horizonBasis)}) — legacy pre-DH rows are not checkpoint material`
      );
    }
  }
  const labels = rows.map((r) => r.horizon);
  if (new Set(labels).size !== labels.length) {
    throw new Error(`duplicate horizon labels in outcome rows: ${labels.join(",")}`);
  }

  const horizonsRead = rows.map((r) => ({
    horizon: r.horizon,
    horizonBasis: r.horizonBasis,
    ...(r.decayRef?.fractionOfHalfLife !== undefined
      ? { fractionOfHalfLife: r.decayRef.fractionOfHalfLife }
      : {}),
  }));

  // Realization copied VERBATIM from the rows (D-DLC-4(2)) — never recomputed.
  const realizedFigures = rows.map((r) => ({
    horizon: r.horizon,
    evaluatedAt: r.evaluatedAt,
    entryPrice: r.entryPrice,
    exitPrice: r.exitPrice,
    returnPct: r.returnPct,
    signedReturnPct: r.signedReturnPct ?? null,
    ...(typeof r.mfePct === "number" ? { mfePct: r.mfePct } : {}),
    ...(typeof r.maePct === "number" ? { maePct: r.maePct } : {}),
  }));

  const perHorizon = realizedFigures.map((f) => ({
    horizon: f.horizon,
    outcome: classifyOutcome(f.signedReturnPct),
  }));

  return sealReassessment({
    schema: REASSESSMENT_SCHEMA_ID,
    signalId: ctx.signalId,
    checkpointTime: {
      scoredAt: ctx.scoredAt,
      checkpointAt: nowIso,
      elapsedMinutes: elig.elapsedMinutes,
      halfLifeMinutes: elig.halfLifeMinutes,
    },
    horizonsRead,
    realizedFigures,
    reassessmentReading: {
      direction,
      rule: READING_RULE,
      perHorizon,
      overall: overallReading(perHorizon.map((p) => p.outcome)),
    },
  });
}
