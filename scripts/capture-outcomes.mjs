#!/usr/bin/env node
/**
 * OPERATIONAL outcome capture — "what happened after the score".
 *
 * For every scoring_context document whose horizon has elapsed and that has no
 * outcome row yet, fetches Blofin OHLCV around [capturedAt, capturedAt+H] and
 * appends one signal_outcomes document per (signalId, horizon): entry/exit
 * price, raw and direction-signed return, max favorable/adverse excursion and
 * WHEN each occurred (D-DH-3 excursion timing).
 *
 * HORIZON LAW (DH-GOV D-DH-2): horizons derive from the signal's STAMPED
 * decayParams as {H/4, H/2, H} minutes of the declared half-life — the
 * analyst strategy config, not a global constant, decides how long a signal's
 * performance window is (decay-intraday-v1 → 15m/30m/1h). Docs captured
 * before the DH_CUTOVER_ISO deploy boundary, or without a usable stamp,
 * complete under the legacy global set (1h/4h/24h). An explicit --horizons
 * argument is an operator override.
 *
 * PLANE RULES: operational store, never canonical evidence (MONGO-GOV
 * D-MONGO-4; "Do not collapse commitment, evidence, and analytics into one
 * store"). Non-normative; log-and-skip on any per-signal failure.
 *
 * Usage:
 *   AFI_EVIDENCE_MONGODB_URI='mongodb+srv://…' node scripts/capture-outcomes.mjs
 *   Optional: --horizons 15m,30m,1h   --db afi_signal_analytics   --dry-run
 */
import { MongoClient } from "mongodb";
import ccxt from "ccxt";
import {
  CANDLE_MS,
  DH_CUTOVER_ISO,
  excursions,
  parseHorizonLabel,
  resolveHorizonPlan,
  toCcxtSymbol,
} from "./capture-outcomes-lib.mjs";

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const DRY = args.includes("--dry-run");
const DB = argOf("--db", process.env.AFI_ANALYTICS_DB_NAME || "afi_signal_analytics");

const CANDLE_TF = "5m";
const SCHEMA_ID = "afi.operational.signal-outcome.v0.1";

const overrideRaw = argOf("--horizons", null);
let overrideMinutes = null;
if (overrideRaw !== null) {
  overrideMinutes = overrideRaw.split(",").map((h) => h.trim()).filter(Boolean).map(parseHorizonLabel);
  if (overrideMinutes.length === 0 || overrideMinutes.some((m) => m === null)) {
    console.error(`FATAL: --horizons '${overrideRaw}' does not parse under the label grammar (e.g. 15m,30m,1h)`);
    process.exit(1);
  }
}

const URI = process.env.AFI_EVIDENCE_MONGODB_URI;
if (!URI) {
  console.error("FATAL: AFI_EVIDENCE_MONGODB_URI is required (same cluster; analytics db).");
  process.exit(1);
}

const client = new MongoClient(URI);
await client.connect();
const db = client.db(DB);
const contexts = db.collection("scoring_context");
const outcomes = db.collection("signal_outcomes");
await outcomes.createIndex({ signalId: 1, horizon: 1 }, { unique: true, name: "signalId_horizon_unique" });

const exchange = new ccxt.blofin({ enableRateLimit: true });
const now = Date.now();
let written = 0, skipped = 0, failed = 0;

const cursor = contexts.find(
  {},
  { projection: { signalId: 1, capturedAt: 1, meta: 1, decayParams: 1, "rawUss.facts.market": 1 } }
);
for await (const ctx of cursor) {
  const capturedMs = Date.parse(ctx.capturedAt);
  if (!Number.isFinite(capturedMs)) { skipped++; continue; }
  const market = ctx.meta?.market ?? ctx.rawUss?.facts?.market;
  const ccxtSymbol = toCcxtSymbol(ctx.meta?.symbol, market);
  if (!ccxtSymbol) { skipped++; continue; }

  const plan = resolveHorizonPlan(ctx, { overrideMinutes, cutoverIso: DH_CUTOVER_ISO });

  for (const { label: horizon, minutes, fractionOfHalfLife } of plan.horizons) {
    const horizonMs = minutes * 60_000;
    if (capturedMs + horizonMs > now) { skipped++; continue; }
    const exists = await outcomes.findOne({ signalId: ctx.signalId, horizon }, { projection: { _id: 1 } });
    if (exists) { skipped++; continue; }

    try {
      const since = capturedMs - CANDLE_MS;
      const need = Math.ceil(horizonMs / CANDLE_MS) + 3;
      const candles = await exchange.fetchOHLCV(ccxtSymbol, CANDLE_TF, since, Math.min(need, 300));
      const inWindow = candles.filter(([ts]) => ts >= since && ts <= capturedMs + horizonMs);
      if (inWindow.length < 2) throw new Error(`insufficient candles (${inWindow.length})`);

      const entryPrice = inWindow[0][4];
      const exitPrice = inWindow[inWindow.length - 1][4];
      const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      const direction = ctx.meta?.direction ?? "neutral";
      const sign = direction === "short" ? -1 : direction === "long" ? 1 : 0;
      const exc = excursions(inWindow, entryPrice, sign);
      const doc = {
        schema: SCHEMA_ID,
        plane: "operational",
        signalId: ctx.signalId,
        horizon,
        horizonBasis: plan.basis,
        ...(plan.basis === "decay-derived"
          ? { decayRef: { ...plan.decayRef, fractionOfHalfLife } }
          : {}),
        capturedAt: ctx.capturedAt,
        evaluatedAt: new Date(now).toISOString(),
        symbol: ctx.meta?.symbol,
        ccxtSymbol,
        direction,
        entryPrice,
        exitPrice,
        returnPct,
        signedReturnPct: sign === 0 ? null : sign * returnPct,
        mfePct: exc.mfePct,
        maePct: exc.maePct,
        mfeAtMinutes: exc.mfeAtMinutes,
        maeAtMinutes: exc.maeAtMinutes,
        candleTimeframe: CANDLE_TF,
        source: "blofin",
      };
      if (DRY) {
        console.log("[dry-run] would write:", { signalId: doc.signalId, horizon, basis: plan.basis, returnPct: doc.returnPct.toFixed(3) });
      } else {
        await outcomes.insertOne(doc);
        written++;
        console.log(`outcome ${ctx.signalId} @${horizon} (${plan.basis}): return ${returnPct.toFixed(3)}% (signed ${doc.signedReturnPct === null ? "n/a" : doc.signedReturnPct.toFixed(3) + "%"}; mfe@${doc.mfeAtMinutes}m mae@${doc.maeAtMinutes}m)`);
      }
    } catch (err) {
      failed++;
      console.warn(`skip ${ctx.signalId} @${horizon}: ${err.message}`);
    }
  }
}

await client.close();
console.log(`done: ${written} written, ${skipped} skipped (not due / already captured / unmappable), ${failed} failed`);
