/**
 * CLI demo tests (District 2 M2 surface) — black-box verification of the demo
 * entrypoint `src/cli/run-pipehead-demo.ts`, covering VAL-CLI-001..010 over
 * the D2-native artifact blocks.
 *
 * These tests SPAWN the real CLI via `node --loader ts-node/esm` (the same ESM
 * resolution path a validator uses), so the REAL afi-core scorer runs in the
 * child process — Jest itself never imports the afi-core `./analysts/*` value
 * subpath (which its resolver cannot load). Each test parses the four labeled,
 * independently-JSON-parseable stdout blocks (AnalystInputEnvelope,
 * ScoredSignal, ProvenanceRecord, ReplayProfile), asserts exit codes, proves
 * the artifact blocks are byte-identical across two runs, proves NO retired
 * POC block (AnalysisBundle / DemoScoredSignal / DemoReputationReceipt /
 * AuditRecord) is emitted, and confirms no orphaned process remains after the
 * (synchronous) child exits.
 *
 * ESM: relative imports use `.js`.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { spawn, spawnSync, type SpawnSyncReturns } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const CLI_REL = "src/cli/run-pipehead-demo.ts";
const REPO = process.cwd();
const HEX_64 = /^[0-9a-f]{64}$/;
const LANE_IDS = [
  "technical-indicators",
  "pattern-recognition",
  "news",
  "social",
  "ai-ml",
] as const;
const SPAWN_TIMEOUT_MS = 120_000;

/** The four D2-native outward blocks. */
const D2_BLOCK_LABELS = [
  "AnalystInputEnvelope",
  "ScoredSignal",
  "ProvenanceRecord",
  "ReplayProfile",
] as const;

/** Retired POC block labels that must NEVER appear again. */
const RETIRED_BLOCK_LABELS = [
  "AnalysisBundle",
  "DemoScoredSignal",
  "DemoReputationReceipt",
  "AuditRecord",
] as const;

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run the CLI in a child process via the real ESM loader. Networking is not
 * disabled at the OS level here; the point is to prove the demo needs none.
 */
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

/** Extract a single labeled block body and JSON.parse it INDEPENDENTLY. */
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

function loadGolden(): {
  uwrScore: number;
  uwrAxes: Record<string, number>;
  direction: string;
  riskBucket: string;
  conviction: number;
  inputHash: string;
  enrichmentHash: string;
  outputHash: string;
  strategyLocalViewHash: string;
} {
  return JSON.parse(
    readFileSync(join(REPO, "test/pipeheads/fixtures/golden.json"), "utf-8")
  );
}

describe("CLI demo — valid fixture (VAL-CLI-001..009)", () => {
  let run: CliRun;

  beforeAll(() => {
    run = runCli();
  }, SPAWN_TIMEOUT_MS);

  it("VAL-CLI-001: exits 0 over the committed valid fixture", () => {
    expect(run.status).toBe(0);
  });

  it("VAL-CLI-002: prints all five analysis lane ids", () => {
    for (const lane of LANE_IDS) {
      expect(run.stdout).toContain(lane);
    }
  });

  it("VAL-CLI-003: labels provisional lanes provisional; wired lanes not", () => {
    // The human-readable lane summary marks the split...
    expect(run.stdout).toMatch(/news\s+\[PROVISIONAL\]/);
    expect(run.stdout).toMatch(/social\s+\[PROVISIONAL\]/);
    expect(run.stdout).toMatch(/ai-ml\s+\[PROVISIONAL\]/);
    expect(run.stdout).toMatch(/technical-indicators\s+\[WIRED\]/);
    expect(run.stdout).toMatch(/pattern-recognition\s+\[WIRED\]/);
    // ...and the envelope's per-lane enrichment provenance carries it structurally.
    const envelope = extractBlock(run.stdout, "AnalystInputEnvelope") as {
      enrichmentProvenance: Array<{ laneId: string; provisional: boolean; status: string }>;
    };
    const byLane = new Map(envelope.enrichmentProvenance.map((l) => [l.laneId, l]));
    expect(byLane.get("technical-indicators")?.provisional).toBe(false);
    expect(byLane.get("pattern-recognition")?.provisional).toBe(false);
    for (const lane of ["news", "social", "ai-ml"]) {
      expect(byLane.get(lane)?.provisional).toBe(true);
      expect(byLane.get(lane)?.status).toBe("provisional");
    }
  });

  it("VAL-CLI-004: prints an AnalystInputEnvelope v1 with a declared, hash-pinned opaque view", () => {
    const envelope = extractBlock(run.stdout, "AnalystInputEnvelope") as {
      schema: string;
      signalId: string;
      strategyViewType: string;
      enrichedViewSchemaRef: string;
      strategyLocalView: Record<string, unknown>;
      strategyLocalViewHash: { domainTag: string; value: string };
      evidenceRefs: Array<{ evidenceId: string }>;
      sourceDisclosureProfiles: Array<{ sourceId: string }>;
    };
    expect(envelope.schema).toBe("afi.analyst-input-envelope.v1");
    expect(envelope.signalId).toBe("btc-usdt-perp-4h-0001");
    expect(envelope.strategyViewType).toBe("froggy-enriched-view");
    expect(typeof envelope.enrichedViewSchemaRef).toBe("string");
    expect(envelope.strategyLocalView.symbol).toBe("BTC/USDT");
    expect(envelope.strategyLocalView.market).toBe("perp");
    expect(envelope.strategyLocalView.timeframe).toBe("4h");
    expect(envelope.strategyLocalViewHash.domainTag).toBe("afi.d2.strategy-local-view");
    expect(envelope.strategyLocalViewHash.value).toBe(loadGolden().strategyLocalViewHash);
    expect(envelope.evidenceRefs.length).toBe(4);
    expect(envelope.sourceDisclosureProfiles.length).toBe(4);
  });

  it("VAL-CLI-005: prints a ScoredSignal v1 projection with the golden scoring values (unchanged scoring)", () => {
    const golden = loadGolden();
    const scored = extractBlock(run.stdout, "ScoredSignal") as {
      schema: string;
      uwrScore: number;
      uwrAxes: Record<string, number>;
      direction: string;
      riskBucket: string;
      conviction: number;
      provenanceRecordRef: string;
    };
    expect(scored.schema).toBe("afi.scored-signal.v1");
    // Byte-identical scoring values: District 2 M2 changed the artifact
    // surface, never the scoring math.
    expect(scored.uwrScore).toBe(golden.uwrScore);
    expect(scored.uwrAxes).toEqual(golden.uwrAxes);
    expect(scored.direction).toBe(golden.direction);
    expect(scored.riskBucket).toBe(golden.riskBucket);
    expect(scored.conviction).toBe(golden.conviction);
    expect(scored.provenanceRecordRef).toBe("provenance-record:btc-usdt-perp-4h-0001");
  });

  it("VAL-CLI-006: prints a ProvenanceRecord v1 with afi.hash.v1 CanonicalHash digests", () => {
    const record = extractBlock(run.stdout, "ProvenanceRecord") as {
      schema: string;
      canonicalizationVersion: string;
      inputHash: { algorithm: string; canonicalizationVersion: string; domainTag: string; value: string };
      enrichmentHash: { domainTag: string; value: string };
      outputHash: { domainTag: string; value: string };
    };
    expect(record.schema).toBe("afi.provenance-record.v1");
    expect(record.canonicalizationVersion).toBe("afi.hash.v1");
    expect(record.inputHash.algorithm).toBe("sha256");
    expect(record.inputHash.canonicalizationVersion).toBe("afi.hash.v1");
    expect(record.inputHash.domainTag).toBe("afi.d2.signal-input");
    expect(record.enrichmentHash.domainTag).toBe("afi.d2.enrichment-bundle");
    expect(record.outputHash.domainTag).toBe("afi.d2.scored-output");
    expect(record.inputHash.value).toMatch(HEX_64);
    expect(record.enrichmentHash.value).toMatch(HEX_64);
    expect(record.outputHash.value).toMatch(HEX_64);
  });

  it("prints a deterministic ReplayProfile v1 with lane and evidence pins", () => {
    const replay = extractBlock(run.stdout, "ReplayProfile") as {
      schema: string;
      replayabilityLevel: string;
      factsRequired: boolean;
      laneVersions: Record<string, string>;
      evidenceRefs: string[];
    };
    expect(replay.schema).toBe("afi.replay-profile.v1");
    expect(replay.replayabilityLevel).toBe("deterministic");
    expect(replay.factsRequired).toBe(true);
    expect(Object.keys(replay.laneVersions).sort()).toEqual([...LANE_IDS].sort());
    expect(replay.evidenceRefs.length).toBe(4);
  });

  it("VAL-CLI-009: all four D2 blocks are individually JSON-parseable", () => {
    for (const label of D2_BLOCK_LABELS) {
      expect(() => extractBlock(run.stdout, label)).not.toThrow();
    }
  });

  it("NO retired POC block is emitted as output (D2-native surface only)", () => {
    for (const label of RETIRED_BLOCK_LABELS) {
      expect(run.stdout).not.toContain(`BEGIN ${label} (`);
      expect(run.stdout).not.toContain(`END ${label} =`);
    }
    // and no retired-shape self-labels appear anywhere in the output
    expect(run.stdout).not.toContain('"demoOnly"');
    expect(run.stdout).not.toContain('"receiptKind"');
    expect(run.stdout).not.toContain('"bundleHash"');
    expect(run.stdout).not.toContain('"scoredAtExcluded"');
  });

  it("self-labels as a reference implementation, never the canonical pipeline", () => {
    expect(run.stdout).toContain("reference implementation");
    expect(run.stdout).toContain("not the canonical AFI pipeline");
  });

  it("cross-block linkage: one signalId + record ref threading", () => {
    const envelope = extractBlock(run.stdout, "AnalystInputEnvelope") as { signalId: string };
    const scored = extractBlock(run.stdout, "ScoredSignal") as {
      signalId: string;
      provenanceRecordRef: string;
    };
    const record = extractBlock(run.stdout, "ProvenanceRecord") as {
      signalId: string;
      replayProfileRef: string;
    };
    expect(envelope.signalId).toBe(scored.signalId);
    expect(record.signalId).toBe(scored.signalId);
    expect(scored.provenanceRecordRef).toBe(`provenance-record:${record.signalId}`);
    expect(record.replayProfileRef).toBe(`replay-profile:${record.signalId}`);
  });
});

describe("CLI demo — determinism (VAL-CLI-007)", () => {
  it("two runs print byte-identical D2 artifact blocks (hashes included)", () => {
    const a = runCli();
    const b = runCli();
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    for (const label of D2_BLOCK_LABELS) {
      const blockA = extractBlock(a.stdout, label);
      const blockB = extractBlock(b.stdout, label);
      expect(JSON.stringify(blockA)).toBe(JSON.stringify(blockB));
    }
    const recordA = extractBlock(a.stdout, "ProvenanceRecord") as {
      outputHash: { value: string };
    };
    expect(recordA.outputHash.value).toMatch(HEX_64);
  }, SPAWN_TIMEOUT_MS);
});

describe("CLI demo — exit-code semantics & structured errors (VAL-CLI-010)", () => {
  it("a deliberately-invalid fixture exits non-zero with a structured error (no stack-trace crash)", () => {
    const run = runCli(["--uss", "test/pipeheads/fixtures/signal.invalid.uss.json"]);
    expect(run.status).not.toBe(0);
    expect(run.status).toBe(2);
    const combined = run.stdout + run.stderr;
    // structured error block is JSON-parseable and field-level (not a raw stack)
    const err = extractBlock(combined, "DemoError") as {
      ok: boolean;
      stage: string;
      errors: Array<{ field: string; message: string }>;
    };
    expect(err.ok).toBe(false);
    expect(err.stage).toBe("validation");
    expect(Array.isArray(err.errors)).toBe(true);
    expect(err.errors.length).toBeGreaterThan(0);
    expect(err.errors.some((e) => /signalId/.test(e.field))).toBe(true);
    // no uncaught stack trace
    expect(combined).not.toMatch(/\bat\s+\w+.*\(.*:\d+:\d+\)/);
    // VAL-SCHEMA-005: no downstream artifacts emitted on failure
    for (const label of D2_BLOCK_LABELS) {
      expect(run.stdout).not.toContain(`BEGIN ${label}`);
    }
  }, SPAWN_TIMEOUT_MS);
});

interface CliWatchRun {
  status: number | null;
  pid: number | undefined;
  listenersForPid: string[];
  stdout: string;
  stderr: string;
}

/**
 * Spawn the CLI ASYNCHRONOUSLY and, for the whole lifetime of the spawned
 * process, poll `ss -ltnp` for any LISTENING socket owned by THIS child's PID.
 *
 * The check is scoped strictly to the PID we spawned — NEVER a global
 * `ps -ef | grep run-pipehead-demo` scan, which false-positives under parallel
 * jest workers when a sibling suite (e.g. the determinism suite above) spawns
 * the same CLI concurrently.
 */
function runCliWithListenerWatch(): Promise<CliWatchRun> {
  return new Promise<CliWatchRun>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--loader", "ts-node/esm", CLI_REL],
      { cwd: REPO, env: { ...process.env, NODE_NO_WARNINGS: "1" } }
    );
    const pid = child.pid;
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

    const listenersForPid = new Set<string>();
    const sample = (): void => {
      if (pid === undefined) return;
      const ss = spawnSync("ss", ["-ltnp"], { encoding: "utf-8" });
      for (const line of (ss.stdout ?? "").split("\n")) {
        if (line.includes(`pid=${pid},`) || line.includes(`pid=${pid})`)) {
          listenersForPid.add(line.trim());
        }
      }
    };
    const timer = setInterval(sample, 30);
    child.on("error", (err) => {
      clearInterval(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearInterval(timer);
      sample(); // one final sample after exit
      resolve({ status: code, pid, listenersForPid: [...listenersForPid], stdout, stderr });
    });
  });
}

describe("CLI demo — no servers/listeners/orphans (VAL-CLI-008)", () => {
  it("opens NO listening socket attributable to the spawned PID and self-terminates (exit 0)", async () => {
    const run = await runCliWithListenerWatch();
    // Behavioral signal: ran fully offline over committed fixtures and exited 0
    // (it neither hung waiting on a DB/network nor required a server).
    expect(run.status).toBe(0);
    expect(typeof run.pid).toBe("number");
    expect(run.pid).toBeGreaterThan(0);
    // Socket ABSENCE, scoped to the PID we spawned: no LISTEN socket was ever
    // attributed to this child across its lifetime.
    expect(run.listenersForPid).toEqual([]);
    // No lingering process: the spawned PID is gone (scoped to PID, not a name scan).
    const psPid = spawnSync("ps", ["-p", String(run.pid), "-o", "pid="], {
      encoding: "utf-8",
    });
    expect((psPid.stdout ?? "").trim()).toBe("");
  }, SPAWN_TIMEOUT_MS);
});
