/**
 * DSC-GOV D-DSC-8 consolidation guardrails (Mission A — Clean-Cut District
 * Surface Consolidation; afi-governance decisions/district-surface-
 * consolidation-v0.1.md, accepted PR #24, merge commit bebe839).
 *
 * Enforces exactly the six clean-cut invariants plus the governed golden's
 * byte-stability:
 *  1. No path beneath src/pipeheads/ may return.
 *  2. No MLProviderRegistry / TinyBrainsProvider symbol may return.
 *  3. No second executor implementation may be introduced.
 *  4. No 'social' category identifier in current enrichment code.
 *  5. The relocated District-2 provenance imports no retired module
 *     (src/ is entirely free of pipeheads references).
 *  6. Current runtime imports no demo/reference code.
 *  7. test/pipeheads/fixtures/golden.json stays byte-identical (standing
 *     conditions: uwr-runtime-consumption-v0.1.md:175, uwr-profile-pin-
 *     v0.1.md:161, afi-config schemas/uwr-profile/v0/README.md:26).
 */

import { describe, it, expect } from "@jest/globals";
import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// Repo idiom (see test/evidence/provenance/*.test.ts): jest runs from the repo root.
const REPO_ROOT = process.cwd();

/** Standing byte-stability pin (UWR-RUNTIME RC; UP-11 mint-eligibility gate). */
const GOLDEN_RELATIVE_PATH = "test/pipeheads/fixtures/golden.json";
const GOLDEN_SHA256 =
  "312da1180b0bd418c03f595093516ebdc755ba81465a0b526ace43d002126e06";

const THIS_FILE = path.resolve(
  REPO_ROOT,
  "test/guardrails/districtSurfaceConsolidation.test.ts"
);

function walkFiles(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const abs = path.join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walkFiles(abs, exts));
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(abs);
    }
  }
  return out;
}

function offendersIn(
  roots: string[],
  exts: readonly string[],
  matcher: (content: string) => boolean,
  exclude: readonly string[] = []
): string[] {
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of walkFiles(path.resolve(REPO_ROOT, root), exts)) {
      if (exclude.includes(file)) continue;
      if (matcher(readFileSync(file, "utf8"))) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
  }
  return offenders.sort();
}

describe("DSC-1: no path beneath src/pipeheads/ may return", () => {
  it("src/pipeheads does not exist", () => {
    expect(existsSync(path.resolve(REPO_ROOT, "src/pipeheads"))).toBe(false);
  });
});

describe("DSC-2: the dead alternate ML-provider registry may not return", () => {
  it("no MLProviderRegistry / TinyBrainsProvider symbol and no aiMl/providers path in src or test", () => {
    const offenders = offendersIn(
      ["src", "test"],
      [".ts", ".js", ".json"],
      (content) =>
        /MLProviderRegistry|TinyBrainsProvider|aiMl\/providers/.test(content),
      [THIS_FILE]
    );
    expect(offenders).toEqual([]);
  });
});

describe("DSC-3: exactly one executor implementation", () => {
  it("the only executor class in src/ is GraphExecutor in src/pipeline/executor.ts", () => {
    const declarations: string[] = [];
    for (const file of walkFiles(path.resolve(REPO_ROOT, "src"), [".ts"])) {
      const content = readFileSync(file, "utf8");
      const matches = content.match(/class\s+\w*Executor\b/g);
      if (matches) {
        for (const m of matches) {
          declarations.push(`${path.relative(REPO_ROOT, file)}: ${m}`);
        }
      }
    }
    expect(declarations).toEqual(["src/pipeline/executor.ts: class GraphExecutor"]);
  });

  it("GraphExecutor is constructed exactly once in production code", () => {
    const sites: string[] = [];
    for (const file of walkFiles(path.resolve(REPO_ROOT, "src"), [".ts"])) {
      const content = readFileSync(file, "utf8");
      const count = (content.match(/new\s+GraphExecutor\s*\(/g) ?? []).length;
      if (count > 0) {
        sites.push(`${path.relative(REPO_ROOT, file)} x${count}`);
      }
    }
    expect(sites).toEqual(["src/config/runtimeComposition.ts x1"]);
  });
});

describe("DSC-4: no 'social' category identifier in current enrichment code", () => {
  it("src/pipeline, src/providers, src/enrichment carry no 'social' identifier", () => {
    const offenders = offendersIn(
      ["src/pipeline", "src/providers", "src/enrichment"],
      [".ts", ".json"],
      (content) => /["']social["']/.test(content)
    );
    expect(offenders).toEqual([]);
  });
});

describe("DSC-5: relocated District-2 provenance imports no retired module", () => {
  it("src/ is entirely free of pipeheads references", () => {
    const offenders = offendersIn(["src"], [".ts", ".js", ".json"], (content) =>
      /pipeheads/.test(content)
    );
    expect(offenders).toEqual([]);
  });
});

describe("DSC-6: current runtime imports no demo/reference code", () => {
  it("no src/ module imports from a cli/ or demo module", () => {
    const offenders = offendersIn(["src"], [".ts"], (content) =>
      /from\s+["'][^"']*(\/cli\/|run-pipehead-demo)[^"']*["']/.test(content)
    );
    expect(offenders).toEqual([]);
  });
});

describe("DSC-7: the governed golden stays byte-identical at its governed path", () => {
  it(`${GOLDEN_RELATIVE_PATH} has the pinned sha256`, () => {
    const abs = path.resolve(REPO_ROOT, GOLDEN_RELATIVE_PATH);
    expect(existsSync(abs)).toBe(true);
    const digest = createHash("sha256").update(readFileSync(abs)).digest("hex");
    expect(digest).toBe(GOLDEN_SHA256);
  });
});

// ---------------------------------------------------------------------------
// FLPR-GOV five-lane provider runtime guardrails (afi-governance
// decisions/five-lane-provider-runtime-v0.1.md): the provider framework is
// the SOLE live enrichment-execution seam; no classic direct-call category
// node and no enrichment HTTP outside src/providers/ may return.
// ---------------------------------------------------------------------------

describe("FLPR-1: no classic direct-call category node may return", () => {
  it("src/pipeline/nodes/ holds only the merge, scorer, and laneView modules", () => {
    const dir = path.resolve(REPO_ROOT, "src/pipeline/nodes");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
    expect(files).toEqual([
      "laneView.ts",
      "mergeEnrichedView.ts",
      "scorerFroggyTrendPullback.ts",
    ]);
  });
});

describe("FLPR-2: no enrichment HTTP transport outside src/providers/", () => {
  it("no src module outside src/providers/ names an enrichment provider host", () => {
    const HOSTS = /newsdata\.io|coinalyze\.net|publicreporting\.cftc\.gov|efts\.sec\.gov|alternative\.me|api\.coingecko\.com/;
    const offenders = offendersIn(["src"], [".ts"], (content) => HOSTS.test(content)).filter(
      (f) => !f.replace(/\\/g, "/").includes("src/providers/")
    );
    expect(offenders).toEqual([]);
  });

  it("the retired direct enrichment clients may not return", () => {
    for (const retired of [
      "src/aiMl",
      "src/adapters/coinalyze",
      "src/adapters/coingecko",
      "src/adapters/external",
      "src/indicator/regimeCandleProvider.ts",
      "src/indicator/froggySentimentProfile.ts",
      "src/indicator/patternRegimeProfile.ts",
    ]) {
      expect(existsSync(path.resolve(REPO_ROOT, retired))).toBe(false);
    }
  });
});

describe("FLPR-3: the registered reference manifest selects all five lanes explicitly", () => {
  it("every analysis-lane node in the fixture froggy manifest carries a providerInstanceRef", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.resolve(
          REPO_ROOT,
          "test/pipeline/fixtures/afi-config/registries/pipelines/froggy-trend-pullback--v1.1.0.json"
        ),
        "utf-8"
      )
    ) as { nodes: Array<{ category: string; providerInstanceRef?: unknown }> };
    const LANES = new Set(["technical", "pattern", "sentiment", "news", "aiMl"]);
    const laneNodes = manifest.nodes.filter((n) => LANES.has(n.category));
    expect(laneNodes).toHaveLength(5);
    for (const node of laneNodes) {
      expect(node.providerInstanceRef).toBeDefined();
    }
    expect(new Set(laneNodes.map((n) => n.category)).size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Mission R forward-only residue eradication: the retired "classic codex/DAG
// orchestrator" surface (MCP tool suite, ops runner/server/codex scripts,
// eliza plugins, codex/agent config registries, DAG-node type shims) is
// unreachable from the live five-lane GraphExecutor runtime and is DELETED.
// git history is the archive; none of it may return.
// ---------------------------------------------------------------------------

describe("MR-1: the retired classic codex/DAG orchestrator surface may not return", () => {
  it("no classic orchestrator directory, config, or DAG-node type returns", () => {
    for (const retired of [
      "ops",
      "tools",
      "plugins",
      "cli",
      "codex",
      "types/DAGNode.ts",
      "types/codex.ts",
      "types/CodexReplayResult.ts",
      "types/ReactorSignalEnvelope.ts",
      "config/agent.registry.json",
      "config/agents.codex.json",
      "config/execution-agent.registry.json",
      "config/ops.codex.json",
      "config/schema.codex.json",
      ".afi-codex.json",
      ".factory/skills/add-dag-node",
    ]) {
      expect(existsSync(path.resolve(REPO_ROOT, retired))).toBe(false);
    }
  });
});
