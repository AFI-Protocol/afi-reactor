/**
 * Guardrail Test: No Legacy Ingest Plugins
 * 
 * This test ensures that the deprecated legacy ingest plugins
 * (alpha-scout-ingest and signal-structurer) are NOT used in:
 * - Pipeline configurations (ops.codex.json, dag.codex.json)
 * - Runtime code (src/, plugins/)
 * - Active pipeline definitions (froggyPipeline.ts)
 * 
 * These plugins were quarantined in Phase 4 and replaced by the
 * canonical USS v1.1 pipeline flow:
 * 
 *   Webhook → AJV validate → context.rawUss → uss-telemetry-deriver → enrichment → analyst → validator → vault
 * 
 * If this test fails, it means someone accidentally re-introduced
 * a reference to the legacy ingest plugins. Remove the reference
 * and use the canonical USS v1.1 pipeline instead.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "../..");
const LEGACY_PLUGIN_NAMES = ["alpha-scout-ingest", "signal-structurer"];

describe("Guardrail: No Legacy Ingest Plugins", () => {
  it("should not reference legacy ingest plugins in ops.codex.json", () => {
    const opsConfigPath = join(REPO_ROOT, "config/ops.codex.json");
    
    if (!existsSync(opsConfigPath)) {
      // If config doesn't exist, test passes (nothing to check)
      return;
    }

    const opsConfig = JSON.parse(readFileSync(opsConfigPath, "utf-8"));
    const opsConfigStr = JSON.stringify(opsConfig);

    for (const pluginName of LEGACY_PLUGIN_NAMES) {
      expect(opsConfigStr).not.toContain(pluginName);
    }
  });

  it("should mark legacy ingest plugins as deprecated in dag.codex.json", () => {
    const dagConfigPath = join(REPO_ROOT, "config/dag.codex.json");

    if (!existsSync(dagConfigPath)) {
      // If config doesn't exist, test passes (nothing to check)
      return;
    }

    const dagConfig = JSON.parse(readFileSync(dagConfigPath, "utf-8"));

    // Find nodes that reference legacy plugins
    const alphaScoutNode = dagConfig.find((node: any) => node.plugin === "alpha-scout-ingest");
    const structurerNode = dagConfig.find((node: any) => node.plugin === "signal-structurer");

    // If they exist, they MUST be marked as deprecated
    if (alphaScoutNode) {
      expect(alphaScoutNode.deprecated).toBe(true);
      expect(alphaScoutNode.agentReady).toBe(false);
      expect(alphaScoutNode.tags).toContain("deprecated");
    }

    if (structurerNode) {
      expect(structurerNode.deprecated).toBe(true);
      expect(structurerNode.agentReady).toBe(false);
      expect(structurerNode.tags).toContain("deprecated");
    }
  });

  it("should not import legacy ingest plugins in froggyPipeline.ts", () => {
    const pipelineConfigPath = join(REPO_ROOT, "src/config/froggyPipeline.ts");
    
    if (!existsSync(pipelineConfigPath)) {
      // If config doesn't exist, test passes (nothing to check)
      return;
    }

    const pipelineConfig = readFileSync(pipelineConfigPath, "utf-8");

    // Check for imports (both relative and absolute)
    for (const pluginName of LEGACY_PLUGIN_NAMES) {
      expect(pipelineConfig).not.toMatch(new RegExp(`import.*${pluginName}`, "i"));
      expect(pipelineConfig).not.toMatch(new RegExp(`from.*${pluginName}`, "i"));
    }
  });

  it("should not import legacy ingest plugins in froggyDemoService.ts", () => {
    const servicePath = join(REPO_ROOT, "src/services/froggyDemoService.ts");
    
    if (!existsSync(servicePath)) {
      // If service doesn't exist, test passes (nothing to check)
      return;
    }

    const serviceCode = readFileSync(servicePath, "utf-8");

    // Check for imports (both relative and absolute)
    for (const pluginName of LEGACY_PLUGIN_NAMES) {
      expect(serviceCode).not.toMatch(new RegExp(`import.*${pluginName}`, "i"));
      expect(serviceCode).not.toMatch(new RegExp(`from.*${pluginName}`, "i"));
    }
  });

  it("should not have legacy ingest plugins in active plugins directory", () => {
    const alphaScoutPath = join(REPO_ROOT, "plugins/alpha-scout-ingest.plugin.ts");
    const structurerPath = join(REPO_ROOT, "plugins/signal-structurer.plugin.ts");

    expect(existsSync(alphaScoutPath)).toBe(false);
    expect(existsSync(structurerPath)).toBe(false);
  });

  it("should have legacy ingest plugins quarantined in _deprecated_ingest", () => {
    const deprecatedAlphaScoutPath = join(REPO_ROOT, "plugins/_deprecated_ingest/alpha-scout-ingest.plugin.ts");
    const deprecatedStructurerPath = join(REPO_ROOT, "plugins/_deprecated_ingest/signal-structurer.plugin.ts");

    expect(existsSync(deprecatedAlphaScoutPath)).toBe(true);
    expect(existsSync(deprecatedStructurerPath)).toBe(true);

    // Verify deprecation headers are present
    const alphaScoutContent = readFileSync(deprecatedAlphaScoutPath, "utf-8");
    const structurerContent = readFileSync(deprecatedStructurerPath, "utf-8");

    expect(alphaScoutContent).toContain("@deprecated");
    expect(alphaScoutContent).toContain("DO NOT USE");
    expect(structurerContent).toContain("@deprecated");
    expect(structurerContent).toContain("DO NOT USE");
  });
});

