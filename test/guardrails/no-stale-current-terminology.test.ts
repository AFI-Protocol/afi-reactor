/**
 * Mission R0 — Post-Atlas Forward-Only Residue Closure guardrail.
 *
 * The active runtime source describes current architecture only. This guard
 * fails if a stale, superseded evidence-version reference or a retired
 * enrichment-category term reappears as current-facing wording in src/:
 *
 *  - "Evidence V2" / "evidence v1|v2" record wording (the sole current evidence
 *    contract is afi.scored-signal-evidence.v3, EV3-GOV D-EV3-1);
 *  - the retired "afi.scored-signal-evidence.v1|v2" contract id named as current;
 *  - "social score" / "social" as an enrichment category (the current category
 *    is `sentiment`; DSC-GOV D-DSC-7, D1CAP-GOV D-D1CAP-8).
 *
 * Scope: src/ ONLY, excluding the vendored governed-schema/ closure (whose V3
 * schema $comment legitimately records the forward-only supersession of the
 * prior versions per EV3-GOV D-EV3-8) and this guard file (which names the
 * banned wording only to ban it — a negative-space guard).
 */

import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// Repo idiom (see test/guardrails/districtSurfaceConsolidation.test.ts): jest
// runs from the repo root.
const REPO_ROOT = process.cwd();
const THIS_FILE = path.resolve(
  REPO_ROOT,
  "test/guardrails/no-stale-current-terminology.test.ts"
);

const EXTS = [".ts", ".js", ".json", ".md"];

/** Recursively collect eligible files under a root, excluding vendored closures. */
function walk(rel: string): string[] {
  const abs = path.resolve(REPO_ROOT, rel);
  let entries: string[] = [];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const childAbs = path.join(abs, name);
    // Exclude the vendored governed-schema closure — it legitimately records
    // the forward-only supersession of the prior evidence versions.
    if (name === "governed-schema" || name === "node_modules" || name === "dist") {
      continue;
    }
    if (statSync(childAbs).isDirectory()) {
      out.push(...walk(path.relative(REPO_ROOT, childAbs)));
    } else if (EXTS.includes(path.extname(name)) && childAbs !== THIS_FILE) {
      out.push(childAbs);
    }
  }
  return out;
}

/** Current-facing residue patterns that must not appear in active runtime source. */
const BANNED: { name: string; re: RegExp }[] = [
  { name: 'superseded evidence-version wording ("Evidence V1/V2")', re: /\bevidence v[12]\b/i },
  { name: 'retired evidence contract id as current ("afi.scored-signal-evidence.v1|v2")', re: /scored-signal-evidence\.v[12]\b/ },
  { name: '"social" as an enrichment category ("social score" / "social lane")', re: /\bsocial (score|lane|categor|enrichment)/i },
];

describe("R0: active runtime source describes current architecture only", () => {
  const files = walk("src");

  it("scans a non-empty src/ tree", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const { name, re } of BANNED) {
    it(`src/ contains no ${name}`, () => {
      const offenders: string[] = [];
      for (const abs of files) {
        const content = readFileSync(abs, "utf-8");
        if (re.test(content)) offenders.push(path.relative(REPO_ROOT, abs));
      }
      expect(offenders).toEqual([]);
    });
  }
});
