/**
 * Boot-time registry validation (validateRuntimeConfig — W3 spec section 3):
 * positive resolution over the authored TEST FIXTURE registries
 * (test/pipeline/fixtures/afi-config — nothing depends on any live afi-config
 * checkout's branch state) plus the boot-refusal negatives: every invalid
 * ACTIVE entry variant must throw RuntimeConfigValidationError.
 */
import { jest } from "@jest/globals";

// ccxt's compiled dist pulls ESM-only crypto deps jest cannot parse; no test
// here ever issues a ccxt request (repo idiom — see test/oracle/*.test.ts).
jest.mock("ccxt", () => {
  class UnusedExchange {}
  return {
    __esModule: true,
    default: { blofin: UnusedExchange, coinbase: UnusedExchange },
  };
});

import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RuntimeConfigValidationError,
  governedDecayTemplateIds,
  loadProviderRecords,
  validateRuntimeConfig,
} from "../../src/pipeline/registryLoader.js";
import { builtinPluginRegistry, createPluginRegistry } from "../../src/pipeline/pluginRegistry.js";
import { buildProviderRuntime } from "../../src/providers/index.js";
import { computeAnalystConfigHash } from "../../src/pipeline/hashing.js";
import { FIXTURE_CONFIG_ROOT } from "./support/testHarness.js";

const FROGGY_KEY = "froggy/trend_pullback_v1@1.0.0";

/** The production plugin registry over an empty provider runtime (binding only). */
function testBuiltinRegistry() {
  return builtinPluginRegistry(buildProviderRuntime());
}
const CONFIG_REL = "registries/analyst-strategies/froggy--trend_pullback_v1--1.0.0.config.json";
const REGISTRATION_REL = "registries/analyst-strategies/froggy--trend_pullback_v1--1.0.0.json";
const PIPELINE_REL = "registries/pipelines/froggy-trend-pullback--v1.1.0.json";

/** Copies the fixture registries into a scratch root and applies mutations. */
function scratchRoot(mutate?: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "afi-reactor-registry-"));
  cpSync(FIXTURE_CONFIG_ROOT, root, { recursive: true });
  mutate?.(root);
  return root;
}

function editJson(root: string, rel: string, edit: (doc: any) => void): void {
  const path = join(root, rel);
  const doc = JSON.parse(readFileSync(path, "utf-8"));
  edit(doc);
  writeFileSync(path, JSON.stringify(doc, null, 2));
}

/** Re-pins the registration's analystConfigHash after an intentional config edit. */
function repinConfigHash(root: string): void {
  const config = JSON.parse(readFileSync(join(root, CONFIG_REL), "utf-8"));
  editJson(root, REGISTRATION_REL, (reg) => {
    reg.analystConfigHash = computeAnalystConfigHash(config);
  });
}

function expectBootRefusal(root: string, pattern: RegExp): void {
  try {
    expect(() =>
      validateRuntimeConfig({ pluginRegistry: testBuiltinRegistry(), configRoot: root })
    ).toThrow(RuntimeConfigValidationError);
    expect(() =>
      validateRuntimeConfig({ pluginRegistry: testBuiltinRegistry(), configRoot: root })
    ).toThrow(pattern);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("validateRuntimeConfig — positive resolution over the fixture registries", () => {
  it("resolves the froggy composition with verified hashes and bindings", () => {
    const validated = validateRuntimeConfig({
      pluginRegistry: testBuiltinRegistry(),
      configRoot: FIXTURE_CONFIG_ROOT,
    });

    expect([...validated.strategies.keys()]).toEqual([FROGGY_KEY]);
    const froggy = validated.strategies.get(FROGGY_KEY)!;
    expect(froggy.manifestHash.value).toBe(
      "87bcb7ed752820994a5b4bdb72bd55d51c39a2c58daa36fe8d0df4778778ae57"
    );
    expect(froggy.analystConfigHash.value).toBe(
      "2274978afdffb798440ce08268dd4c0f06af2df94433d25d6f907335c9a3bc03"
    );
    expect(froggy.pluginSetHash.value).toBe(
      "5384e1c08ce4bd7f533acc15487df81d7d37b6615d109d611bde968a81f2f386"
    );
    expect(froggy.decay).toEqual({ kind: "template", templateId: "decay-swing-v1" });
    expect(froggy.plugins.size).toBe(7);
    expect(validated.registries.analysisPlugins.size).toBe(7);
    expect(validated.bindings.size).toBe(5);
  });

  it("the governed decay template ids come from afi-core", () => {
    const ids = governedDecayTemplateIds();
    expect(ids.has("decay-swing-v1")).toBe(true);
    expect(ids.has("decay-scalp-v1")).toBe(true);
    expect(ids.has("decay-warp-v9")).toBe(false);
  });

  it("an inactive registration is retained but never served (with its bindings retired)", () => {
    const root = scratchRoot((r) => {
      editJson(r, REGISTRATION_REL, (reg) => {
        reg.status = "inactive";
      });
      // Retire the bindings that route into it (else boot refuses honestly).
      for (const binding of [
        "tradingview-default-webhook",
        "cpj-oracle-telegram-channel-1",
        "cpj-oracle-telegram-channel-2",
        "cpj-oracle-discord-guild-3",
      ]) {
        editJson(r, `registries/provider-bindings/${binding}.json`, (doc) => {
          doc.status = "inactive";
        });
      }
    });
    try {
      const validated = validateRuntimeConfig({
        pluginRegistry: testBuiltinRegistry(),
        configRoot: root,
      });
      expect(validated.strategies.size).toBe(0);
      expect(validated.registries.registrations).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("validateRuntimeConfig — boot refusal negatives (any invalid ACTIVE entry)", () => {
  it("refuses when a registry directory is missing", () => {
    const root = scratchRoot((r) =>
      rmSync(join(r, "registries/provider-bindings"), { recursive: true })
    );
    expectBootRefusal(root, /registry directory missing: registries\/provider-bindings/);
  });

  it("refuses a schema-invalid plugin manifest", () => {
    const root = scratchRoot((r) =>
      editJson(r, "registries/analysis-plugins/afi-analysis-news--2.0.0.json", (doc) => {
        delete doc.implementationVersion;
      })
    );
    expectBootRefusal(root, /analysis-plugin .*implementationVersion/);
  });

  it("refuses a pipeline whose recomputed manifestHash diverges from the pinned pipelineRef", () => {
    const root = scratchRoot((r) =>
      editJson(r, PIPELINE_REL, (doc) => {
        doc.nodes.find((n: { id: string }) => n.id === "technical").config.candleLimit = 99;
      })
    );
    expectBootRefusal(root, /manifestHash mismatch/);
  });

  it("refuses a registration whose analystConfigHash does not match the config", () => {
    const root = scratchRoot((r) =>
      editJson(r, REGISTRATION_REL, (reg) => {
        reg.analystConfigHash.value = reg.analystConfigHash.value.replace(/^./, "0");
      })
    );
    expectBootRefusal(root, /analystConfigHash mismatch/);
  });

  it("refuses a dangling configRef", () => {
    const root = scratchRoot((r) => unlinkSync(join(r, CONFIG_REL)));
    expectBootRefusal(root, /configRef .*does not resolve/);
  });

  it("refuses a plugin without a build-time binding", () => {
    const root = scratchRoot();
    try {
      expect(() =>
        validateRuntimeConfig({ pluginRegistry: createPluginRegistry([]), configRoot: root })
      ).toThrow(/no build-time binding/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a scorerRef that disagrees with the pipeline's scorer node", () => {
    const root = scratchRoot((r) => {
      editJson(r, CONFIG_REL, (config) => {
        config.scorerRef.pluginId = "afi-analysis-technical";
      });
      repinConfigHash(r);
    });
    expectBootRefusal(root, /scorerRef .* != pipeline scorer/);
  });

  it("refuses an unknown UWR profile ref", () => {
    const root = scratchRoot((r) => {
      editJson(r, CONFIG_REL, (config) => {
        config.uwrProfileRef.profileId = "uwr-unrecognized-v9";
      });
      repinConfigHash(r);
    });
    expectBootRefusal(root, /uwrProfileRef .*not the recognized profile/);
  });

  it("refuses an unknown decay template id", () => {
    const root = scratchRoot((r) => {
      editJson(r, CONFIG_REL, (config) => {
        config.decayConfig = { ref: { templateId: "decay-warp-v9" } };
      });
      repinConfigHash(r);
    });
    expectBootRefusal(root, /decay templateId 'decay-warp-v9' is not a governed template/);
  });

  it("refuses a node category that disagrees with the bound plugin's category", () => {
    const root = scratchRoot((r) =>
      editJson(r, PIPELINE_REL, (doc) => {
        doc.nodes.find((n: { id: string }) => n.id === "news").category = "sentiment";
      })
    );
    expectBootRefusal(root, /category 'sentiment' != plugin category 'news'/);
  });

  it("refuses a node config that violates the bound plugin's paramsSchema", () => {
    const root = scratchRoot((r) =>
      editJson(r, PIPELINE_REL, (doc) => {
        doc.nodes.find((n: { id: string }) => n.id === "technical").config = {
          candleLimit: "many",
        };
      })
    );
    expectBootRefusal(root, /config violates .*paramsSchema/);
  });

  it("refuses a graph whose scorer is bypassable (non-scorer sink)", () => {
    const root = scratchRoot((r) =>
      editJson(r, PIPELINE_REL, (doc) => {
        // Cut merge -> scorer: merge becomes a non-scorer sink and the scorer unreachable.
        doc.edges = doc.edges.filter(
          (e: { from: string; to: string }) => !(e.from === "merge" && e.to === "scorer")
        );
      })
    );
    expectBootRefusal(root, /sink|reachable/);
  });

  it("refuses a binding whose defaultStrategy is outside allowedStrategies", () => {
    const root = scratchRoot((r) =>
      editJson(r, "registries/provider-bindings/tradingview-default-webhook.json", (doc) => {
        doc.defaultStrategy.strategyVersion = "2.0.0";
      })
    );
    expectBootRefusal(root, /defaultStrategy is not a member of allowedStrategies/);
  });

  it("refuses a binding routing into a strategy that does not admit it", () => {
    const root = scratchRoot((r) =>
      editJson(r, REGISTRATION_REL, (reg) => {
        reg.providerBindingPolicy.allowedBindings = ["cpj-oracle-telegram-channel-1"];
      })
    );
    expectBootRefusal(root, /does not admit this binding/);
  });
});

describe("FLPR-GOV D-FLPR-4 — selection-point status-chain refusals (boot law)", () => {
  function validateWithProviders(root: string, adapterKeys?: readonly string[]) {
    const providerRecords = loadProviderRecords({ configRoot: root });
    return validateRuntimeConfig({
      pluginRegistry: testBuiltinRegistry(),
      configRoot: root,
      providerRecords,
      providerAdapterKeys:
        adapterKeys ??
        [
          "afi-adapter-technical-local@1.0.0",
          "afi-adapter-pattern-candlestick@1.0.0",
          "afi-adapter-pattern-tiny-brains@1.0.0",
          "afi-adapter-sentiment-cftc-cot@1.0.0",
          "afi-adapter-sentiment-coinalyze@1.0.0",
          "afi-adapter-news-http@1.0.0",
          "afi-adapter-news-sec-edgar@1.0.0",
          "afi-adapter-aiml-tiny-brains@1.0.0",
        ],
    });
  }

  it("the shipped fixture registries pass the full selection-point chain", () => {
    const root = scratchRoot();
    try {
      expect(() => validateWithProviders(root)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("REFUSES a referenced instance whose PROVIDER is inactive", () => {
    const root = scratchRoot((r) =>
      editJson(r, "registries/providers/afi-provider-technical-local--1.0.0.json", (doc) => {
        doc.status = "inactive";
      })
    );
    try {
      expect(() => validateWithProviders(root)).toThrow(/provider 'afi-provider-technical-local' which is not active/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("REFUSES a referenced instance whose adapterVersion is not in the build-time set", () => {
    const root = scratchRoot((r) =>
      editJson(
        r,
        "registries/provider-instances/afi-instance-reference-technical-local--1.0.0.json",
        (doc) => {
          doc.adapterVersion = "1.1.0";
        }
      )
    );
    try {
      expect(() => validateWithProviders(root)).toThrow(/afi-adapter-technical-local@1\.1\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a DISABLED credentialRef on an UNREFERENCED BYOK instance still boots (revocation without deletion)", () => {
    const root = scratchRoot((r) => {
      editJson(r, "registries/credential-refs/credential-coinalyze-reference--1.0.0.json", (doc) => {
        doc.status = "disabled";
      });
      editJson(
        r,
        "registries/provider-instances/afi-instance-byok-sentiment-coinalyze--1.0.0.json",
        (doc) => {
          doc.status = "inactive";
        }
      );
    });
    try {
      expect(() => validateWithProviders(root)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
