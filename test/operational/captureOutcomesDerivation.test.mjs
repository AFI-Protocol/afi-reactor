#!/usr/bin/env node
/**
 * DH-GOV D-DH-2/D-DH-3 derivation law — pure unit coverage for
 * scripts/capture-outcomes-lib.mjs (no Mongo, no network).
 * Run: npm run test:capture-outcomes
 */
import {
  deriveHorizonMinutes,
  excursions,
  horizonLabel,
  parseHorizonLabel,
  resolveHorizonPlan,
  selectWindow,
  toCcxtSymbol,
} from "../../scripts/capture-outcomes-lib.mjs";

let failures = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
  } else {
    failures++;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  }
}

// --- D-DH-2(1): {ceil(H/4), ceil(H/2), H} ---
eq(deriveHorizonMinutes(60), [15, 30, 60], "intraday H=60 -> 15/30/60");
eq(deriveHorizonMinutes(720), [180, 360, 720], "swing H=720 -> 180/360/720");
eq(deriveHorizonMinutes(8), [2, 4, 8], "scalp H=8 -> 2/4/8");
eq(deriveHorizonMinutes(90), [23, 45, 90], "H=90 ceils the quarter (22.5 -> 23)");
eq(deriveHorizonMinutes(7.5), [2, 4, 8], "fractional inline H=7.5 ceils per-window, never rewrites H itself");
eq(deriveHorizonMinutes(0), null, "H=0 rejected");
eq(deriveHorizonMinutes(-5), null, "negative rejected");
eq(deriveHorizonMinutes(undefined), null, "absent rejected");

// --- D-DH-2(1) label grammar ---
eq(horizonLabel(15), "15m", "15 -> 15m");
eq(horizonLabel(60), "1h", "60 -> 1h");
eq(horizonLabel(90), "90m", "90 -> 90m (not a whole hour)");
eq(horizonLabel(180), "3h", "180 -> 3h");
eq(horizonLabel(720), "12h", "720 -> 12h");
eq(horizonLabel(1440), "24h", "1440 -> 24h");
eq(parseHorizonLabel("15m"), 15, "parse 15m");
eq(parseHorizonLabel("1h"), 60, "parse 1h");
eq(parseHorizonLabel("24h"), 1440, "parse 24h");
eq(parseHorizonLabel("90m"), 90, "parse 90m");
eq(parseHorizonLabel("h1"), null, "garbage rejected");
eq(parseHorizonLabel("0m"), null, "zero rejected");
for (const m of [2, 4, 8, 15, 23, 30, 45, 60, 180, 360, 720]) {
  eq(parseHorizonLabel(horizonLabel(m)), m, `label round-trip ${m}min`);
}

// --- D-DH-2 resolveHorizonPlan ---
const CUT = "2026-08-04T00:00:00Z";
const intradayCtx = {
  capturedAt: "2026-08-04T01:00:00.000Z",
  decayParams: { halfLifeMinutes: 60, greeksTemplateId: "decay-intraday-v1" },
};
eq(
  resolveHorizonPlan(intradayCtx, { cutoverIso: CUT }),
  {
    basis: "decay-derived",
    decayRef: { greeksTemplateId: "decay-intraday-v1", halfLifeMinutes: 60 },
    horizons: [
      { label: "15m", minutes: 15, fractionOfHalfLife: 0.25 },
      { label: "30m", minutes: 30, fractionOfHalfLife: 0.5 },
      { label: "1h", minutes: 60, fractionOfHalfLife: 1 },
    ],
  },
  "post-cutover intraday doc derives 15m/30m/1h"
);
eq(
  resolveHorizonPlan({ ...intradayCtx, capturedAt: "2026-08-03T23:59:59.999Z" }, { cutoverIso: CUT }),
  {
    basis: "legacy-global",
    horizons: [
      { label: "1h", minutes: 60 },
      { label: "4h", minutes: 240 },
      { label: "24h", minutes: 1440 },
    ],
  },
  "pre-cutover doc stays on the legacy global set (D-DH-2(3))"
);
eq(
  resolveHorizonPlan({ capturedAt: "2026-08-04T01:00:00.000Z" }, { cutoverIso: CUT }).basis,
  "legacy-global",
  "absent decayParams falls back to legacy (D-DH-2(4))"
);
eq(
  resolveHorizonPlan(
    { capturedAt: "2026-08-04T01:00:00.000Z", decayParams: { halfLifeMinutes: -1, greeksTemplateId: "x" } },
    { cutoverIso: CUT }
  ).basis,
  "legacy-global",
  "malformed half-life falls back to legacy (D-DH-2(4))"
);
eq(
  resolveHorizonPlan(intradayCtx, { overrideMinutes: [10, 25], cutoverIso: CUT }),
  {
    basis: "operator-override",
    horizons: [
      { label: "10m", minutes: 10 },
      { label: "25m", minutes: 25 },
    ],
  },
  "explicit --horizons override wins outright (D-DH-2(4))"
);
eq(
  resolveHorizonPlan(
    { capturedAt: "2026-08-04T01:00:00.000Z", decayParams: { halfLifeMinutes: 720, greeksTemplateId: "decay-swing-v1" } },
    { cutoverIso: CUT }
  ).horizons.map((h) => h.label),
  ["3h", "6h", "12h"],
  "swing-stamped doc would derive 3h/6h/12h (stamped-value law)"
);
eq(
  resolveHorizonPlan(intradayCtx, { cutoverIso: "not-a-date" }).basis,
  "legacy-global",
  "unparseable cutover fails CLOSED to legacy law (NaN-safe guard, D-DH-2(3))"
);
eq(
  resolveHorizonPlan(intradayCtx, { cutoverIso: "9999-01-01T00:00:00Z" }).basis,
  "legacy-global",
  "far-future placeholder cutover keeps everything on legacy law (fail-safe)"
);

// --- D-DH-4(1) selectWindow head assertion ---
const W0 = Date.parse("2026-08-04T01:00:00Z");
const mk = (offsetsMin) => offsetsMin.map((m) => [W0 + m * 60_000, 100, 101, 99, 100.5]);
eq(
  selectWindow(mk([-5, 0, 5, 10]), W0 - 5 * 60_000, W0 + 15 * 60_000, W0).length,
  4,
  "well-formed window passes selectWindow"
);
let threw = null;
try { selectWindow(mk([5, 10, 15]), W0 - 5 * 60_000, W0 + 15 * 60_000, W0); } catch (e) { threw = e.message; }
eq(/window head missing/.test(threw ?? ""), true, "front-truncated fetch (head after capture) throws loudly");
threw = null;
try { selectWindow(mk([0]), W0 - 5 * 60_000, W0 + 15 * 60_000, W0); } catch (e) { threw = e.message; }
eq(/insufficient candles/.test(threw ?? ""), true, "single-candle window still rejected");

// --- D-DH-3(2) excursions + timing (candles: [ts, o, h, l, c], 5m spacing) ---
const T0 = Date.parse("2026-08-04T01:00:00Z");
const M = 60_000;
const candles = [
  [T0, 100, 101, 99.5, 100.4], // entry candle (close 100.4)
  [T0 + 5 * M, 100.4, 103, 100.2, 102], // max high @ +5m
  [T0 + 10 * M, 102, 102.5, 98, 99], // min low @ +10m
  [T0 + 15 * M, 99, 103, 98, 100], // ties with earlier extremes -> first occurrence wins
];
const entry = 100.4;
const excLong = excursions(candles, entry, 1);
eq(
  { mfeAt: excLong.mfeAtMinutes, maeAt: excLong.maeAtMinutes },
  { mfeAt: 5, maeAt: 10 },
  "long: MFE at the +5m max-high candle, MAE at the +10m min-low candle (first occurrence on ties)"
);
eq(
  { mfe: excLong.mfePct.toFixed(4), mae: excLong.maePct.toFixed(4) },
  { mfe: (((103 - entry) / entry) * 100).toFixed(4), mae: (((entry - 98) / entry) * 100).toFixed(4) },
  "long: excursion values match the v0 formulas"
);
const excShort = excursions(candles, entry, -1);
eq(
  { mfeAt: excShort.mfeAtMinutes, maeAt: excShort.maeAtMinutes },
  { mfeAt: 10, maeAt: 5 },
  "short: favorable/adverse mirror (MFE at min-low, MAE at max-high)"
);
const excNeutral = excursions(candles, entry, 0);
eq(
  { mfeAt: excNeutral.mfeAtMinutes, maeAt: excNeutral.maeAtMinutes },
  { mfeAt: 5, maeAt: 10 },
  "neutral follows the long branch (v0 convention)"
);

// --- governed-fact symbol translation unchanged ---
eq(toCcxtSymbol("BTC/USDT", "perp"), "BTC/USDT:USDT", "perp fact -> swap notation");
eq(toCcxtSymbol("BTC/USDT", "spot"), "BTC/USDT", "spot fact -> as-is");
eq(toCcxtSymbol("BTC/USDT.P", undefined), "BTC/USDT:USDT", "legacy .P suffix honored");
eq(toCcxtSymbol("BTC/USDT", undefined), null, "no market fact -> honest null");
eq(toCcxtSymbol("BTCUSDT", "perp"), null, "no slash -> null");

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall capture-outcomes derivation checks passed");
