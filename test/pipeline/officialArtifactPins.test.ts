/**
 * The canonical composition pins (FLPR-GOV five-lane runtime): the reactor's
 * verification-side hasher MUST reproduce the registered official
 * froggy-trend-pullback v1.3.0 composition hashes byte-exactly —
 * manifestHash, analystConfigHash and pluginSetHash — over the authored
 * fixture registry copies of the official artifacts (one-truth agreement
 * with the afi-config seeding test's pinned values).
 */
import { jest } from "@jest/globals";

// ccxt's compiled dist pulls ESM-only crypto deps jest cannot parse; the test
// harness module transitively touches the price-feed registry (repo idiom —
// see test/oracle/*.test.ts). No ccxt request is ever issued.
jest.mock("ccxt", () => {
  class UnusedExchange {}
  return {
    __esModule: true,
    default: { blofin: UnusedExchange, coinbase: UnusedExchange },
  };
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  computeAnalystConfigHash,
  computeManifestHash,
  computePluginSetHash,
} from "../../src/pipeline/hashing.js";
import type { AnalysisPluginManifest } from "../../src/pipeline/manifestTypes.js";
import { FIXTURE_CONFIG_ROOT } from "./support/testHarness.js";

const PINS = {
  manifestHash: "df3372dadaca1595d0e6d2f6bad9464ccc9abb7106e9f5b7111df148a145bc4f",
  analystConfigHash: "1172e5da91dfd9ac6e65a060b628c5a4f1bbdd41545904a7a6a59e15fc0fe705",
  pluginSetHash: "f63c6f21beb20834c76bc392373746db520828802e7797e84085a831572629d5",
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("official froggy-trend-pullback pins (authoring/verification hash agreement)", () => {
  it("manifestHash of the official pipeline manifest matches the pinned value", () => {
    const pipeline = readJson(
      join(FIXTURE_CONFIG_ROOT, "registries/pipelines/froggy-trend-pullback--v1.3.0.json")
    ) as object;
    const hash = computeManifestHash(pipeline);
    expect(hash.value).toBe(PINS.manifestHash);
    expect(hash.domainTag).toBe("afi.d2.composition-manifest");
  });

  it("analystConfigHash of the official analyst config matches the pinned value", () => {
    const config = readJson(
      join(
        FIXTURE_CONFIG_ROOT,
        "registries/analyst-strategies/froggy--trend_pullback_v1--1.0.0.config.json"
      )
    ) as object;
    const hash = computeAnalystConfigHash(config);
    expect(hash.value).toBe(PINS.analystConfigHash);
    expect(hash.domainTag).toBe("afi.d2.analyst-config");
  });

  it("pluginSetHash over the seven official plugin manifests matches the pinned value", () => {
    const dir = join(FIXTURE_CONFIG_ROOT, "registries/analysis-plugins");
    const plugins = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(join(dir, f)) as AnalysisPluginManifest);
    expect(plugins).toHaveLength(7);
    const hash = computePluginSetHash(plugins);
    expect(hash.value).toBe(PINS.pluginSetHash);
    expect(hash.domainTag).toBe("afi.d2.plugin-set");
  });
});
