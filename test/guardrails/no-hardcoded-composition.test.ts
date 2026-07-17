/**
 * NO-HARDCODED-COMPOSITION guardrails (W3 spec section 8.3; FCP-GOV D-FCP-5 /
 * D-FCP-9): source-scans proving the ACTIVE runtime contains no hardcoded
 * composition identity — the pipeline graph, strategy triple, decay
 * selection, provider routing, and UWR recognition all flow from the
 * boot-validated registries.
 *
 * CLEANUP-PENDING ALLOWLIST: EMPTY. SLOT-FCP-CLEANUP executed the D-FCP-9
 * removal list (the superseded scoring service, runners, static pipeline
 * wiring, duplicated type surfaces, old combined plugins, and the src/dag
 * scaffold are DELETED — git history is the archive). Nothing may ever be
 * re-allowlisted: every file carries the full ban set.
 */
import { describe, it, expect } from "@jest/globals";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();

/**
 * The D-FCP-9 cleanup-pending set is EMPTY (the cleanup PR deleted the files
 * and emptied this list, as the slot required). It stays declared so the
 * emptiness itself is pinned by a test below.
 */
const CLEANUP_PENDING = new Set<string>();

/**
 * Paths removed by D-FCP-9 that must never resurface (file or directory).
 */
const REMOVED_PATHS = [
  "src/dag",
  "src/state",
  "src/services/froggyScoringService.ts",
  "src/services/pipelineRunner.ts",
  "src/config/froggyPipeline.ts",
  "src/config/enrichmentProfiles.ts",
  "src/types/dag.ts",
  "src/types/pipeline.ts",
  "src/adapters/exchanges/demoPriceFeedAdapter.ts",
  "plugins/froggy-enrichment-tech-pattern.plugin.ts",
  "plugins/froggy-enrichment-sentiment-news.plugin.ts",
  "plugins/froggy-enrichment-adapter.plugin.ts",
  "plugins/froggy.trend_pullback_v1.plugin.ts",
  "core/dag-engine.ts",
  "config/dag.codex.json",
];

/**
 * Import-specifier fragments of the removed modules: no active module may
 * import any of them, under any relative prefix.
 */
const REMOVED_IMPORT_FRAGMENTS = [
  "froggyPipeline",
  "froggyScoringService",
  "pipelineRunner",
  "enrichmentProfiles",
  "types/dag",
  "types/pipeline",
];

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
      const content = readFileSync(path.resolve(REPO_ROOT, rel), "utf8");
      if (matches(content, rel)) hits.push(rel);
    }
  }
  return hits.sort();
}

describe("no-hardcoded-composition (active runtime; D-FCP-9 cleanup executed)", () => {
  it("the cleanup-pending allowlist is EMPTY and stays empty (D-FCP-9 executed; nothing may be re-allowlisted)", () => {
    expect([...CLEANUP_PENDING]).toEqual([]);
  });

  it("every D-FCP-9-removed path stays deleted (git history is the archive)", () => {
    const survivors = REMOVED_PATHS.filter((rel) =>
      existsSync(path.resolve(REPO_ROOT, rel))
    );
    expect(survivors).toEqual([]);
  });

  it("no module imports a D-FCP-9-removed module (src/ + plugins/)", () => {
    for (const fragment of REMOVED_IMPORT_FRAGMENTS) {
      const re = new RegExp(
        `from\\s+["'][^"']*${fragment.replace(/[./]/g, "\\$&")}(\\.js)?["']`
      );
      expect({
        fragment,
        offenders: offenders(["src", "plugins"], (c) => re.test(c)),
      }).toEqual({ fragment, offenders: [] });
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

  it("no active module imports the deleted src/dag engine (src/ + plugins/)", () => {
    expect(
      offenders(
        ["src", "plugins"],
        (c) => /from\s+["'][^"']*\/dag\//.test(c) || /from\s+["']\.\.?\/dag["']/.test(c)
      )
    ).toEqual([]);
  });

  it("no active src/ module imports afi-factory (authoring stays out of the runtime)", () => {
    expect(offenders(["src"], (c) => /from\s+["']afi-factory/.test(c))).toEqual([]);
  });

  it("no synthetic price-feed registration or silent demo default in src/", () => {
    // The deterministic synthetic adapter lives ONLY under test/support/ and
    // enters the registry ONLY through registerPriceFeedAdapterForTests.
    // src/ may never import a demo/deterministic adapter module ...
    expect(
      offenders(["src"], (c) =>
        /from\s+["'][^"']*(demo|deterministic)PriceFeedAdapter/i.test(c)
      )
    ).toEqual([]);
    // ... never register a 'demo' entry in an adapter map ...
    expect(
      offenders(["src"], (c) => /\bdemo\s*:\s*[A-Za-z_$][\w$]*/.test(c))
    ).toEqual([]);
    // ... never set AFI_PRICE_FEED_SOURCE to demo itself ...
    expect(
      offenders(["src"], (c) =>
        /AFI_PRICE_FEED_SOURCE\s*(\]\s*)?=\s*["']demo["']/.test(c)
      )
    ).toEqual([]);
    // ... and the registry keeps NO NODE_ENV-conditional default of any kind.
    const registry = readFileSync(
      path.resolve(REPO_ROOT, "src/adapters/exchanges/priceFeedRegistry.ts"),
      "utf8"
    );
    expect(registry).not.toMatch(/NODE_ENV[^\n]*["']test["']/);
    expect(registry).not.toMatch(/["']demo["']\s*[,;]?\s*$/m);
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
