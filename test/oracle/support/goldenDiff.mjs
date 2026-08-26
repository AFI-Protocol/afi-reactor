#!/usr/bin/env node
/**
 * Golden differ — the recursive JSON-path audit every regeneration wave has
 * described in test/oracle/INTENTIONAL_DIFFS.md, committed once so the
 * per-golden itemization D-DEM-7(3) requires is reproducible instead of
 * ad hoc.
 *
 * Usage:
 *   node test/oracle/support/goldenDiff.mjs [--ref <git-ref>] [--dir test/oracle/goldens/enriched] [--json]
 *
 * Compares every golden file under --dir against the same path at --ref
 * (default HEAD, i.e. the committed pre-regeneration bytes). Emits, per
 * JSON path, the set of goldens where it changed and the old → new values
 * (abbreviated), grouped into the itemization classes used by
 * INTENTIONAL_DIFFS.md, plus the list of goldens that are byte-EQUAL.
 *
 * Pure read-only; never rewrites a golden. Test support only (never shipped).
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
const REF = opt("--ref", "HEAD");
const DIR = opt("--dir", "test/oracle/goldens/enriched");
const JSON_OUT = args.includes("--json");

function gitShow(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function walk(a, b, path, out) {
  if (a === b) return;
  const ta = a === null ? "null" : Array.isArray(a) ? "array" : typeof a;
  const tb = b === null ? "null" : Array.isArray(b) ? "array" : typeof b;
  if (ta === "object" && tb === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) walk(a[k], b[k], `${path}/${k}`, out);
    return;
  }
  if (ta === "array" && tb === "array" && a.length === b.length) {
    for (let i = 0; i < a.length; i++) walk(a[i], b[i], `${path}/${i}`, out);
    return;
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  out.push({ path, before: a, after: b });
}

function abbreviate(v) {
  const s = JSON.stringify(v);
  if (s === undefined) return "<absent>";
  return s.length > 48 ? `${s.slice(0, 20)}…${s.slice(-8)}` : s;
}

/** Itemization classes (INTENTIONAL_DIFFS.md vocabulary). Order matters: first match wins. */
const CLASSES = [
  ["scored-value: axes/uwrScore/conviction/riskBucket", /\/(uwrAxes\/|uwrScore$|conviction$|riskBucket$)/],
  ["scored-value: scorerInput", /^\/scorerInput\//],
  ["scored-value: notes/rationale/axisNotes/direction", /\/(rationale|axisNotes|notes|direction)(\/|$)/],
  ["lens payload (technical/other lane bytes)", /\/(lenses\/\d+\/payload|_priceFeedMetadata)\//],
  ["canonical USS (input surface)", /^\/canonicalUss\/|\/rawUss\/|\/httpResponse\/uss\//],
  ["inputHash", /inputHash\/value$/],
  ["outputHash", /outputHash\/value$/],
  ["composition: enrichmentHash", /enrichmentHash\/value$/],
  ["composition: executionSummaryHash", /executionSummaryHash\/value$/],
  ["composition: analystConfigHash", /analystConfigHash\/value$/],
  ["composition: pluginSetHash", /pluginSetHash\/value$/],
  ["composition: manifestHash", /manifestHash\/value$/],
  ["providerInvocations: invocationInputHash", /invocationInputHash\/value$/],
  ["providerInvocations: providerResultHash/categoryResultHash", /(providerResultHash|categoryResultHash)\/value$/],
  ["recordHash", /\/recordHash\/value$/],
  ["replayHash", /\/replayHash\/value$/],
  ["decayParams", /decayParams\//],
  ["other", /./],
];

function classify(path) {
  for (const [name, re] of CLASSES) if (re.test(path)) return name;
  return "other";
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const perFile = {};
const equal = [];
const byPath = new Map(); // path -> { files: Set, samples: [] }
for (const f of files) {
  const abs = join(DIR, f);
  const rel = relative(process.cwd(), abs);
  const now = readFileSync(abs, "utf8");
  const before = gitShow(REF, rel);
  if (before === null) {
    perFile[f] = { status: "new-file" };
    continue;
  }
  if (before === now) {
    equal.push(f);
    perFile[f] = { status: "byte-equal" };
    continue;
  }
  const diffs = [];
  walk(JSON.parse(before), JSON.parse(now), "", diffs);
  perFile[f] = { status: "changed", count: diffs.length, diffs };
  for (const d of diffs) {
    if (!byPath.has(d.path)) byPath.set(d.path, { files: new Set(), samples: [] });
    const e = byPath.get(d.path);
    e.files.add(f);
    if (e.samples.length < 2) e.samples.push(`${f}: ${abbreviate(d.before)} → ${abbreviate(d.after)}`);
  }
}

const byClass = new Map();
for (const [path, e] of byPath) {
  const c = classify(path);
  if (!byClass.has(c)) byClass.set(c, []);
  byClass.get(c).push({ path, files: [...e.files].sort(), samples: e.samples });
}

if (JSON_OUT) {
  const json = { ref: REF, dir: DIR, files: files.length, byteEqual: equal, perFile: Object.fromEntries(Object.entries(perFile).map(([k, v]) => [k, v.status === "changed" ? { status: v.status, count: v.count } : v])), classes: Object.fromEntries([...byClass].map(([c, rows]) => [c, rows])) };
  process.stdout.write(JSON.stringify(json, null, 2) + "\n");
} else {
  console.log(`# goldenDiff — ${DIR} vs ${REF} (${files.length} files)`);
  console.log(`byte-EQUAL (${equal.length}): ${equal.join(", ") || "none"}`);
  for (const f of files) {
    const s = perFile[f];
    if (s.status === "changed") console.log(`changed: ${f} (${s.count} paths)`);
    else if (s.status === "new-file") console.log(`new: ${f}`);
  }
  console.log("");
  for (const [c, rows] of [...byClass].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`## ${c} — ${rows.length} path(s)`);
    for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) {
      console.log(`  ${r.path}  [${r.files.length}/${files.length}: ${r.files.map((x) => x.replace(/\.json$/, "")).join(", ")}]`);
      for (const s of r.samples) console.log(`      ${s}`);
    }
  }
}
