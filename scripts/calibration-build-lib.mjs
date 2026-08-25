/**
 * CAL-GOV CAL-BUILDER (D-CAL-1 … D-CAL-4) — pure derivation half of the
 * analyst calibration builder. No Mongo, no network: everything here is a
 * deterministic function of (a) the sealed afi.signal-reassessment.v1
 * artifacts, (b) the sealed scored-signal evidence records they link to by
 * signalId, (c) the set of signalIds present in the evidence history
 * collection, and (d) the previous calibration record per key.
 *
 * The artifact this builds is afi.analyst-calibration.v1
 * (afi-config schemas/analyst-calibration/v1) — the per-analyst calibration
 * record: counts, rates and means with cluster-robust intervals, a
 * reliability table, a rank statistic with its claim flag, strata, and a
 * dependence block. NEVER a scalar. It names no member as PoI or PoInsight
 * (D-CAL-5). It never mutates a reassessment or a scored record.
 *
 * Sealing (D-CAL-1(5)): canonical-json-hashing.v1 (afi.hash.v1) — seal.value
 * is the sha256 of the canonical serialization of the document with the
 * single TOP-LEVEL member 'seal' excluded; domain tag
 * afi.calibration.analyst carried, never hashed. Every derived non-integer
 * member is sealed rounded to six decimal places, round-half-even on the
 * exact binary value (never via toFixed); set-valued provenance members are
 * serialized sorted ascending by UTF-16 code units of their key.
 */
import { createHash } from "node:crypto";

export const CALIBRATION_SCHEMA_ID = "afi.analyst-calibration.v1";
export const CALIBRATION_DOMAIN_TAG = "afi.calibration.analyst";
export const CALIBRATION_RULE = "analyst-calibration-v1";
export const READING_RULE = "signedReturnPct-sign-v1";
export const FRACTIONS = [0.25, 0.5, 1];
export const GROUP_MIN_N = 100; // D-CAL-3(2)(a)
export const RANK_CLAIM_MIN_N = 200; // D-CAL-3(2)(a)
export const BIN_MIN_N = 20; // D-CAL-3(2)(b)
export const MIN_CLUSTERS = 3; // D-CAL-3(1)(vi)
export const Z975 = 1.959963984540054;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

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
export function sha256Canonical(doc) {
  return createHash("sha256").update(Buffer.from(canonicalize(doc), "utf-8")).digest("hex");
}
export function sealCalibration(doc) {
  const stripped = {};
  for (const k of Object.keys(doc)) if (k !== "seal") stripped[k] = doc[k];
  return {
    ...doc,
    seal: {
      algorithm: "sha256",
      canonicalizationVersion: "afi.hash.v1",
      domainTag: CALIBRATION_DOMAIN_TAG,
      value: sha256Canonical(stripped),
    },
  };
}

/**
 * D-CAL-1(2) verify-on-read: recompute a sealed reassessment's seal.value.
 */
export function reassessmentSealVerifies(r) {
  if (!r || !r.seal || typeof r.seal.value !== "string") return false;
  const stripped = {};
  for (const k of Object.keys(r)) if (k !== "seal" && k !== "_id") stripped[k] = r[k];
  return sha256Canonical(stripped) === r.seal.value;
}

/**
 * D-CAL-1(2) verify-on-read: recompute a sealed evidence record's recordHash.
 * EV3-GOV D-EV3-4(6): CanonicalHash v1 of the FULL record MINUS
 * {recordHash, replayHash}; the store pins recordVersion after verification
 * and Mongo adds _id, so both are stripped from the preimage.
 */
export function evidenceRecordHashVerifies(e) {
  if (!e || !e.recordHash || typeof e.recordHash.value !== "string") return false;
  const stripped = {};
  for (const k of Object.keys(e)) {
    if (k === "_id" || k === "recordHash" || k === "replayHash" || k === "recordVersion") continue;
    stripped[k] = e[k];
  }
  return sha256Canonical(stripped) === e.recordHash.value;
}

// --- D-CAL-1(5) rounding law -------------------------------------------------
/** Round-half-even to 6 dp on the EXACT binary value (decimal-string arithmetic). */
export function round6(x) {
  if (typeof x !== "number" || !Number.isFinite(x)) return x;
  const neg = x < 0;
  const s = Math.abs(x).toFixed(100); // exact for every double in range
  const [ip, fp] = s.split(".");
  const keep = fp.slice(0, 6);
  const rest = fp.slice(6);
  let digits = (ip + keep).split("").map((c) => c.charCodeAt(0) - 48);
  const first = rest.charCodeAt(0) - 48;
  const tailNonZero = /[1-9]/.test(rest.slice(1));
  let up = false;
  if (first > 5 || (first === 5 && tailNonZero)) up = true;
  else if (first === 5 && !tailNonZero) up = digits[digits.length - 1] % 2 === 1; // tie → even
  if (up) {
    for (let i = digits.length - 1; i >= 0; i--) {
      if (digits[i] === 9) digits[i] = 0;
      else {
        digits[i]++;
        break;
      }
      if (i === 0) digits.unshift(1);
    }
  }
  const str = digits.join("");
  const intPart = str.slice(0, str.length - 6) || "0";
  const val = Number(intPart + "." + str.slice(-6));
  return neg && val !== 0 ? -val : val;
}

// --- helpers ------------------------------------------------------------------
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // UTF-16 code-unit order
const sortedUnique = (arr) => [...new Set(arr)].sort(cmpStr);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
function sampleVar(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1);
}
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  if (n === 0) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function midRanks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
/** Population-sd standardization (denominator n), D-CAL-3(1)(iv). */
function standardize(a) {
  const m = mean(a);
  const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
  return a.map((v) => (sd === 0 ? 0 : (v - m) / sd));
}
/** CR1 cluster sandwich variance of a mean of residuals, D-CAL-3(1)(ii). */
function cr1Variance(residuals, clusterIds) {
  const n = residuals.length;
  const sums = new Map();
  for (let i = 0; i < n; i++) sums.set(clusterIds[i], (sums.get(clusterIds[i]) || 0) + residuals[i]);
  const G = sums.size;
  if (G < 2) return { variance: NaN, G };
  let acc = 0;
  for (const s of sums.values()) acc += s * s;
  return { variance: (acc / (n * n)) * (G / (G - 1)), G };
}
function parseSignalId(signalId) {
  // D-OBJ-1 adapter format: {symbol}-{timeframe}-{strategy}-{direction}-{timestamp}
  const parts = String(signalId).split("-");
  return { symbol: parts[0] ?? "", timeframe: parts[1] ?? "" };
}

// --- D-CAL-3(1)(i) clusters ------------------------------------------------------
/** rows sorted ascending scoredAt; overlap iff |Δt| < H (strict). Returns cluster id per row. */
export function assignClusters(rowsSorted, halfLifeMinutes) {
  const H = halfLifeMinutes * MINUTE_MS;
  const ids = new Array(rowsSorted.length);
  let cid = 0;
  for (let i = 0; i < rowsSorted.length; i++) {
    if (i > 0 && rowsSorted[i].scoredAtMs - rowsSorted[i - 1].scoredAtMs >= H) cid++;
    ids[i] = cid;
  }
  return ids;
}

// --- block statistics -------------------------------------------------------------
function statusFor(n, G, minN) {
  if (n < minN) return "insufficient";
  return G < MIN_CLUSTERS ? "withheld" : "sealed";
}
/** Rate block for a 0/1 indicator over rows (with cluster ids). */
function rateBlock(indicator, clusters, minN) {
  const n = indicator.length;
  const count = indicator.reduce((s, v) => s + v, 0);
  const uniq = new Set(clusters).size;
  const status = statusFor(n, uniq, minN);
  const out = { n, count, status };
  if (status === "insufficient") return out;
  const p = count / n;
  out.rate = round6(p);
  if (status === "sealed") {
    const { variance } = cr1Variance(indicator.map((v) => v - p), clusters);
    const se = Math.sqrt(variance);
    out.se = round6(se);
    out.interval = [round6(Math.max(0, p - Z975 * se)), round6(Math.min(1, p + Z975 * se))];
  }
  return out;
}
function meanBlock(values, clusters, minN, withInterval = true) {
  const n = values.length;
  const uniq = new Set(clusters).size;
  const status = statusFor(n, uniq, minN);
  const out = { n, status };
  if (status === "insufficient") return out;
  const m = mean(values);
  out.mean = round6(m);
  if (status === "sealed" && withInterval) {
    const { variance } = cr1Variance(values.map((v) => v - m), clusters);
    const se = Math.sqrt(variance);
    out.se = round6(se);
    out.interval = [round6(m - Z975 * se), round6(m + Z975 * se)];
  }
  return out;
}
function rankBlock(xs, ys, clusters) {
  const n = xs.length;
  const uniq = new Set(clusters).size;
  const status = statusFor(n, uniq, GROUP_MIN_N);
  const out = { n, status };
  if (status === "insufficient") return out;
  const x = standardize(midRanks(xs));
  const y = standardize(midRanks(ys));
  let rho = 0;
  for (let i = 0; i < n; i++) rho += x[i] * y[i];
  rho /= n;
  out.rho = round6(rho);
  out.claim = n >= RANK_CLAIM_MIN_N ? "sealed" : "insufficient-for-claim";
  if (status === "sealed") {
    const IF = x.map((xi, i) => xi * y[i] - (rho / 2) * (xi * xi + y[i] * y[i]));
    const { variance } = cr1Variance(IF, clusters);
    const seRho = Math.sqrt(variance);
    const seZ = seRho / (1 - rho * rho);
    const z = Math.atanh(rho);
    out.se = round6(seRho);
    out.interval = [round6(Math.tanh(z - Z975 * seZ)), round6(Math.tanh(z + Z975 * seZ))];
  }
  return out;
}
function binIndex(uwrScore) {
  return Math.floor(Math.round(uwrScore * 1000) / 50); // D-CAL-3(2)(b)
}

// --- the per-f realized/readings blocks over a set of joined rows ----------------------
function readingsFor(rows) {
  const overall = { confirmed: 0, contradicted: 0, mixed: 0, indeterminate: 0 };
  for (const r of rows) overall[r.overall]++;
  const perF = {};
  for (const f of FRACTIONS) {
    const c = { favorable: 0, adverse: 0, flat: 0, indeterminate: 0 };
    for (const r of rows) {
      const h = r.horizons[f];
      if (h) c[h.outcome]++;
    }
    perF[String(f)] = c;
  }
  return { overall, perF };
}
function realizedFor(rows, clustersOf, minN) {
  const perF = {};
  for (const f of FRACTIONS) {
    const sel = rows.filter((r) => r.horizons[f] && r.horizons[f].signedReturnPct !== null);
    const cl = sel.map((r) => clustersOf.get(r.signalId));
    const win = sel.map((r) => (r.horizons[f].outcome === "favorable" ? 1 : 0));
    const signed = sel.map((r) => r.horizons[f].signedReturnPct);
    const block = {
      win: rateBlock(win, cl, minN),
      meanSignedReturnPct: meanBlock(signed, cl, minN),
      medianSignedReturnPct: sel.length >= minN ? round6(median(signed)) : null,
      meanMfePct: meanBlock(
        sel.map((r) => r.horizons[f].mfePct).filter((v) => typeof v === "number"),
        sel.filter((r) => typeof r.horizons[f].mfePct === "number").map((r) => clustersOf.get(r.signalId)),
        minN
      ),
      meanMaePct: meanBlock(
        sel.map((r) => r.horizons[f].maePct).filter((v) => typeof v === "number"),
        sel.filter((r) => typeof r.horizons[f].maePct === "number").map((r) => clustersOf.get(r.signalId)),
        minN
      ),
    };
    perF[String(f)] = block;
  }
  return perF;
}

// --- joining ---------------------------------------------------------------------------
/**
 * Join one reassessment to its sealed evidence record; returns {row} or {exclude}.
 * historyIds: Set of signalIds present in scored_signal_evidence_history.
 */
export function joinRow(reassessment, evidence, historyIds) {
  const signalId = reassessment?.signalId;
  if (!evidence || !reassessmentSealVerifies(reassessment) || !evidenceRecordHashVerifies(evidence)) {
    return { exclude: "unverifiableInput", signalId };
  }
  const rv = evidence.recordVersion ?? 1;
  if (rv > 1 || evidence.supersedesRecordHash || (historyIds && historyIds.has(signalId))) {
    return { exclude: "supersededSinceCheckpoint", signalId };
  }
  const horizons = {};
  for (const h of reassessment.horizonsRead) {
    const fig = reassessment.realizedFigures.find((x) => x.horizon === h.horizon);
    const out = reassessment.reassessmentReading.perHorizon.find((x) => x.horizon === h.horizon);
    if (!fig || !out || typeof h.fractionOfHalfLife !== "number") continue;
    const signed = fig.signedReturnPct ?? null;
    if (signed !== null) {
      if ((typeof fig.mfePct === "number" && signed > fig.mfePct) || (typeof fig.maePct === "number" && -signed > fig.maePct)) {
        return { exclude: "magnitudeConventionViolation", signalId };
      }
    }
    horizons[h.fractionOfHalfLife] = {
      horizon: h.horizon,
      signedReturnPct: signed,
      outcome: out.outcome,
      mfePct: typeof fig.mfePct === "number" ? fig.mfePct : undefined,
      maePct: typeof fig.maePct === "number" ? fig.maePct : undefined,
    };
  }
  const ss = evidence.scoredSignal || {};
  const comp = evidence.composition || {};
  const up = evidence.uwrProfile || {};
  const { symbol, timeframe } = parseSignalId(signalId);
  return {
    row: {
      signalId,
      scoredAt: reassessment.checkpointTime.scoredAt,
      scoredAtMs: Date.parse(reassessment.checkpointTime.scoredAt),
      checkpointAt: reassessment.checkpointTime.checkpointAt,
      halfLifeMinutes: reassessment.checkpointTime.halfLifeMinutes,
      direction: reassessment.reassessmentReading.direction,
      overall: reassessment.reassessmentReading.overall,
      horizons,
      uwrScore: ss.uwrScore,
      riskBucket: ss.riskBucket ?? null,
      providerId: ss.providerId ?? null,
      analystId: evidence.analystId,
      strategyId: evidence.strategyId,
      strategyVersion: evidence.strategyVersion,
      analystConfigHash: comp.analystConfigHash?.value ?? null,
      recordHash: evidence.recordHash.value,
      recordVersion: rv,
      symbol,
      timeframe,
      key: {
        analystId: evidence.analystId,
        strategyId: evidence.strategyId,
        strategyVersion: evidence.strategyVersion,
        scoringIdentity: {
          pipelineId: comp.pipelineId ?? null,
          pipelineVersion: comp.pipelineVersion ?? null,
          manifestHash: comp.manifestHash?.value ?? null,
          scorerPluginId: comp.scorerPluginId ?? null,
          scorerPluginVersion: comp.scorerPluginVersion ?? null,
          pluginSetHash: comp.pluginSetHash?.value ?? null,
          uwrProfileId: up.profileId ?? null,
          uwrProfileSource: up.source ?? null,
        },
        halfLifeMinutes: reassessment.checkpointTime.halfLifeMinutes,
      },
    },
  };
}
export const keyString = (key) => canonicalize(key);

// --- the record --------------------------------------------------------------------------
/**
 * Build one sealed calibration record for one key from its joined rows.
 * previous: the previous calibration record for the same key (or null).
 * exclusions: counters accumulated during joining for this key.
 */
export function buildCalibrationRecord(key, rowsIn, previous, exclusions, checkpointRangeHint) {
  const rows = [...rowsIn].sort((a, b) => a.scoredAtMs - b.scoredAtMs || cmpStr(a.signalId, b.signalId));
  // D-CAL-4(2)(ii): drift against the previous record's stamped provenance
  let supersededSinceCalibration = 0;
  let kept = rows;
  if (previous && Array.isArray(previous.provenance?.signalIds)) {
    const prev = new Map(previous.provenance.signalIds.map((p) => [p.signalId, p.recordHash]));
    kept = rows.filter((r) => {
      const ph = prev.get(r.signalId);
      if (ph !== undefined && ph !== r.recordHash) {
        supersededSinceCalibration++;
        return false;
      }
      return true;
    });
  }
  const H = key.halfLifeMinutes;
  const clusterIds = assignClusters(kept, H);
  const clustersOf = new Map(kept.map((r, i) => [r.signalId, clusterIds[i]]));
  const G = new Set(clusterIds).size;
  const n = kept.length;

  // dependence (D-CAL-3(4))
  const Hms = H * MINUTE_MS;
  let withNeighbour = 0;
  let pairedOpposite = 0;
  for (let i = 0; i < n; i++) {
    let best = null;
    let bestDt = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dt = Math.abs(kept[j].scoredAtMs - kept[i].scoredAtMs);
      if (dt <= Hms && (dt < bestDt || (dt === bestDt && kept[j].scoredAtMs < best.scoredAtMs))) {
        best = kept[j];
        bestDt = dt;
      }
    }
    if (best) {
      withNeighbour++;
      if (best.direction !== kept[i].direction) pairedOpposite++;
    }
  }
  let greedy = 0;
  let lastKept = -Infinity;
  for (const r of kept) {
    if (r.scoredAtMs - lastKept >= Hms) {
      greedy++;
      lastKept = r.scoredAtMs;
    }
  }
  const perFDep = {};
  for (const f of FRACTIONS) {
    const sel = kept.filter((r) => r.horizons[f] && r.horizons[f].signedReturnPct !== null);
    const cl = sel.map((r) => clustersOf.get(r.signalId));
    const Gf = new Set(cl).size;
    const win = sel.map((r) => (r.horizons[f].outcome === "favorable" ? 1 : 0));
    const p = win.length ? mean(win) : NaN;
    let designEffect = null;
    if (sel.length >= 2 && Gf >= MIN_CLUSTERS && p > 0 && p < 1) {
      const { variance } = cr1Variance(win.map((v) => v - p), cl);
      designEffect = round6(variance / ((p * (1 - p)) / sel.length));
    }
    const xs = sel.map((r) => r.horizons[f].signedReturnPct);
    let lag1 = null;
    if (xs.length >= 3) {
      const a = xs.slice(0, -1);
      const b = xs.slice(1);
      const ma = mean(a);
      const mb = mean(b);
      let sab = 0;
      let saa = 0;
      let sbb = 0;
      for (let i = 0; i < a.length; i++) {
        sab += (a[i] - ma) * (b[i] - mb);
        saa += (a[i] - ma) ** 2;
        sbb += (b[i] - mb) ** 2;
      }
      lag1 = saa > 0 && sbb > 0 ? round6(sab / Math.sqrt(saa * sbb)) : null;
    }
    perFDep[String(f)] = {
      designEffect: designEffect === null ? { status: "withheld" } : { status: "sealed", value: designEffect },
      lag1Autocorrelation: lag1 === null ? { status: "withheld" } : { status: "sealed", value: lag1 },
    };
  }

  // reliability (D-CAL-3(2)(b))
  const reliability = {};
  for (const f of FRACTIONS) {
    const bins = [];
    for (let k = 0; k < 20; k++) {
      const sel = kept.filter(
        (r) => r.horizons[f] && r.horizons[f].signedReturnPct !== null && binIndex(r.uwrScore) === k
      );
      const cl = sel.map((r) => clustersOf.get(r.signalId));
      const win = sel.map((r) => (r.horizons[f].outcome === "favorable" ? 1 : 0));
      const b = rateBlock(win, cl, BIN_MIN_N);
      bins.push({
        k,
        lower: round6(k * 0.05),
        upper: round6((k + 1) * 0.05),
        n: b.n,
        favorable: b.count,
        status: b.status,
        ...(b.rate !== undefined ? { rate: b.rate } : {}),
        ...(b.se !== undefined ? { se: b.se, interval: b.interval } : {}),
      });
    }
    reliability[String(f)] = bins;
  }

  // rank (D-CAL-3(1)(iv))
  const rank = {};
  for (const f of FRACTIONS) {
    const sel = kept.filter((r) => r.horizons[f] && r.horizons[f].signedReturnPct !== null);
    rank[String(f)] = rankBlock(
      sel.map((r) => r.uwrScore),
      sel.map((r) => r.horizons[f].signedReturnPct),
      sel.map((r) => clustersOf.get(r.signalId))
    );
  }

  // strata (D-CAL-3(2)(c): each block on its own n)
  const strata = { riskBucket: {}, direction: {} };
  for (const rb of sortedUnique(kept.map((r) => String(r.riskBucket ?? "unknown")))) {
    const sel = kept.filter((r) => String(r.riskBucket ?? "unknown") === rb);
    strata.riskBucket[rb] = { n: sel.length, readings: readingsFor(sel), realized: realizedFor(sel, clustersOf, GROUP_MIN_N) };
  }
  for (const d of sortedUnique(kept.map((r) => r.direction))) {
    const sel = kept.filter((r) => r.direction === d);
    strata.direction[d] = { n: sel.length, readings: readingsFor(sel), realized: realizedFor(sel, clustersOf, GROUP_MIN_N) };
  }

  const dirCounts = { long: 0, short: 0, neutral: 0 };
  for (const r of kept) dirCounts[r.direction] = (dirCounts[r.direction] || 0) + 1;
  const symbols = sortedUnique(kept.map((r) => r.symbol));
  const first = kept[0]?.scoredAt ?? null;
  const last = kept[n - 1]?.scoredAt ?? null;
  const spanMs = n ? kept[n - 1].scoredAtMs - kept[0].scoredAtMs : 0;
  const attribution = symbols.length < 2 && spanMs < 28 * DAY_MS ? "corpus" : "analyst";
  const checkpointAts = kept.map((r) => r.checkpointAt).sort(cmpStr);

  const doc = {
    schema: CALIBRATION_SCHEMA_ID,
    rule: CALIBRATION_RULE,
    readingRule: READING_RULE,
    groupKey: key,
    n,
    attribution,
    provenance: {
      signalIds: kept.map((r) => ({ signalId: r.signalId, recordHash: r.recordHash, recordVersion: r.recordVersion })),
      firstScoredAt: first,
      lastScoredAt: last,
      firstCheckpointAt: checkpointAts[0] ?? null,
      lastCheckpointAt: checkpointAts[checkpointAts.length - 1] ?? null,
      symbols,
      timeframes: sortedUnique(kept.map((r) => r.timeframe)),
      providers: sortedUnique(kept.map((r) => String(r.providerId))),
      analystConfigHashes: sortedUnique(kept.map((r) => String(r.analystConfigHash))),
      directions: dirCounts,
      exclusions: {
        unverifiableInput: exclusions?.unverifiableInput ?? 0,
        supersededSinceCheckpoint: exclusions?.supersededSinceCheckpoint ?? 0,
        supersededSinceCalibration,
        magnitudeConventionViolation: exclusions?.magnitudeConventionViolation ?? 0,
      },
    },
    readings: readingsFor(kept),
    realized: realizedFor(kept, clustersOf, GROUP_MIN_N),
    reliability,
    rank,
    strata,
    dependence: {
      clusters: G,
      withNeighbour,
      pairedOpposite,
      pairingFraction: n ? round6(pairedOpposite / n) : 0,
      greedyNonOverlap: greedy,
      perFraction: perFDep,
    },
    supersedes: previous?.seal?.value ?? null,
  };
  return sealCalibration(doc);
}

/**
 * Full pure pipeline: group joined rows by key and build one record per key.
 * previousByKey: Map(keyString → previous record).
 */
export function buildAllCalibrationRecords(reassessments, evidenceBySignalId, historyIds, previousByKey) {
  const groups = new Map();
  const exclusionsByKey = new Map();
  const excludedUnkeyed = { unverifiableInput: 0, supersededSinceCheckpoint: 0, magnitudeConventionViolation: 0 };
  for (const r of reassessments) {
    const e = evidenceBySignalId.get(r.signalId);
    const j = joinRow(r, e, historyIds);
    if (j.exclude) {
      // Attribute the exclusion to the key when the evidence record is readable; else to the run.
      if (e && e.analystId) {
        const probe = joinRow({ ...r, seal: r.seal }, e, new Set()); // key derivation only
        const ks = probe.row ? keyString(probe.row.key) : null;
        if (ks) {
          const ex = exclusionsByKey.get(ks) || { unverifiableInput: 0, supersededSinceCheckpoint: 0, magnitudeConventionViolation: 0 };
          ex[j.exclude]++;
          exclusionsByKey.set(ks, ex);
          if (!groups.has(ks)) groups.set(ks, { key: probe.row.key, rows: [] });
          continue;
        }
      }
      excludedUnkeyed[j.exclude]++;
      continue;
    }
    const ks = keyString(j.row.key);
    if (!groups.has(ks)) groups.set(ks, { key: j.row.key, rows: [] });
    groups.get(ks).rows.push(j.row);
  }
  const records = [];
  for (const [ks, g] of [...groups.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
    records.push(buildCalibrationRecord(g.key, g.rows, previousByKey?.get(ks) ?? null, exclusionsByKey.get(ks)));
  }
  return { records, excludedUnkeyed };
}
