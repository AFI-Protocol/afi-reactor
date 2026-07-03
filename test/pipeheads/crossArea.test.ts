/**
 * Cross-area / end-to-end guarantees for the AFI Signal Evaluation Pipehead
 * System (District 2 M2 D2-native surface). Covers VAL-CROSS-001..009 plus the
 * D2 boundary guarantees:
 *
 *  - the outward surface is D2-native (envelope / scored signal / provenance
 *    record / replay profile) and NO retired POC shape is emitted;
 *  - two real-CLI runs replay byte-identically and match the committed golden
 *    hash pins (afi.hash.v1);
 *  - scoring values are BYTE-IDENTICAL to the pre-D2 goldens (uwrScore 0.1875,
 *    axes 0.15/0/0.2/0.4) — the mission changed the artifact surface, never
 *    the scoring math;
 *  - kernel repos are untouched and no out-of-scope production surface exists;
 *  - reference-implementation language boundary: nothing describes this
 *    pipeline or its normalization as the canonical/official/required AFI
 *    pipeline (negated self-labels like "not the canonical AFI pipeline" are
 *    the REQUIRED language and are excluded before scanning).
 *
 * Most assertions are black-box over the REAL CLI demo (spawned via
 * `node --loader ts-node/esm`, so the genuine afi-core scorer runs
 * end-to-end). VAL-CROSS-009 proves the FULL aggregate byte-identical across
 * two fixed-clock harness runs with a deterministic stub scorer.
 *
 * ESM: relative imports use `.js`.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { spawnSync, type SpawnSyncReturns } from "child_process";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type { FroggyTrendPullbackScore } from "afi-core/analysts/froggy.trend_pullback_v1.js";
import type { InternalScoringResult } from "../../src/pipeheads/types.js";
import { createFrozenClock, FROZEN_CLOCK_ISO } from "../../src/pipeheads/clock.js";
import {
  runPipeheadHarness,
  isHarnessFailure,
  type HarnessAggregate,
} from "../../src/pipeheads/harness.js";
import type { FroggyScorer } from "../../src/pipeheads/scoringPipehead.js";
import { findForbiddenArtifactKeys } from "../../src/pipeheads/provenance/builders.js";

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
  envelope: {
    schema: string;
    signalId: string;
    strategyViewType: string;
    strategyLocalView: Record<string, unknown>;
    strategyLocalViewHash: { domainTag: string; value: string };
    evidenceRefs: Array<{ evidenceId: string; sourceRef: string; evidenceHash: { value: string } }>;
    sourceDisclosureProfiles: Array<{ sourceId: string; disclosureLevel: string }>;
    enrichmentProvenance: Array<{
      laneId: string;
      provisional: boolean;
      status: string;
      laneOutputHash?: { value: string };
    }>;
    replayProfileRef: string;
  };
  scoredSignal: {
    schema: string;
    signalId: string;
    analystId: string;
    strategyId: string;
    direction: string;
    riskBucket: string;
    conviction: number;
    uwrScore: number;
    uwrAxes: Record<string, number>;
    provenanceRecordRef: string;
  };
  provenanceRecord: {
    schema: string;
    signalId: string;
    canonicalizationVersion: string;
    inputHash: { domainTag: string; value: string };
    enrichmentHash: { domainTag: string; value: string };
    outputHash: { domainTag: string; value: string };
    replayProfileRef: string;
    notes: string;
  };
  replayProfile: {
    schema: string;
    replayabilityLevel: string;
    factsRequired: boolean;
    laneVersions: Record<string, string>;
  };
}

function parseArtifacts(stdout: string): ParsedArtifacts {
  return {
    envelope: extractBlock(stdout, "AnalystInputEnvelope"),
    scoredSignal: extractBlock(stdout, "ScoredSignal"),
    provenanceRecord: extractBlock(stdout, "ProvenanceRecord"),
    replayProfile: extractBlock(stdout, "ReplayProfile"),
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

  it("VAL-CROSS-001: exits 0 and produces every D2 artifact", () => {
    expect(run.status).toBe(0);
    expect(art.envelope).toBeDefined();
    expect(art.scoredSignal).toBeDefined();
    expect(art.provenanceRecord).toBeDefined();
    expect(art.replayProfile).toBeDefined();
    // validation + five-lane fan-out are observable in the human summary
    for (const lane of LANE_IDS) {
      expect(run.stdout).toContain(lane);
    }
  });

  it("VAL-CROSS-001: uwrScore is finite in [0,1] and consistent with its axes", () => {
    const s = art.scoredSignal.uwrScore;
    expect(typeof s).toBe("number");
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    const axes = art.scoredSignal.uwrAxes;
    const mean =
      (axes.structure + axes.execution + axes.risk + axes.insight) / 4;
    expect(Math.abs(mean - s)).toBeLessThan(1e-12);
  });

  it("VAL-CROSS-002: five-lane structure preserved fan-out -> envelope enrichment provenance", () => {
    const lanes = art.envelope.enrichmentProvenance;
    expect(lanes.map((l) => l.laneId)).toEqual([...LANE_IDS]);
    expect(lanes).toHaveLength(5);
    for (const lane of lanes) {
      expect(typeof lane.provisional).toBe("boolean");
      expect(lane.provisional).toBe(!WIRED.has(lane.laneId));
      expect(lane.laneOutputHash?.value).toMatch(HEX_64);
    }
    expect(lanes.filter((l) => l.provisional).map((l) => l.laneId)).toEqual(PROVISIONAL);
  });

  it("VAL-CROSS-004: no canonical/production truth flag and no forbidden key in any artifact", () => {
    const artifacts = [art.envelope, art.scoredSignal, art.provenanceRecord, art.replayProfile];
    const truthFlags = artifacts.flatMap((rec) => findForbiddenTruthFlags(rec));
    expect(truthFlags).toEqual([]);
    for (const artifact of artifacts) {
      expect(findForbiddenArtifactKeys(artifact)).toEqual([]);
    }
    // the provenance record self-labels the run as a reference implementation
    expect(art.provenanceRecord.notes).toContain("Reference implementation");
    expect(run.stdout).toContain("reference implementation");
  });

  it("VAL-CROSS-005: behavioral offline run succeeds (no network/DB required) and binds no port", () => {
    expect(run.status).toBe(0);
    expect(run.stderr).not.toMatch(/ECONNREFUSED|ENOTFOUND|MongoNetworkError|listen EADDRINUSE/);
    const ss = spawnSync("sh", ["-c", "ss -ltnp 2>/dev/null || true"], { encoding: "utf-8" });
    expect(ss.stdout ?? "").not.toContain("run-pipehead-demo");
  });

  it("VAL-CROSS-008: one signalId threads unbroken through every artifact", () => {
    const fixture = loadJson<{ provenance: { signalId: string } }>(
      "test/pipeheads/fixtures/signal.uss.json"
    );
    const input = fixture.provenance.signalId;
    expect(input).toBe(SIGNAL_ID);
    expect(art.envelope.signalId).toBe(input);
    expect(art.scoredSignal.signalId).toBe(input);
    expect(art.provenanceRecord.signalId).toBe(input);
    expect(art.scoredSignal.provenanceRecordRef).toBe(`provenance-record:${input}`);
    expect(art.provenanceRecord.replayProfileRef).toBe(`replay-profile:${input}`);
    expect(art.envelope.replayProfileRef).toBe(`replay-profile:${input}`);
  });

  it("D2 boundary: no ScoredSignal <-> ProvenanceRecord hash cycle in the emitted artifacts", () => {
    // The ScoredSignal carries only the deterministic id-derived ref — no
    // digest of the record; the record's outputHash commits one-directionally.
    expect(art.scoredSignal.provenanceRecordRef).toBe(`provenance-record:${SIGNAL_ID}`);
    expect(
      (art.scoredSignal as unknown as Record<string, unknown>).provenanceRecordHash
    ).toBeUndefined();
    expect(
      (art.scoredSignal as unknown as Record<string, unknown>).outputHash
    ).toBeUndefined();
    expect(art.provenanceRecord.outputHash.value).toMatch(HEX_64);
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

describe("VAL-CROSS-007: deterministic replay end-to-end (real CLI, golden pins)", () => {
  it("two runs yield byte-identical digests equal to the committed golden, with UNCHANGED scoring values", () => {
    const a = runCli();
    const b = runCli();
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    const artA = parseArtifacts(a.stdout);
    const artB = parseArtifacts(b.stdout);

    // hash-level replay across runs
    expect(artA.provenanceRecord.inputHash.value).toBe(artB.provenanceRecord.inputHash.value);
    expect(artA.provenanceRecord.enrichmentHash.value).toBe(artB.provenanceRecord.enrichmentHash.value);
    expect(artA.provenanceRecord.outputHash.value).toBe(artB.provenanceRecord.outputHash.value);
    expect(artA.envelope.strategyLocalViewHash.value).toBe(artB.envelope.strategyLocalViewHash.value);

    const golden = loadJson<{
      inputHash: string;
      enrichmentHash: string;
      outputHash: string;
      strategyLocalViewHash: string;
      uwrScore: number;
      uwrAxes: Record<string, number>;
      direction: string;
      riskBucket: string;
      conviction: number;
      analystId: string;
      strategyId: string;
    }>("test/pipeheads/fixtures/golden.json");

    // golden afi.hash.v1 pins
    expect(artA.provenanceRecord.inputHash.value).toBe(golden.inputHash);
    expect(artA.provenanceRecord.enrichmentHash.value).toBe(golden.enrichmentHash);
    expect(artA.provenanceRecord.outputHash.value).toBe(golden.outputHash);
    expect(artA.envelope.strategyLocalViewHash.value).toBe(golden.strategyLocalViewHash);

    // scoring values BYTE-IDENTICAL to the pre-D2 goldens (no scoring change)
    expect(artA.scoredSignal.uwrScore).toBe(golden.uwrScore);
    expect(artA.scoredSignal.uwrScore).toBe(0.1875);
    expect(artA.scoredSignal.uwrAxes).toEqual(golden.uwrAxes);
    expect(artA.scoredSignal.uwrAxes).toEqual({
      structure: 0.15,
      execution: 0,
      risk: 0.2,
      insight: 0.4,
    });
    expect(artA.scoredSignal.direction).toBe(golden.direction);
    expect(artA.scoredSignal.riskBucket).toBe(golden.riskBucket);
    expect(artA.scoredSignal.conviction).toBe(golden.conviction);
    expect(artA.scoredSignal.analystId).toBe(golden.analystId);
    expect(artA.scoredSignal.strategyId).toBe(golden.strategyId);
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

function collectPipeheadSourceFiles(): string[] {
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

describe("VAL-CROSS-005: no out-of-scope production surface (source scan)", () => {
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
    // keccak/on-chain hashing USAGE (imports or calls); doctrine comments may
    // name keccak256 only to state it is excluded.
    { name: "keccak import/usage", pattern: /keccak[0-9a-z-]*\s*\(|from\s+["'][^"']*keccak|["']js-sha3["']/i },
    { name: "L1 anchoring", pattern: /\banchor(ing)?\b/i },
  ];

  it("src/pipeheads + the CLI contain no forbidden production-surface tokens/imports", () => {
    const files = collectPipeheadSourceFiles();
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

describe("D2 boundary: reference-implementation language (no canonical-pipeline claims)", () => {
  /**
   * Negated self-labels ("not the canonical AFI pipeline", "never the
   * canonical AFI pipeline") are the REQUIRED language — strip them before
   * scanning so only positive canonical-status claims are flagged. Text is
   * whitespace-normalized first (markdown wraps phrases across quoted lines).
   */
  function stripNegatedSelfLabels(text: string): string {
    return text
      .replace(/^\s*>\s?/gm, "") // markdown blockquote prefixes
      .replace(/[*_`]/g, "") // markdown emphasis
      .replace(/\s+/g, " ") // collapse line wraps
      .replace(/(not|never)( presented as)? the canonical afi pipeline/gi, "");
  }

  const BANNED_PHRASES = [
    /canonical afi pipeline/i,
    /official afi pipeline/i,
    /required pipeline/i,
    /standard analyst workflow/i,
    /canonical normalization/i,
    /canonical ingestion/i,
  ];

  it("no pipehead source, CLI, or pipehead docs claim canonical-pipeline status", () => {
    const files = [
      ...collectPipeheadSourceFiles(),
      join(REPO, "docs/PIPEHEAD_SYSTEM.md"),
      join(REPO, "README.md"),
    ];
    const violations: Array<{ file: string; phrase: string }> = [];
    for (const file of files) {
      const text = stripNegatedSelfLabels(readFileSync(file, "utf-8"));
      for (const phrase of BANNED_PHRASES) {
        if (phrase.test(text)) {
          violations.push({ file: file.replace(`${REPO}/`, ""), phrase: phrase.source });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the normalize pipehead self-describes as a reference adapter/profile (USS compatibility is canonical; the method is not)", () => {
    const src = readFileSync(join(REPO, "src/pipeheads/normalizePipehead.ts"), "utf-8");
    expect(src).toMatch(/REFERENCE ADAPTER/i);
    expect(src).toMatch(/USS v1\.1 COMPATIBILITY is the\s+\* canonical requirement/i);
    expect(src).toMatch(/implementation-profile/i);
  });
});

describe("VAL-CROSS-009: full emitted record byte-identical across two fixed-clock runs", () => {
  type UwrAxes = InternalScoringResult["uwrAxes"];
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

  it("serialized envelope / scoredSignal / provenanceRecord / replayProfile are byte-equal across two runs", async () => {
    const a = await runFixedClock();
    const b = await runFixedClock();
    for (const key of ["envelope", "scoredSignal", "provenanceRecord", "replayProfile"] as const) {
      expect(JSON.stringify(a[key])).toBe(JSON.stringify(b[key]));
    }
    // and the whole aggregate (internal intermediates included) is deeply equal
    expect(a).toEqual(b);
  });
});
