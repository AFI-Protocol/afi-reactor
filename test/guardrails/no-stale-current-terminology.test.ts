/**
 * Mission R0/R1 — forward-only current-architecture guardrail.
 *
 * The active runtime source describes current architecture only. This guard
 * fails if a superseded evidence-contract major or a retired enrichment-category
 * term reappears as current-facing wording in src/. It is written so its own
 * source contains no retired literal: superseded evidence majors are caught by
 * capturing the version digit (the sole current contract is
 * afi.scored-signal-evidence.v3, EV3-GOV D-EV3-1), and the retired
 * fifth-category term is matched by a needle assembled from fragments at runtime
 * (the current category is `sentiment`; DSC-GOV D-DSC-7, D1CAP-GOV D-D1CAP-8,
 * R1-GOV D-R1-4).
 *
 * Scope: src/ ONLY, excluding the vendored governed-schema/ closure (whose v3
 * schema $comment legitimately records the forward-only supersession per
 * EV3-GOV D-EV3-8).
 */

import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// Repo idiom (see test/guardrails/districtSurfaceConsolidation.test.ts): jest
// runs from the repo root.
const REPO_ROOT = process.cwd();

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
    } else if (EXTS.includes(path.extname(name))) {
      out.push(childAbs);
    }
  }
  return out;
}

describe("R0/R1: active runtime source describes current architecture only", () => {
  const files = walk("src");

  it("scans a non-empty src/ tree", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("names no superseded evidence-contract major (only v3 is current)", () => {
    const offenders: string[] = [];
    for (const abs of files) {
      const content = readFileSync(abs, "utf-8");
      const rel = path.relative(REPO_ROOT, abs);
      // Capture the version digit instead of spelling a superseded major.
      for (const m of content.matchAll(/scored-signal-evidence\.v(\d+)/g)) {
        if (m[1] !== "3") offenders.push(`${rel} (contract .v${m[1]})`);
      }
      for (const m of content.matchAll(/\bevidence v(\d+)/gi)) {
        if (m[1] !== "3") offenders.push(`${rel} (evidence v${m[1]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names no retired fifth-category enrichment term (current is sentiment)", () => {
    // Needle assembled from fragments so this guard's own source carries no literal.
    const retiredCategory = new RegExp(
      "\\b" + ["soc", "ial"].join("") + " (score|lane|categor|enrichment)",
      "i"
    );
    const offenders: string[] = [];
    for (const abs of files) {
      const content = readFileSync(abs, "utf-8");
      if (retiredCategory.test(content)) offenders.push(path.relative(REPO_ROOT, abs));
    }
    expect(offenders).toEqual([]);
  });
});
