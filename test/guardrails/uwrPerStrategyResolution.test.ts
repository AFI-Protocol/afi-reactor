/**
 * CFG-WEIGHTS (CFG-GOV §8 slot, owner-authorized 2026-08-12): proves
 * D-CFG-4(2)/(4)/(5) — the RC-3 default is registry, resolution is
 * per-strategy (the per-process singleton is retired), the stamp records the
 * resolved profile identity per determination, and builtin-mode value
 * identity is ENFORCED empirically now that D-CFG-4(1) retired it by
 * construction.
 *
 * Deliberately a NEW file: the RC-7-governed guardrails (uwrProfileStamp)
 * keep their surface; this slot's new obligations are stated here.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  resolveUwrProfileSource,
  getUwrRuntimeConfigForProfile,
  __resetUwrRuntimeConfigForTests,
  UwrRuntimeProfileError,
  UWR_PROFILE_SOURCE_ENV,
  UWR_REGISTRY_RELATIVE_DIR,
} from "../../src/config/uwrRuntimeProfile.js";
import * as uwrRuntimeModule from "../../src/config/uwrRuntimeProfile.js";
import {
  uwrProfileStampFor,
  REGISTERED_UWR_PROFILE_IDS,
  UWR_STAMP_SOURCE_REGISTRY,
  type RecognizedStrategyRegistration,
} from "../../src/config/uwrProfilePin.js";
import { defaultUwrConfig } from "afi-core/validators/UniversalWeightingRule.js";
import { scorerFroggyTrendPullbackNode } from "../../src/pipeline/nodes/scorerFroggyTrendPullback.js";
import { SILENT_NODE_LOGGER, type NodeRunContext } from "../../src/pipeline/nodeSdk.js";

const REPO_ROOT = process.cwd();

function registryDocument(profileId: string, weights: Record<string, number>) {
  return {
    schema: "afi.uwr-profile.v0",
    profileId,
    supersedes: "uwr-default-stub",
    axes: ["structure", "execution", "risk", "insight"],
    weights,
  };
}

const FROGGY_REGISTRATION: RecognizedStrategyRegistration = {
  analystId: "froggy",
  strategyId: "trend_pullback_v1",
  strategyVersion: "1.0.0",
  uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
};

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "uwr-per-strategy-"));
  __resetUwrRuntimeConfigForTests();
  delete process.env[UWR_PROFILE_SOURCE_ENV];
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  __resetUwrRuntimeConfigForTests();
  delete process.env[UWR_PROFILE_SOURCE_ENV];
});

describe("D-CFG-4(2): the RC-3 source default is registry", () => {
  it("unset and empty resolve to registry; explicit builtin still resolves builtin", () => {
    expect(resolveUwrProfileSource({})).toBe("registry");
    expect(resolveUwrProfileSource({ [UWR_PROFILE_SOURCE_ENV]: "" })).toBe("registry");
    expect(resolveUwrProfileSource({ [UWR_PROFILE_SOURCE_ENV]: "builtin" })).toBe("builtin");
  });

  it("a junk value still refuses with invalid-source-flag", () => {
    let caught: unknown;
    try {
      resolveUwrProfileSource({ [UWR_PROFILE_SOURCE_ENV]: "demo" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UwrRuntimeProfileError);
    expect((caught as UwrRuntimeProfileError).reason).toBe("invalid-source-flag");
  });
});

describe("D-CFG-4(4): resolution is per profile, not per process", () => {
  it("two profiles resolve to DIFFERENT weight vectors in the same process", () => {
    // The assertion the retired singleton made impossible.
    writeFileSync(
      path.join(tempDir, "uwr-weighted-lifts-v0.1.json"),
      JSON.stringify(
        registryDocument("uwr-weighted-lifts-v0.1", {
          structureWeight: 0.25,
          executionWeight: 0.25,
          riskWeight: 0.25,
          insightWeight: 0.25,
        })
      ),
      "utf8"
    );
    writeFileSync(
      path.join(tempDir, "uwr-test-nondefault-v0.json"),
      JSON.stringify(
        registryDocument("uwr-test-nondefault-v0", {
          structureWeight: 0.4,
          executionWeight: 0.3,
          riskWeight: 0.2,
          insightWeight: 0.1,
        })
      ),
      "utf8"
    );
    const env = { [UWR_PROFILE_SOURCE_ENV]: "registry" };
    const froggy = getUwrRuntimeConfigForProfile("uwr-weighted-lifts-v0.1", {
      env,
      registryDir: tempDir,
    });
    const other = getUwrRuntimeConfigForProfile("uwr-test-nondefault-v0", {
      env,
      registryDir: tempDir,
    });
    expect(froggy.config.structureWeight).toBe(0.25);
    expect(other.config.structureWeight).toBe(0.4);
    expect(other.config.id).toBe("uwr-test-nondefault-v0");
    expect(froggy.config.id).toBe("uwr-weighted-lifts-v0.1");
  });

  it("failures are never cached: two consecutive missing-profile calls both throw", () => {
    process.env[UWR_PROFILE_SOURCE_ENV] = "registry";
    for (let i = 0; i < 2; i += 1) {
      let caught: unknown;
      try {
        getUwrRuntimeConfigForProfile("does-not-exist", { registryDir: tempDir });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UwrRuntimeProfileError);
      expect((caught as UwrRuntimeProfileError).reason).toBe("registry-unreadable");
    }
  });

  it("a traversal-shaped profile id refuses before any read", () => {
    process.env[UWR_PROFILE_SOURCE_ENV] = "registry";
    let caught: unknown;
    try {
      getUwrRuntimeConfigForProfile("../../etc/passwd");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UwrRuntimeProfileError);
    expect((caught as UwrRuntimeProfileError).reason).toBe("invalid-profile-id");
  });
});

describe("D-CFG-4(4): the singleton is retired and the carrier is bounded", () => {
  /** Recursively collect relative paths of .ts files under dir whose content matches. */
  function scanTsTree(dir: string, matches: (content: string) => boolean): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          walk(full);
        } else if (entry.name.endsWith(".ts")) {
          if (matches(readFileSync(full, "utf8"))) {
            out.push(path.relative(REPO_ROOT, full));
          }
        }
      }
    };
    walk(dir);
    return out;
  }

  it("getUwrRuntimeConfigOnce no longer exists (module-shape assertion)", () => {
    expect(
      (uwrRuntimeModule as Record<string, unknown>)["getUwrRuntimeConfigOnce"]
    ).toBeUndefined();
  });

  it("only the loader module and the composition root reference per-profile resolution", () => {
    const ALLOWED = new Set([
      "src/config/uwrRuntimeProfile.ts",
      "src/services/graphScoringService.ts",
    ]);
    const offenders = scanTsTree(path.resolve(REPO_ROOT, "src"), content =>
      content.includes("getUwrRuntimeConfigForProfile")
    ).filter(rel => !ALLOWED.has(rel));
    expect(offenders).toEqual([]);
  });

  it("ctx.uwr is not a general node-config channel: the scorer node is its sole reader", () => {
    const SOLE_READER = "src/pipeline/nodes/scorerFroggyTrendPullback.ts";
    const offenders = scanTsTree(path.resolve(REPO_ROOT, "src"), content =>
      /ctx\.uwr|context\.uwr/.test(content)
    ).filter(rel => rel !== SOLE_READER);
    expect(offenders).toEqual([]);
  });
});

describe("D-CFG-4(4): the scorer node refuses without a resolved config", () => {
  it("run() with no ctx.uwr throws — no score, no partial result", async () => {
    const ctxWithoutUwr: NodeRunContext = {
      signal: {
        schema: "afi.usignal.v1.1",
        provenance: {
          source: "test",
          providerId: "uwr-per-strategy-test-provider",
          signalId: "sig-uwr-per-strategy-test",
        },
      },
      config: {},
      logger: SILENT_NODE_LOGGER,
      abort: new AbortController().signal,
    };
    const enriched = {
      signalId: "sig-uwr-per-strategy-test",
      symbol: "BTCUSDT",
      market: "crypto",
      timeframe: "4h",
      technical: { emaDistancePct: 1.5, isInValueSweetSpot: true, brokeEmaWithBody: false },
      pattern: { patternName: "bull flag", patternConfidence: 80 },
      sentiment: { score: 0.4, tags: [] },
    };
    await expect(
      scorerFroggyTrendPullbackNode.run(enriched, ctxWithoutUwr)
    ).rejects.toThrow(/no resolved UWR configuration/);
  });
});

describe("D-CFG-4(5): the stamp records the resolved profile identity per determination", () => {
  it("profileId is read from the registration object per call, not a module literal", () => {
    // Mutate the identity fields (matched by gates 2/3), keep the profileId
    // registered — the emitted id must be the registration's own value.
    const stamp = uwrProfileStampFor(
      { analystId: "froggy", strategyId: "trend_pullback_v1", strategyVersion: "1.0.0" },
      "registry",
      { ...FROGGY_REGISTRATION }
    );
    expect(stamp).toBeDefined();
    expect(stamp!.profileId).toBe(FROGGY_REGISTRATION.uwrProfileRef.profileId);
    expect(stamp!.source).toBe(UWR_STAMP_SOURCE_REGISTRY);
  });

  it("recognition is still registered-set gated: an unregistered ref yields no stamp", () => {
    const stamp = uwrProfileStampFor(
      { analystId: "froggy", strategyId: "trend_pullback_v1" },
      "registry",
      { ...FROGGY_REGISTRATION, uwrProfileRef: { profileId: "uwr-unregistered-v9" } }
    );
    expect(stamp).toBeUndefined();
  });
});

describe("design call B/E guard: builtin-value-identity cannot become a lie", () => {
  // In builtin mode the config that produced the score is defaultUwrConfig
  // while the stamp names the registered profile; the governed schema defines
  // that field as the profile that ACTUALLY produced the score. D-CFG-4(1)
  // retired the structural guarantee that those coincide — this test converts
  // it into an enforced empirical one. Registering a differently-weighted
  // profile turns this red and forces the builtin-mode question to be
  // DECIDED rather than discovered in production.
  const registryDir = path.resolve(REPO_ROOT, UWR_REGISTRY_RELATIVE_DIR);
  const maybeIt = existsSync(registryDir) || process.env.CI ? it : it.skip;

  maybeIt("every REGISTERED profile document's weights equal defaultUwrConfig's", () => {
    for (const id of REGISTERED_UWR_PROFILE_IDS) {
      const doc = JSON.parse(
        readFileSync(path.join(registryDir, `${id}.json`), "utf8")
      ) as { weights: Record<string, number> };
      const mismatches: string[] = [];
      for (const key of [
        "structureWeight",
        "executionWeight",
        "riskWeight",
        "insightWeight",
      ] as const) {
        if (!Object.is(doc.weights[key], defaultUwrConfig[key])) {
          mismatches.push(
            `${id}.${key}=${doc.weights[key]} != defaultUwrConfig.${key}=${defaultUwrConfig[key]}`
          );
        }
      }
      // Must be empty while builtin mode exists (design call B/E).
      expect(mismatches).toEqual([]);
    }
  });
});
