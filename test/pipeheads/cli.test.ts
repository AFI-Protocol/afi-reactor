/**
 * CLI demo tests (m2-cli-demo) — black-box verification of the demo entrypoint
 * `src/cli/run-pipehead-demo.ts`, covering VAL-CLI-001..010.
 *
 * These tests SPAWN the real CLI via `node --loader ts-node/esm` (the same ESM
 * resolution path a validator uses), so the REAL afi-core scorer runs in the
 * child process — Jest itself never imports the afi-core `./analysts/*` value
 * subpath (which its resolver cannot load). Each test parses the four labeled,
 * independently-JSON-parseable stdout blocks, asserts exit codes, proves the
 * `outputHash` is identical across two runs, and confirms no orphaned process
 * remains after the (synchronous) child exits.
 *
 * ESM: relative imports use `.js`.
 */

import { describe, it, expect, beforeAll } from "@jest/globals";
import { spawn, spawnSync, type SpawnSyncReturns } from "child_process";

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
const WIRED = new Set(["technical-indicators", "pattern-recognition"]);
const SPAWN_TIMEOUT_MS = 120_000;

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run the CLI in a child process via the real ESM loader. Networking is not
 * disabled at the OS level here (offline mission has no network anyway); the
 * point is to prove the demo needs none.
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
    const bundle = extractBlock(run.stdout, "AnalysisBundle") as {
      lanes: Record<string, { provisional: boolean }>;
    };
    for (const lane of LANE_IDS) {
      const expected = !WIRED.has(lane);
      expect(bundle.lanes[lane].provisional).toBe(expected);
    }
    // The human-readable lane summary also marks them.
    expect(run.stdout).toMatch(/news\s+\[PROVISIONAL\]/);
    expect(run.stdout).toMatch(/social\s+\[PROVISIONAL\]/);
    expect(run.stdout).toMatch(/ai-ml\s+\[PROVISIONAL\]/);
    expect(run.stdout).toMatch(/technical-indicators\s+\[WIRED\]/);
    expect(run.stdout).toMatch(/pattern-recognition\s+\[WIRED\]/);
  });

  it("VAL-CLI-004: prints the normalized AnalysisBundle (identity + five lanes + provisionalLanes)", () => {
    const bundle = extractBlock(run.stdout, "AnalysisBundle") as {
      symbol: string;
      market: string;
      timeframe: string;
      lanes: Record<string, unknown>;
      provisionalLanes: string[];
    };
    expect(bundle.symbol).toBe("BTC/USDT");
    expect(bundle.market).toBe("perp");
    expect(bundle.timeframe).toBe("4h");
    expect(Object.keys(bundle.lanes).sort()).toEqual([...LANE_IDS].sort());
    expect([...bundle.provisionalLanes].sort()).toEqual(["ai-ml", "news", "social"]);
  });

  it("VAL-CLI-005: prints the deterministic scored output labeled demo-only", () => {
    const scored = extractBlock(run.stdout, "DemoScoredSignal") as {
      uwrScore: number;
      uwrAxes: { structure: number; execution: number; risk: number; insight: number };
      demoOnly: boolean;
      provisional: boolean;
    };
    expect(typeof scored.uwrScore).toBe("number");
    expect(scored.uwrScore).toBeGreaterThanOrEqual(0);
    expect(scored.uwrScore).toBeLessThanOrEqual(1);
    for (const axis of ["structure", "execution", "risk", "insight"] as const) {
      expect(typeof scored.uwrAxes[axis]).toBe("number");
    }
    expect(scored.demoOnly).toBe(true);
    expect(scored.provisional).toBe(true);
  });

  it("prints a demo-only reputation receipt (non-mutating)", () => {
    const receipt = extractBlock(run.stdout, "DemoReputationReceipt") as {
      receiptKind: string;
      mutatesReputationState: boolean;
      note: string;
    };
    expect(receipt.receiptKind).toBe("demo-only");
    expect(receipt.mutatesReputationState).toBe(false);
    expect(receipt.note.length).toBeGreaterThan(0);
  });

  it("VAL-CLI-006: prints the content-hashed AuditRecord with outputHash", () => {
    const audit = extractBlock(run.stdout, "AuditRecord") as {
      algo: string;
      inputHash: string;
      bundleHash: string;
      outputHash: string;
    };
    expect(audit.algo).toBe("sha256");
    expect(audit.inputHash).toMatch(HEX_64);
    expect(audit.bundleHash).toMatch(HEX_64);
    expect(audit.outputHash).toMatch(HEX_64);
  });

  it("VAL-CLI-009: all four labeled blocks are individually JSON-parseable", () => {
    const labels = [
      "AnalysisBundle",
      "DemoScoredSignal",
      "DemoReputationReceipt",
      "AuditRecord",
    ];
    for (const label of labels) {
      expect(() => extractBlock(run.stdout, label)).not.toThrow();
    }
  });

  it("cross-stage uwrScore is consistent across scored/receipt/audit", () => {
    const scored = extractBlock(run.stdout, "DemoScoredSignal") as { uwrScore: number };
    const receipt = extractBlock(run.stdout, "DemoReputationReceipt") as { uwrScore: number };
    const audit = extractBlock(run.stdout, "AuditRecord") as { uwrScore: number };
    expect(receipt.uwrScore).toBe(scored.uwrScore);
    expect(audit.uwrScore).toBe(scored.uwrScore);
  });
});

describe("CLI demo — determinism (VAL-CLI-007)", () => {
  it("two runs print an identical outputHash", () => {
    const a = runCli();
    const b = runCli();
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    const ha = extractBlock(a.stdout, "AuditRecord") as { outputHash: string };
    const hb = extractBlock(b.stdout, "AuditRecord") as { outputHash: string };
    expect(ha.outputHash).toMatch(HEX_64);
    expect(ha.outputHash).toBe(hb.outputHash);
  }, SPAWN_TIMEOUT_MS);
});

describe("CLI demo — exit-code semantics & structured errors (VAL-CLI-010)", () => {
  it("a deliberately-invalid fixture exits non-zero with a structured error (no stack-trace crash)", () => {
    const run = runCli(["--uss", "test/pipeheads/fixtures/signal.invalid.uss.json"]);
    expect(run.status).not.toBe(0);
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
    expect(run.stdout).not.toContain("BEGIN AnalysisBundle");
    expect(run.stdout).not.toContain("BEGIN DemoScoredSignal");
    expect(run.stdout).not.toContain("BEGIN AuditRecord");
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
 * jest workers when a sibling suite (e.g. the determinism suite below) spawns
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
