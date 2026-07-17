/**
 * NO-HARDCODED-COMPOSITION guardrails (W3 spec section 8.3; FCP-GOV D-FCP-5 /
 * D-FCP-9): source-scans proving the ACTIVE runtime contains no hardcoded
 * composition identity — the pipeline graph, strategy triple, decay
 * selection, provider routing, and UWR recognition all flow from the
 * boot-validated registries.
 *
 * CLEANUP-PENDING ALLOWLIST: the superseded old-path files stay PRESENT but
 * UNREFERENCED from the live path until the SLOT-FCP-CLEANUP PR deletes them
 * (D-FCP-9 — deliberately, so this slot's diff stays reviewable). The cleanup
 * PR must EMPTY this allowlist. Nothing outside it may carry a banned
 * pattern.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

/**
 * The EXACT cleanup-pending file set (D-FCP-9 removal list, as it exists in
 * this repo today). The cleanup PR deletes these files and empties this list.
 */
const CLEANUP_PENDING = new Set<string>([
  // superseded scoring service + static pipeline wiring
  "src/services/froggyScoringService.ts",
  "src/services/pipelineRunner.ts", // linear runPipeline + runPipelineDag
  "src/config/froggyPipeline.ts",
  "src/config/enrichmentProfiles.ts",
  // superseded type surfaces
  "src/types/dag.ts",
  "src/types/pipeline.ts",
  // the old plugin implementations (plugins/ dir)
  "plugins/froggy-enrichment-tech-pattern.plugin.ts",
  "plugins/froggy-enrichment-sentiment-news.plugin.ts",
  "plugins/froggy-enrichment-adapter.plugin.ts",
  "plugins/froggy.trend_pullback_v1.plugin.ts",
]);

/** src/dag/ is cleanup-pending WHOLESALE (experimental DAG engine, D-FCP-9). */
const CLEANUP_PENDING_DIRS = ["src/dag/"];

function isCleanupPending(rel: string): boolean {
  const norm = rel.split(path.sep).join("/");
  if (CLEANUP_PENDING.has(norm)) return true;
  return CLEANUP_PENDING_DIRS.some((d) => norm.startsWith(d));
}

/** Recursively collect .ts files under dir (skips node_modules/dist). */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        out.push(path.relative(REPO_ROOT, full));
      }
    }
  };
  walk(dir);
  return out;
}

function offenders(
  roots: string[],
  matches: (content: string, rel: string) => boolean
): string[] {
  const hits: string[] = [];
  for (const root of roots) {
    for (const rel of tsFiles(path.resolve(REPO_ROOT, root))) {
      if (isCleanupPending(rel)) continue;
      const content = readFileSync(path.resolve(REPO_ROOT, rel), "utf8");
      if (matches(content, rel)) hits.push(rel);
    }
  }
  return hits.sort();
}

describe("no-hardcoded-composition (active runtime; cleanup-pending files allowlisted)", () => {
  it("the cleanup-pending allowlist names only files that still exist (stale rows must be dropped)", () => {
    for (const rel of CLEANUP_PENDING) {
      expect({ rel, exists: existsSyncSafe(rel) }).toEqual({ rel, exists: true });
    }
  });

  it("FROGGY_TREND_PULLBACK_PIPELINE never enters the live path (server → resolution → executor)", () => {
    expect(
      offenders(["src", "plugins"], (c) => c.includes("FROGGY_TREND_PULLBACK_PIPELINE"))
    ).toEqual([]);
  });

  it("the removed 'cpj-ingested' constant never reappears", () => {
    expect(offenders(["src", "plugins"], (c) => /["']cpj-ingested["']/.test(c))).toEqual([]);
  });

  it("no hardcoded provider-symbol literal (BTCUSDT_PERP.A) in src/", () => {
    expect(offenders(["src"], (c) => c.includes("BTCUSDT_PERP.A"))).toEqual([]);
  });

  it("no hardcoded 'swing' decay selection in the live path (decay resolves from the registration)", () => {
    // pickDecayParamsForAnalystScore (the horizon-inferring helper with the
    // "swing" fallback) is superseded by resolveDecayParams over the
    // registration's decayConfig; the live path must not call it, nor pick a
    // horizon literal itself.
    expect(
      offenders(["src", "plugins"], (c) => c.includes("pickDecayParamsForAnalystScore"))
    ).toEqual([]);
    expect(
      offenders(["src"], (c) => /DEFAULT_DECAY_TEMPLATES_BY_HORIZON\s*\[\s*["']swing["']\s*\]/.test(c))
    ).toEqual([]);
  });

  it("no froggy identity conditional in stamp/resolution code (registry-backed recognition)", () => {
    for (const rel of [
      "src/config/uwrProfilePin.ts",
      "src/config/strategyResolution.ts",
      "src/config/runtimeComposition.ts",
      "src/services/graphScoringService.ts",
    ]) {
      const content = readFileSync(path.resolve(REPO_ROOT, rel), "utf8");
      expect({ rel, hasFroggyConditional: /["']froggy["']/.test(content) }).toEqual({
        rel,
        hasFroggyConditional: false,
      });
    }
  });

  it("no active src/ module imports the superseded src/dag engine", () => {
    expect(
      offenders(["src"], (c) => /from\s+["'][^"']*\/dag\//.test(c) || /from\s+["']\.\.?\/dag["']/.test(c))
    ).toEqual([]);
  });

  it("no active src/ module imports afi-factory (authoring stays out of the runtime)", () => {
    expect(offenders(["src"], (c) => /from\s+["']afi-factory/.test(c))).toEqual([]);
  });

  it("the live server routes score ONLY through resolution + the graph executor", () => {
    const server = readFileSync(path.resolve(REPO_ROOT, "src/server.ts"), "utf8");
    expect(server).not.toContain("froggyScoringService");
    expect(server).not.toContain("runFroggyTrendPullback");
    expect(server).toContain("resolveStrategyForProvider");
    expect(server).toContain("scoreRegisteredStrategyFromCanonicalUss");
    expect(server).toContain("initRuntimeComposition");
  });
});

function existsSyncSafe(rel: string): boolean {
  try {
    readFileSync(path.resolve(REPO_ROOT, rel));
    return true;
  } catch {
    return false;
  }
}
