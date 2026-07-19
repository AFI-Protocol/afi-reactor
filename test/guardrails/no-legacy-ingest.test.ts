/**
 * Guardrail Test: Legacy Demo Pipeline + Codex Ingest Surface Is Purged
 *
 * The deprecated Froggy "demo chain" personas/plugins and the entire classic
 * codex/DAG ingest-authoring surface have been REMOVED (not quarantined):
 *
 *   - alpha-scout-ingest          (Alpha Scout)
 *   - signal-structurer           (Pixel Rick)
 *   - validator-decision-evaluator (Val Dook)
 *   - execution-agent-sim          (Execution Agent Sim)
 *   - the codex/DAG config registries (config/*.codex.json, .afi-codex.json)
 *   - the superseded hardcoded scoring path (froggyPipeline / froggyScoringService)
 *
 * The canonical runtime is the scored-only USS v1.1 five-lane pipeline driven
 * by the manifest-registered GraphExecutor. Validator certification and
 * execution are NOT the reactor's responsibility.
 *
 * If this test fails, someone re-introduced a retired ingest surface. Remove
 * the reference and use the canonical five-lane pipeline instead. git history
 * is the archive.
 */

import { describe, it, expect } from "@jest/globals";
import { existsSync } from "fs";
import { join } from "path";

// jest runs with cwd = reactor rootDir (where jest.config.js lives).
const REACTOR_ROOT = process.cwd();

// Legacy demo-chain plugin module names that must never reappear.
const LEGACY_PLUGIN_NAMES = [
  "alpha-scout-ingest",
  "signal-structurer",
  "validator-decision-evaluator",
  "execution-agent-sim",
];

// Every retired ingest / codex-orchestration path (file or directory) that
// must stay deleted.
const REMOVED_INGEST_PATHS = [
  // classic codex / agent config registries
  "config/ops.codex.json",
  "config/schema.codex.json",
  "config/dag.codex.json",
  "config/agent.registry.json",
  "config/agents.codex.json",
  "config/execution-agent.registry.json",
  ".afi-codex.json",
  "codex",
  // superseded hardcoded scoring path
  "src/config/froggyPipeline.ts",
  "src/services/froggyScoringService.ts",
  // legacy demo-chain plugin files + quarantine dir
  ...LEGACY_PLUGIN_NAMES.map((name) => `plugins/${name}.plugin.ts`),
  "plugins/_deprecated_ingest",
];

describe("Guardrail: legacy demo pipeline + codex ingest surface stays purged", () => {
  it("every retired ingest / codex-orchestration path stays deleted (git history is the archive)", () => {
    const survivors = REMOVED_INGEST_PATHS.filter((rel) =>
      existsSync(join(REACTOR_ROOT, rel))
    );
    expect(survivors).toEqual([]);
  });
});
