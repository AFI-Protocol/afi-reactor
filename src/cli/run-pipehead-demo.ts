/**
 * CLI demo entrypoint for the AFI Signal Evaluation Pipehead System
 * (non-production POC). A THIN wrapper over {@link runPipeheadHarness}: it loads
 * a committed USS v1.1 fixture + its OHLCV, runs the full DAG once
 * (validate -> fan-out -> normalize -> score -> receipt -> audit), and prints
 * FOUR clearly-labeled, independently-JSON-parseable blocks to stdout:
 *
 *   - AnalysisBundle        (normalized five-lane bundle + provenance)
 *   - DemoScoredSignal      (deterministic afi-core score, demo-only/provisional)
 *   - DemoReputationReceipt (demo-only, non-mutating receipt)
 *   - AuditRecord           (content-hashed sha256 inputHash/bundleHash/outputHash)
 *
 * It runs fully OFFLINE: no servers, no listening port, no outbound network, no
 * DB/vault writes. Because the harness is pure and starts no timers/sockets,
 * the process self-terminates and leaves no orphan.
 *
 * Exit codes (VAL-CLI-001 / VAL-CLI-010):
 *   0  success over a valid fixture
 *   2  the fixture failed canonical USS v1.1 schema validation (structured
 *      error, no downstream artifacts emitted)
 *   1  any other failure (e.g. a fixture file is missing/unparseable) surfaced
 *      as a STRUCTURED error block, never an uncaught stack trace.
 *
 * Determinism: the default FROZEN clock is used and timestamps are excluded from
 * every content hash, so two runs print an identical `outputHash`.
 *
 * Run via `node --loader ts-node/esm src/cli/run-pipehead-demo.ts` to exercise
 * REAL ESM resolution (and the REAL afi-core scorer, whose value subpath only
 * resolves under the node ESM loader). Optional flags:
 *   --uss   <path>   override the USS v1.1 fixture (default committed fixture)
 *   --ohlcv <path>   override the OHLCV fixture (default committed fixture)
 *
 * ESM: relative imports use `.js`; afi-core is reached only transitively via the
 * harness (the scorer is bound there by package name).
 */

import { readFileSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import type { AfiCandle } from "../types/AfiCandle.js";
import {
  ANALYSIS_LANE_IDS,
  isHarnessFailure,
  runPipeheadHarness,
  type AnalysisBundle,
} from "../pipeheads/index.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..", "..");
const DEFAULT_USS = join(REPO_ROOT, "test/pipeheads/fixtures/signal.uss.json");
const DEFAULT_OHLCV = join(REPO_ROOT, "test/pipeheads/fixtures/ohlcv.json");

interface CliArgs {
  ussPath: string;
  ohlcvPath: string;
}

function resolveInputPath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function parseArgs(argv: string[]): CliArgs {
  let ussPath = DEFAULT_USS;
  let ohlcvPath = DEFAULT_OHLCV;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--uss") {
      ussPath = resolveInputPath(argv[(i += 1)] ?? "");
    } else if (arg === "--ohlcv") {
      ohlcvPath = resolveInputPath(argv[(i += 1)] ?? "");
    }
  }
  return { ussPath, ohlcvPath };
}

function readJsonFile<T>(path: string): T {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`could not read fixture file: ${path}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`fixture file is not valid JSON: ${path}`);
  }
}

/** Emit one clearly-labeled, independently-JSON-parseable stdout block. */
function emitBlock(label: string, value: unknown): void {
  process.stdout.write(`===== BEGIN ${label} (application/json) =====\n`);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`===== END ${label} =====\n\n`);
}

/** Emit a structured error block (never a raw stack trace). */
function emitError(error: { stage: string; errors: Array<{ field: string; message: string }>; message: string }): void {
  const body = { ok: false as const, ...error };
  process.stderr.write(`===== BEGIN DemoError (application/json) =====\n`);
  process.stderr.write(`${JSON.stringify(body, null, 2)}\n`);
  process.stderr.write(`===== END DemoError =====\n`);
}

/** Human-readable five-lane summary (wired vs provisional), printed before the JSON blocks. */
function printLaneSummary(bundle: AnalysisBundle): void {
  process.stdout.write("AFI Pipehead Demo (non-production POC; all outputs demo-only)\n");
  process.stdout.write(`Signal: ${bundle.signalId}  ${bundle.symbol} ${bundle.market} ${bundle.timeframe}\n`);
  process.stdout.write(`Analysis lanes (${ANALYSIS_LANE_IDS.length}):\n`);
  for (const lane of ANALYSIS_LANE_IDS) {
    const result = bundle.lanes[lane];
    const label = result.provisional ? "PROVISIONAL" : "WIRED";
    process.stdout.write(`  - ${lane} [${label}]\n`);
  }
  process.stdout.write("\n");
}

async function main(): Promise<number> {
  const { ussPath, ohlcvPath } = parseArgs(process.argv.slice(2));
  const rawUss = readJsonFile<unknown>(ussPath);
  const candles = readJsonFile<AfiCandle[]>(ohlcvPath);

  const result = await runPipeheadHarness({ rawUss, candles });

  if (isHarnessFailure(result)) {
    emitError({
      stage: result.stage,
      errors: result.errors,
      message: "Signal failed canonical USS v1.1 validation; pipeline halted before scoring/audit.",
    });
    return 2;
  }

  printLaneSummary(result.bundle);
  emitBlock("AnalysisBundle", result.bundle);
  emitBlock("DemoScoredSignal", result.scored);
  emitBlock("DemoReputationReceipt", result.receipt);
  emitBlock("AuditRecord", result.audit);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    emitError({
      stage: "demo",
      errors: [{ field: "(demo)", message: err instanceof Error ? err.message : String(err) }],
      message: "Demo failed before completion.",
    });
    process.exitCode = 1;
  });
