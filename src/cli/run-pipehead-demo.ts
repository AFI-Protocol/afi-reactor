/**
 * CLI demo entrypoint for the AFI Signal Evaluation Pipehead System — a
 * pre-live REFERENCE IMPLEMENTATION / implementation profile with a D2-native
 * outward artifact surface. A THIN wrapper over {@link runPipeheadHarness}:
 * it loads a committed USS v1.1 fixture + its OHLCV, runs the full DAG once
 * (validate -> fan-out -> normalize -> envelope -> score -> provenance), and
 * prints FOUR clearly-labeled, independently-JSON-parseable D2 artifact
 * blocks to stdout:
 *
 *   - AnalystInputEnvelope  (AnalystInputEnvelope v1: opaque, declared,
 *                            hash-pinned strategy-local view + evidence refs,
 *                            source disclosure profiles, lane provenance)
 *   - ScoredSignal          (ScoredSignal v1 projection; afi-core scoring
 *                            values verbatim)
 *   - ProvenanceRecord      (ProvenanceRecord v1: input/enrichment/output
 *                            CanonicalHash v1 digests, afi.hash.v1)
 *   - ReplayProfile         (ReplayProfile v1: deterministic replay pins)
 *
 * The pre-D2 POC blocks (AnalysisBundle, DemoScoredSignal,
 * DemoReputationReceipt, AuditRecord) are RETIRED and no longer emitted.
 *
 * It runs fully OFFLINE: no servers, no listening port, no outbound network,
 * no DB/vault writes. Because the harness is pure and starts no
 * timers/sockets, the process self-terminates and leaves no orphan.
 *
 * Exit codes (VAL-CLI-001 / VAL-CLI-010):
 *   0  success over a valid fixture
 *   2  the fixture failed canonical USS v1.1 schema validation (structured
 *      error, no downstream artifacts emitted)
 *   1  any other failure (e.g. a fixture file is missing/unparseable, or a
 *      generated artifact failed D2 schema validation) surfaced as a
 *      STRUCTURED error block, never an uncaught stack trace.
 *
 * Determinism: the outward D2 artifacts carry no runtime timestamps, so two
 * runs print byte-identical artifact blocks (identical digests) regardless of
 * clock.
 *
 * Run via `node --loader ts-node/esm src/cli/run-pipehead-demo.ts` to exercise
 * REAL ESM resolution (and the REAL afi-core scorer, whose value subpath only
 * resolves under the node ESM loader). Optional flags:
 *   --uss   <path>   override the USS v1.1 fixture (default committed fixture)
 *   --ohlcv <path>   override the OHLCV fixture (default committed fixture)
 *
 * ESM: relative imports use `.js`; afi-core is reached only transitively via
 * the harness (the scorer is bound there by package name).
 */

import { readFileSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import type { AfiCandle } from "../types/AfiCandle.js";
import {
  isHarnessFailure,
  runPipeheadHarness,
  type HarnessAggregate,
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
function emitError(error: {
  stage: string;
  errors: Array<{ field: string; message: string }>;
  message: string;
}): void {
  const body = { ok: false as const, ...error };
  process.stderr.write(`===== BEGIN DemoError (application/json) =====\n`);
  process.stderr.write(`${JSON.stringify(body, null, 2)}\n`);
  process.stderr.write(`===== END DemoError =====\n`);
}

/** Human-readable five-lane summary (wired vs provisional), printed before the JSON blocks. */
function printLaneSummary(aggregate: HarnessAggregate): void {
  const { bundle } = aggregate.internal;
  const lanes = aggregate.envelope.enrichmentProvenance ?? [];
  process.stdout.write(
    "AFI Pipehead Demo — D2-compatible artifact surface " +
      "(reference implementation / implementation profile; not the canonical AFI pipeline)\n"
  );
  process.stdout.write(
    `Signal: ${bundle.signalId}  ${bundle.symbol} ${bundle.market} ${bundle.timeframe}\n`
  );
  process.stdout.write(`Analysis lanes (${lanes.length}):\n`);
  for (const lane of lanes) {
    const label = lane.provisional ? "PROVISIONAL" : "WIRED";
    process.stdout.write(`  - ${lane.laneId} [${label}]\n`);
  }
  process.stdout.write("\n");
}

async function main(): Promise<number> {
  const { ussPath, ohlcvPath } = parseArgs(process.argv.slice(2));
  const rawUss = readJsonFile<unknown>(ussPath);
  const candles = readJsonFile<AfiCandle[]>(ohlcvPath);

  const result = await runPipeheadHarness({ rawUss, candles });

  if (isHarnessFailure(result)) {
    if (result.stage === "validation") {
      emitError({
        stage: result.stage,
        errors: result.errors,
        message:
          "Signal failed canonical USS v1.1 validation; pipeline halted before scoring/provenance.",
      });
      return 2;
    }
    emitError({
      stage: result.stage,
      errors: result.errors.map((e) => ({
        field: `${e.artifact}:${e.field}`,
        message: e.message,
      })),
      message: "A generated artifact failed D2 schema validation.",
    });
    return 1;
  }

  printLaneSummary(result);
  emitBlock("AnalystInputEnvelope", result.envelope);
  emitBlock("ScoredSignal", result.scoredSignal);
  emitBlock("ProvenanceRecord", result.provenanceRecord);
  emitBlock("ReplayProfile", result.replayProfile);
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
