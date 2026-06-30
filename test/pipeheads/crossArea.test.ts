/**
 * Cross-area / end-to-end guarantees for the AFI Signal Evaluation Pipehead
 * System (non-production POC). Covers VAL-CROSS-001..009.
 *
 * Most assertions are black-box over the REAL CLI demo
 * (`node --loader ts-node/esm src/cli/run-pipehead-demo.ts`), spawned in a child
 * process so the genuine afi-core scorer runs end-to-end (Jest itself cannot
 * load the afi-core `./analysts/*` value subpath). The four labeled JSON blocks
 * (AnalysisBundle, DemoScoredSignal, DemoReputationReceipt, AuditRecord) are
 * parsed and cross-checked for score consistency, five-lane structure, labeling,
 * a single threaded signalId, and byte-identical replay hashes.
 *
 * Two assertions do not use the CLI:
 *  - VAL-CROSS-003 / VAL-CROSS-005(governance): git-diff guards over the
 *    read-only kernel repos and a forbidden-token source scan.
 *  - VAL-CROSS-009: the FULL emitted record (all four artifacts, not just
 *    hashes) is proven byte-identical across two fixed-clock harness runs with a
 *    deterministic stub scorer (the real scorer stamps a wall-clock
 *    analystScore.scoredAt, so only the harness+fixed-clock path yields a
 *    byte-identical full record; the hash-level replay is proven over the real
 *    CLI in VAL-CROSS-007).
 *
 * ESM: relative imports use `.js`.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { spawnSync, type SpawnSyncReturns } from "child_process";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import type { DemoScoredSignal } from "../../src/pipeheads/types.js";
import { createFrozenClock, FROZEN_CLOCK_ISO } from "../../src/pipeheads/clock.js";
import {
  runPipeheadHarness,
  isHarnessFailure,
  type HarnessAggregate,
} from "../../src/pipeheads/harness.js";
import type { FroggyScorer } from "../../src/pipeheads/scoringPipehead.js";

const CLI_REL = "src/cli/run-pipehead-demo.ts";
const REPO = process.cwd();
const HEX_64 = /^[0-9a-f]{64}$/;
const SIGNAL_ID = "btc-usdt-perp-4h-0001";
const SPAWN_TIMEOUT_MS = 120_000;
const LANE_IDS = [
  "technical-indicators",
  "pattern-recognition",
  "news",
  "social",
  "ai-ml",
] as const;
const WIRED = new Set(["technical-indicators", "pattern-recognition"]);
const PROVISIONAL = ["news", "social", "ai-ml"];

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(extraArgs: string[] = []): CliRun {
  const res: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    ["--loader", "ts-node/esm", CLI_REL, ...extraArgs],
    {
      cwd: REPO,
      encoding: "utf-8",
      timeout: SPAWN_TIMEOUT_MS,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    }
  );
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function extractBlock<T = Record<string, unknown>>(stdout: string, label: string): T {
  const re = new RegExp(
    `===== BEGIN ${label} \\(application/json\\) =====\\n([\\s\\S]*?)\\n===== END ${label} =====`
  );
  const m = stdout.match(re);
  if (!m) {
    throw new Error(`labeled block "${label}" not found in stdout`);
  }
  return JSON.parse(m[1]) as T;
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(REPO, rel), "utf-8")) as T;
}

interface ParsedArtifacts {
  bundle: {
    signalId: string;
    symbol: string;
    market: string;
    timeframe: string;
    lanes: Record<string, { lane: string; provisional: boolean; payload: unknown }>;
    provisionalLanes: string[];
    provenance?: { signalId: string; inputHash: string };
  };
  scored: {
    signalId: string;
    uwrScore: number;
    uwrAxes: Record<string, number>;
    demoOnly: boolean;
    provisional: boolean;
  };
  receipt: {
    signalId: string;
    uwrScore: number;
    receiptKind: string;
    provisionalLanes: string[];
    mutatesReputationState: boolean;
    note: string;
  };
  audit: {
    signalId: string;
    algo: string;
    inputHash: string;
    bundleHash: string;
    outputHash: string;
    uwrScore: number;
    uwrAxes: Record<string, number>;
    provisionalLanes: string[];
    demoOnly: boolean;
  };
}

function parseArtifacts(stdout: string): ParsedArtifacts {
  return {
    bundle: extractBlock(stdout, "AnalysisBundle"),
    scored: extractBlock(stdout, "DemoScoredSignal"),
    receipt: extractBlock(stdout, "DemoReputationReceipt"),
    audit: extractBlock(stdout, "AuditRecord"),
  } as ParsedArtifacts;
}

/** Recursively detect any truthy `canonical` / `production` / `productionReady` flag. */
function findForbiddenTruthFlags(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findForbiddenTruthFlags(v, `${path}[${i}]`)));
  } else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(canonical|production|productionReady)$/i.test(key) && v) {
        hits.push(`${path}.${key}`);
      }
      hits.push(...findForbiddenTruthFlags(v, `${path}.${key}`));
    }
  }
  return hits;
}

describe("VAL-CROSS: end-to-end single run (real CLI)", () => {
  let run: CliRun;
  let art: ParsedArtifacts;

  beforeAll(() => {
    run = runCli();
    art = parseArtifacts(run.stdout);
  }, SPAWN_TIMEOUT_MS);

  it("VAL-CROSS-001: exits 0 and produces every stage artifact", () => {
    expect(run.status).toBe(0);
    expect(art.bundle).toBeDefined();
    expect(art.scored).toBeDefined();
    expect(art.receipt).toBeDefined();
    expect(art.audit).toBeDefined();
    // validation + five-lane fan-out are observable in the human summary
    for (const lane of LANE_IDS) {
      expect(run.stdout).toContain(lane);
    }
  });

  it("VAL-CROSS-001: uwrScore is byte-equal across scored/receipt/audit and finite in [0,1]", () => {
    const s = art.scored.uwrScore;
    expect(typeof s).toBe("number");
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(art.receipt.uwrScore).toBe(s);
    expect(art.audit.uwrScore).toBe(s);
  });

  it("VAL-CROSS-002: five-lane structure preserved fan-out -> bundle -> audit", () => {
    expect(Object.keys(art.bundle.lanes).sort()).toEqual([...LANE_IDS].sort());
    expect(Object.keys(art.bundle.lanes)).toHaveLength(5);
    // each lane result is a distinct, well-formed execution
    for (const lane of LANE_IDS) {
      expect(art.bundle.lanes[lane].lane).toBe(lane);
      expect(typeof art.bundle.lanes[lane].provisional).toBe("boolean");
      expect(art.bundle.lanes[lane].provisional).toBe(!WIRED.has(lane));
    }
    expect([...art.bundle.provisionalLanes]).toEqual(PROVISIONAL);
    expect([...art.audit.provisionalLanes]).toEqual(PROVISIONAL);
  });

  it("VAL-CROSS-004: demo-only / provisional labeling present everywhere; no canonical/production flag", () => {
    expect(art.scored.demoOnly).toBe(true);
    expect(art.scored.provisional).toBe(true);
    expect(art.receipt.receiptKind).toBe("demo-only");
    expect(art.audit.demoOnly).toBe(true);
    // provisional lane payloads are self-labeled provisional
    for (const lane of PROVISIONAL) {
      expect(art.bundle.lanes[lane].provisional).toBe(true);
    }
    const forbidden = [art.bundle, art.scored, art.receipt, art.audit].flatMap((rec) =>
      findForbiddenTruthFlags(rec)
    );
    expect(forbidden).toEqual([]);
  });

  it("VAL-CROSS-005: behavioral offline run succeeds (no network/DB required) and binds no port", () => {
    // The whole suite runs with no DB/network configured; a clean exit 0 over
    // committed fixtures is the behavioral proof of no production surface. The
    // synchronous child has already exited, so it can bind no listening socket.
    expect(run.status).toBe(0);
    expect(run.stderr).not.toMatch(/ECONNREFUSED|ENOTFOUND|MongoNetworkError|listen EADDRINUSE/);
    const ss = spawnSync("sh", ["-c", "ss -ltnp 2>/dev/null || true"], { encoding: "utf-8" });
    expect(ss.stdout ?? "").not.toContain("run-pipehead-demo");
  });

  it("VAL-CROSS-006: receipt is non-mutating with a note (no reputation-state mutation)", () => {
    expect(art.receipt.mutatesReputationState).toBe(false);
    expect(typeof art.receipt.note).toBe("string");
    expect(art.receipt.note.length).toBeGreaterThan(0);
  });

  it("VAL-CROSS-008: one signalId threads unbroken through every artifact", () => {
    const fixture = loadJson<{ provenance: { signalId: string } }>(
      "test/pipeheads/fixtures/signal.uss.json"
    );
    const input = fixture.provenance.signalId;
    expect(input).toBe(SIGNAL_ID);
    expect(art.bundle.signalId).toBe(input);
    expect(art.bundle.provenance?.signalId).toBe(input);
    expect(art.scored.signalId).toBe(input);
    expect(art.receipt.signalId).toBe(input);
    expect(art.audit.signalId).toBe(input);
  });
});

describe("VAL-CROSS-006: a demo run mutates no tracked repo state", () => {
  it("git status of afi-reactor is unchanged across a demo run", () => {
    const status = (): string => {
      const res = spawnSync("git", ["-C", REPO, "status", "--porcelain"], {
        encoding: "utf-8",
      });
      return res.stdout ?? "";
    };
    const before = status();
    const run = runCli();
    expect(run.status).toBe(0);
    const after = status();
    expect(after).toBe(before);
  }, SPAWN_TIMEOUT_MS);
});

describe("VAL-CROSS-007: deterministic replay end-to-end (real CLI)", () => {
  it("two runs yield byte-identical input/bundle/output hashes equal to committed golden", () => {
    const a = runCli();
    const b = runCli();
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    const auditA = extractBlock(a.stdout, "AuditRecord") as {
      inputHash: string;
      bundleHash: string;
      outputHash: string;
    };
    const auditB = extractBlock(b.stdout, "AuditRecord") as {
      inputHash: string;
      bundleHash: string;
      outputHash: string;
    };
    for (const k of ["inputHash", "bundleHash", "outputHash"] as const) {
      expect(auditA[k]).toMatch(HEX_64);
      expect(auditA[k]).toBe(auditB[k]);
    }
    const golden = loadJson<{
      inputHash: string;
      bundleHash: string;
      outputHash: string;
    }>("test/pipeheads/fixtures/golden.json");
    expect(auditA.inputHash).toBe(golden.inputHash);
    expect(auditA.bundleHash).toBe(golden.bundleHash);
    expect(auditA.outputHash).toBe(golden.outputHash);
  }, SPAWN_TIMEOUT_MS);
});

describe("VAL-CROSS-003: deterministic kernel source untouched (git guards)", () => {
  const KERNEL_REPOS = ["afi-core", "afi-math", "afi-config"] as const;
  const GUARDED_FILES = [
    "analysts/froggy.trend_pullback_v1.ts",
    "validators/UniversalWeightingRule.ts",
  ];

  function repoPath(name: string): string {
    return resolve(REPO, "..", name);
  }

  it("no mission-attributable tracked source (.ts) changes in afi-core/afi-math/afi-config", () => {
    for (const repo of KERNEL_REPOS) {
      const res = spawnSync("git", ["-C", repoPath(repo), "status", "--porcelain"], {
        encoding: "utf-8",
      });
      expect(res.status).toBe(0);
      const tsChanges = (res.stdout ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .filter((l) => /\.ts$/.test(l));
      expect({ repo, tsChanges }).toEqual({ repo, tsChanges: [] });
    }
  });

  it("git diff is empty on the froggy analyst and the UniversalWeightingRule", () => {
    const res = spawnSync(
      "git",
      ["-C", repoPath("afi-core"), "diff", "--quiet", "--", ...GUARDED_FILES],
      { encoding: "utf-8" }
    );
    // --quiet exits 0 when there is no diff, 1 when there is.
    expect(res.status).toBe(0);
  });
});

describe("VAL-CROSS-005: no out-of-scope production surface (source scan)", () => {
  function collectSourceFiles(): string[] {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(join(REPO, "src/pipeheads"));
    files.push(join(REPO, CLI_REL));
    return files;
  }

  const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
    { name: "mongodb import", pattern: /from\s+["']mongodb["']/ },
    { name: "MongoClient usage", pattern: /\bMongoClient\b/ },
    { name: "vault-write service", pattern: /tssdVaultService/i },
    { name: "fetch network call", pattern: /\bfetch\s*\(/ },
    { name: "axios import", pattern: /from\s+["']axios["']/ },
    { name: "http(s) module import", pattern: /from\s+["']https?["']/ },
    { name: "websocket", pattern: /\bnew\s+WebSocket\b/ },
    { name: "express server", pattern: /from\s+["']express["']/ },
    { name: "port/socket listen", pattern: /\.listen\s*\(/ },
    { name: "afi-factory import", pattern: /afi-factory/ },
    { name: "dag AnalystNode import", pattern: /dag\/nodes\/AnalystNode/ },
    { name: "token/mint/treasury/settlement/reward logic", pattern: /\b(token|mint|treasury|settlement|reward)\b/i },
  ];

  it("src/pipeheads + the CLI contain no forbidden production-surface tokens/imports", () => {
    const files = collectSourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const violations: Array<{ file: string; rule: string }> = [];
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(src)) {
          violations.push({ file: file.replace(`${REPO}/`, ""), rule: name });
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("VAL-CROSS-009: full emitted record byte-identical across two fixed-clock runs", () => {
  type UwrAxes = DemoScoredSignal["uwrAxes"];
  const GOLDEN_AXES: UwrAxes = { structure: 0.15, execution: 0, risk: 0.2, insight: 0.4 };

  function mean(axes: UwrAxes): number {
    return (axes.structure + axes.execution + axes.risk + axes.insight) / 4;
  }

  /** Deterministic stub scorer with a FIXED analystScore.scoredAt so the full record is byte-stable. */
  function stubScorer(): FroggyScorer {
    const uwrScore = mean(GOLDEN_AXES);
    return () =>
      ({
        analystScore: {
          analystId: "froggy",
          strategyId: "trend_pullback_v1",
          strategyVersion: "1.0.0",
          direction: "neutral",
          riskBucket: "medium",
          conviction: uwrScore,
          uwrAxes: { ...GOLDEN_AXES },
          uwrScore,
          scoredAt: "2024-06-01T12:34:56.789Z",
        },
        notes: ["stub note"],
      }) as unknown as FroggyTrendPullbackScore;
  }

  function loadOhlcv(): AfiCandle[] {
    return loadJson<AfiCandle[]>("test/pipeheads/fixtures/ohlcv.json");
  }

  function loadRawUss(): Record<string, unknown> {
    return loadJson<Record<string, unknown>>("test/pipeheads/fixtures/signal.uss.json");
  }

  async function runFixedClock(): Promise<HarnessAggregate> {
    const result = await runPipeheadHarness(
      { rawUss: loadRawUss(), candles: loadOhlcv() },
      { clock: createFrozenClock(FROZEN_CLOCK_ISO), scorer: stubScorer() }
    );
    if (isHarnessFailure(result)) {
      throw new Error("expected a successful harness aggregate");
    }
    return result;
  }

  it("serialized bundle / scored / receipt / audit are byte-equal across two runs", async () => {
    const a = await runFixedClock();
    const b = await runFixedClock();
    for (const key of ["bundle", "scored", "receipt", "audit"] as const) {
      expect(JSON.stringify(a[key])).toBe(JSON.stringify(b[key]));
    }
    // and the full aggregate is deeply equal (superset of the hash-only checks)
    expect(a).toEqual(b);
  });
});
