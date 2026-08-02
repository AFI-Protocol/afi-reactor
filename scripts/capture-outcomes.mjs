#!/usr/bin/env node
/**
 * OPERATIONAL outcome capture — "what happened after the score".
 *
 * For every scoring_context document whose horizon has elapsed and that has no
 * outcome row yet, fetches Blofin OHLCV around [capturedAt, capturedAt+H] and
 * appends one signal_outcomes document per (signalId, horizon): entry/exit
 * price, raw and direction-signed return, max favorable/adverse excursion.
 *
 * PLANE RULES: operational store, never canonical evidence (MONGO-GOV
 * D-MONGO-4; "Do not collapse commitment, evidence, and analytics into one
 * store"). Non-normative; log-and-skip on any per-signal failure.
 *
 * Usage:
 *   AFI_EVIDENCE_MONGODB_URI='mongodb+srv://…' node scripts/capture-outcomes.mjs
 *   Optional: --horizons 1h,4h,24h   --db afi_signal_analytics   --dry-run
 */
import { MongoClient } from "mongodb";
import ccxt from "ccxt";

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const DRY = args.includes("--dry-run");
const DB = argOf("--db", process.env.AFI_ANALYTICS_DB_NAME || "afi_signal_analytics");
const HORIZONS = argOf("--horizons", "1h,4h,24h")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const HOUR = 3600_000;
const HORIZON_MS = { "1h": HOUR, "4h": 4 * HOUR, "24h": 24 * HOUR };
const CANDLE_TF = "5m";
const CANDLE_MS = 5 * 60_000;

const URI = process.env.AFI_EVIDENCE_MONGODB_URI;
if (!URI) {
  console.error("FATAL: AFI_EVIDENCE_MONGODB_URI is required (same cluster; analytics db).");
  process.exit(1);
}
for (const h of HORIZONS) {
  if (!HORIZON_MS[h]) {
    console.error(`FATAL: unsupported horizon "${h}" (supported: ${Object.keys(HORIZON_MS).join(", ")})`);
    process.exit(1);
  }
}

/** "BTC/USDT.P" → Blofin swap "BTC/USDT:USDT"; spot passes through. */
function toCcxtSymbol(symbol) {
  if (typeof symbol !== "string" || !symbol.includes("/")) return null;
  return symbol.endsWith(".P") ? `${symbol.slice(0, -2)}:USDT` : symbol;
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

const cursor = contexts.find({}, { projection: { signalId: 1, capturedAt: 1, meta: 1 } });
for await (const ctx of cursor) {
  const capturedMs = Date.parse(ctx.capturedAt);
  if (!Number.isFinite(capturedMs)) { skipped++; continue; }
  const ccxtSymbol = toCcxtSymbol(ctx.meta?.symbol);
  if (!ccxtSymbol) { skipped++; continue; }

  for (const horizon of HORIZONS) {
    const horizonMs = HORIZON_MS[horizon];
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
      const maxHigh = Math.max(...inWindow.map((c) => c[2]));
      const minLow = Math.min(...inWindow.map((c) => c[3]));
      const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      const direction = ctx.meta?.direction ?? "neutral";
      const sign = direction === "short" ? -1 : direction === "long" ? 1 : 0;
      const doc = {
        schema: "afi.operational.signal-outcome.v0",
        plane: "operational",
        signalId: ctx.signalId,
        horizon,
        capturedAt: ctx.capturedAt,
        evaluatedAt: new Date(now).toISOString(),
        symbol: ctx.meta?.symbol,
        ccxtSymbol,
        direction,
        entryPrice,
        exitPrice,
        returnPct,
        signedReturnPct: sign === 0 ? null : sign * returnPct,
        mfePct: sign >= 0 ? ((maxHigh - entryPrice) / entryPrice) * 100 : ((entryPrice - minLow) / entryPrice) * 100,
        maePct: sign >= 0 ? ((entryPrice - minLow) / entryPrice) * 100 : ((maxHigh - entryPrice) / entryPrice) * 100,
        candleTimeframe: CANDLE_TF,
        source: "blofin",
      };
      if (DRY) {
        console.log("[dry-run] would write:", { signalId: doc.signalId, horizon, returnPct: doc.returnPct.toFixed(3) });
      } else {
        await outcomes.insertOne(doc);
        written++;
        console.log(`outcome ${ctx.signalId} @${horizon}: return ${returnPct.toFixed(3)}% (signed ${doc.signedReturnPct === null ? "n/a" : doc.signedReturnPct.toFixed(3) + "%"})`);
      }
    } catch (err) {
      failed++;
      console.warn(`skip ${ctx.signalId} @${horizon}: ${err.message}`);
    }
  }
}

await client.close();
console.log(`done: ${written} written, ${skipped} skipped (not due / already captured / unmappable), ${failed} failed`);
