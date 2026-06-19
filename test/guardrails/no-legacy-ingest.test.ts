/**
 * Guardrail Test: Legacy Demo Pipeline Is Purged
 *
 * The deprecated Froggy "demo chain" personas and plugins have been REMOVED
 * (not quarantined). This guardrail asserts they stay gone:
 *
 *   - alpha-scout-ingest          (Alpha Scout)
 *   - signal-structurer           (Pixel Rick)
 *   - validator-decision-evaluator (Val Dook)
 *   - execution-agent-sim          (Execution Agent Sim)
 *
 * The canonical runtime is the scored-only USS v1.1 pipeline:
 *
 *   Webhook → AJV validate → context.rawUss → uss-telemetry-deriver →
 *   enrichment (tech+pattern ∥ sentiment+news) → enrichment-adapter →
 *   froggy-analyst (UWR score) → reactor vault write
 *
 * Validator certification and execution are NOT the reactor's responsibility.
 *
 * If this test fails, someone re-introduced the legacy demo chain. Remove the
 * reference and use the canonical scored-only pipeline instead.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// jest runs with cwd = reactor rootDir (where jest.config.js lives), and the
// ESM preset means __dirname is unavailable — anchor on process.cwd() instead.
const REACTOR_ROOT = process.cwd();

// Legacy plugin module names that must never reappear in config or runtime.
const LEGACY_PLUGIN_NAMES = [
  "alpha-scout-ingest",
  "signal-structurer",
  "validator-decision-evaluator",
  "execution-agent-sim",
];

// Legacy codex node IDs / personas that must never reappear in codex config.
const LEGACY_CODEX_TOKENS = [
  "alpha-scout-ingest",
  "pixelrick-structurer",
  "validator-decision-node",
  "execution-sim-node",
  "froggy-vault-echo",
  "Val Dook",
  "Alpha Scout",
];

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

describe("Guardrail: legacy demo pipeline is purged", () => {
  it("ops.codex.json references no legacy plugins, nodes, or personas", () => {
    const ops = readIfExists(join(REACTOR_ROOT, "config/ops.codex.json"));
    if (ops === null) return;
    for (const token of [...LEGACY_PLUGIN_NAMES, ...LEGACY_CODEX_TOKENS]) {
      expect(ops).not.toContain(token);
    }
  });

  it("dag.codex.json contains NO node that references a legacy plugin or persona", () => {
    const dagRaw = readIfExists(join(REACTOR_ROOT, "config/dag.codex.json"));
    if (dagRaw === null) return;

    // String-level: no legacy token anywhere in the file.
    for (const token of [...LEGACY_PLUGIN_NAMES, ...LEGACY_CODEX_TOKENS]) {
      expect(dagRaw).not.toContain(token);
    }

    // Structural: no node carries a legacy id/plugin (and none is "deprecated"
    // — the legacy nodes are gone, not quarantined).
    const dag = JSON.parse(dagRaw);
    const nodes: any[] = Array.isArray(dag) ? dag : dag.nodes ?? [];
    for (const node of nodes) {
      expect(LEGACY_PLUGIN_NAMES).not.toContain(node.plugin);
      expect(LEGACY_CODEX_TOKENS).not.toContain(node.id);
      expect(node.deprecated).not.toBe(true);
    }
  });

  it("schema.codex.json links no purged DAG node", () => {
    const schemaRaw = readIfExists(join(REACTOR_ROOT, "config/schema.codex.json"));
    if (schemaRaw === null) return;
    const schemas = JSON.parse(schemaRaw);
    for (const entry of schemas) {
      expect(LEGACY_CODEX_TOKENS).not.toContain(entry.linkedDAGNode);
      expect(LEGACY_PLUGIN_NAMES).not.toContain(entry.linkedDAGNode);
    }
  });

  it("froggyPipeline.ts imports no legacy plugin", () => {
    const pipeline = readIfExists(join(REACTOR_ROOT, "src/config/froggyPipeline.ts"));
    if (pipeline === null) return;
    // Note: the REMOVED STAGES doc comment intentionally NAMES the removed
    // stages, so we assert on imports only — not on bare mentions.
    for (const name of LEGACY_PLUGIN_NAMES) {
      expect(pipeline).not.toMatch(new RegExp(`import[^\\n]*${name}`, "i"));
      expect(pipeline).not.toMatch(new RegExp(`from\\s+["'][^"'\\n]*${name}`, "i"));
    }
  });

  it("froggyDemoService.ts imports no legacy plugin", () => {
    const service = readIfExists(join(REACTOR_ROOT, "src/services/froggyDemoService.ts"));
    if (service === null) return;
    for (const name of LEGACY_PLUGIN_NAMES) {
      expect(service).not.toMatch(new RegExp(`import[^\\n]*${name}`, "i"));
      expect(service).not.toMatch(new RegExp(`from\\s+["'][^"'\\n]*${name}`, "i"));
    }
  });

  it("legacy plugin files are absent from the active plugins directory", () => {
    for (const name of LEGACY_PLUGIN_NAMES) {
      expect(existsSync(join(REACTOR_ROOT, `plugins/${name}.plugin.ts`))).toBe(false);
    }
  });

  it("there is NO _deprecated_ingest quarantine directory", () => {
    expect(existsSync(join(REACTOR_ROOT, "plugins/_deprecated_ingest"))).toBe(false);
  });
});
