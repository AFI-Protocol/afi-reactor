/**
 * PR-UWR-RUNTIME-READ tests (uwr-runtime-consumption-v0.1.md §7 row flipped
 * 2026-07-13 via afi-governance PR #12; RC-3/RC-4/RC-5).
 *
 * Verifies the flag-gated runtime registry read in
 * src/config/uwrRuntimeProfile.ts — the single authorized loader module
 * (RC-7 grant 1):
 *   1. builtin (default) mode is today's behavior: defaultUwrConfig, and no
 *      file read is even attempted;
 *   2. the flag cannot be enabled by accident (unknown values refuse);
 *   3. registry mode loads the pinned document through afi-core's pure
 *      loadUwrProfile, whose RC-5 predicate is the permanent v0.1
 *      value-identity cross-check;
 *   4. registry mode FAILS CLOSED with machine-checkable reasons on
 *      missing/unparseable/mismatched documents — no silent fallback;
 *   5. scoring is bit-identical under either source (UP-5 golden anchor).
 *
 * Scope framing: this suite tests source RESOLUTION only. Persisted-stamp
 * semantics (the RC-6 discriminator fed by the resolved source this suite
 * exercises) live in PR-UWR-STAMP-SEMANTICS — §7 row flipped via
 * afi-governance PR #13 — and are tested in uwrProfileStamp.test.ts and
 * uwrStampSemantics.test.ts; reward/mint/settlement stay untouched.
 */

import { describe, it, expect, jest, beforeAll, afterAll, beforeEach, afterEach } from "@jest/globals";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  resolveUwrProfileSource,
  resolveUwrRuntimeConfig,
  getUwrRuntimeConfigOnce,
  __resetUwrRuntimeConfigForTests,
  UwrRuntimeProfileError,
  UwrProfileLoadError,
  UWR_PROFILE_SOURCE_ENV,
  UWR_REGISTRY_RELATIVE_PATH,
} from "../../src/config/uwrRuntimeProfile.js";
import {
  defaultUwrConfig,
  computeUwrScore,
} from "afi-core/validators/UniversalWeightingRule.js";
// Relative-into-node_modules form: ts-jest's type resolution cannot follow
// afi-core's package-exports for VALUE imports from test files (the same
// reason the analysts moduleNameMapper exists for runtime); the relative
// path lets TypeScript check the file:-linked source directly while jest's
// relative mapper resolves the identical module at runtime.
import { scoreFroggyTrendPullbackFromEnriched } from "../../node_modules/afi-core/analysts/froggy.trend_pullback_v1.js";
import type { FroggyEnrichedView } from "../../node_modules/afi-core/analysts/froggy.enrichment_adapter.js";
import { scorerFroggyTrendPullbackNode } from "../../src/pipeline/nodes/scorerFroggyTrendPullback.js";
import { SILENT_NODE_LOGGER, type NodeRunContext } from "../../src/pipeline/nodeSdk.js";

/** The LIVE scoring seam (D-FCP-9: the old froggy analyst plugin is deleted;
 * the scorer node composes the identical afi-core kernels and emits the
 * identical {…enriched, analysis, uwrResolvedSource} envelope). */
type ScoredEnvelope = FroggyEnrichedView & {
  analysis: { analystScore: { analystId?: string; strategyId?: string } };
  uwrResolvedSource: "builtin" | "registry";
};

function nodeCtx(): NodeRunContext {
  return {
    signal: {
      schema: "afi.usignal.v1.1",
      provenance: {
        source: "test",
        providerId: "uwr-runtime-profile-test-provider",
        signalId: "sig-uwr-runtime-profile-test",
      },
    },
    config: {},
    logger: SILENT_NODE_LOGGER,
    abort: new AbortController().signal,
  };
}

async function runScorer(enriched: FroggyEnrichedView): Promise<ScoredEnvelope> {
  const result = await scorerFroggyTrendPullbackNode.run(enriched, nodeCtx());
  return result.output as ScoredEnvelope;
}

// Repo idiom (see test/pipeheads/*.test.ts): jest runs from the repo root.
const REPO_ROOT = process.cwd();
const INSTALLED_REGISTRY = path.resolve(REPO_ROOT, UWR_REGISTRY_RELATIVE_PATH);

/** Mirror of the registered profile document's loader-consumed fields
 * (registries/uwr-profiles/uwr-weighted-lifts-v0.1.json @ afi-config merge
 * fe32916; the installed-copy test below cross-checks the real file). */
function registryDocument(): Record<string, unknown> {
  return {
    schema: "afi.uwr-profile.v0",
    "x-afiStatus": "draft-non-implementation",
    profileId: "uwr-weighted-lifts-v0.1",
    humanAlias: "Testnet Scoring Profile v0",
    status: "testnet-provisional",
    supersedes: "uwr-default-stub",
    axes: ["structure", "execution", "risk", "insight"],
    weights: {
      structureWeight: 0.25,
      executionWeight: 0.25,
      riskWeight: 0.25,
      insightWeight: 0.25,
    },
  };
}

let tempDir: string;

function writeTempRegistry(name: string, content: string): string {
  const p = path.join(tempDir, name);
  writeFileSync(p, content, "utf8");
  return p;
}

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "uwr-runtime-read-"));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Hygiene both directions: a preset runner env must not leak in, and no
  // test may leak the flag or a memoized resolution out.
  __resetUwrRuntimeConfigForTests();
  delete process.env[UWR_PROFILE_SOURCE_ENV];
});

afterEach(() => {
  __resetUwrRuntimeConfigForTests();
  delete process.env[UWR_PROFILE_SOURCE_ENV];
  jest.restoreAllMocks();
});

describe("PR-UWR-RUNTIME-READ: source flag (RC-3)", () => {
  it("defaults to builtin when the flag is unset or empty", () => {
    expect(resolveUwrProfileSource({})).toBe("builtin");
    expect(resolveUwrProfileSource({ [UWR_PROFILE_SOURCE_ENV]: "" })).toBe("builtin");
  });

  it("accepts exactly 'builtin' and 'registry'", () => {
    expect(resolveUwrProfileSource({ [UWR_PROFILE_SOURCE_ENV]: "builtin" })).toBe("builtin");
    expect(resolveUwrProfileSource({ [UWR_PROFILE_SOURCE_ENV]: "registry" })).toBe("registry");
  });

  it("refuses any other value — the flag cannot be enabled by accident", () => {
    for (const bad of ["Registry", "REGISTRY", " registry", "registry ", "true", "1", "on", "builtin,registry"]) {
      let caught: unknown;
      try {
        resolveUwrProfileSource({ [UWR_PROFILE_SOURCE_ENV]: bad });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UwrRuntimeProfileError);
      expect((caught as UwrRuntimeProfileError).reason).toBe("invalid-source-flag");
    }
  });
});

describe("PR-UWR-RUNTIME-READ: builtin mode (default behavior unchanged)", () => {
  it("returns defaultUwrConfig itself and never touches the registry file", () => {
    // A registryPath that cannot exist proves no read of the override path.
    const resolved = resolveUwrRuntimeConfig({
      env: {},
      registryPath: path.join(tempDir, "definitely-missing", "nope.json"),
    });
    expect(resolved.source).toBe("builtin");
    expect(resolved.config).toBe(defaultUwrConfig);
  });

  it("builtin mode succeeds from a sandbox where any DEFAULT-path read would fail (RC-3 'no file read whatsoever')", () => {
    // node:fs is a sealed ESM namespace under this transform (not spy-able),
    // so prove behaviorally: from a cwd with no node_modules/afi-config,
    // registry mode fails loudly on the default path…
    const originalCwd = process.cwd();
    const isolatedCwd = mkdtempSync(path.join(tmpdir(), "uwr-no-registry-"));
    try {
      process.chdir(isolatedCwd);
      let caught: unknown;
      try {
        resolveUwrRuntimeConfig({ env: { [UWR_PROFILE_SOURCE_ENV]: "registry" } });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UwrRuntimeProfileError);
      expect((caught as UwrRuntimeProfileError).reason).toBe("registry-unreadable");
      // …while builtin mode succeeds from the same sandbox: the default
      // registry path is provably not consulted.
      const resolved = resolveUwrRuntimeConfig({ env: {} });
      expect(resolved.source).toBe("builtin");
      expect(resolved.config).toBe(defaultUwrConfig);
    } finally {
      process.chdir(originalCwd);
      rmSync(isolatedCwd, { recursive: true, force: true });
    }
  });

  it("logs the resolved source in builtin mode (RC-3 'logged')", () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    resolveUwrRuntimeConfig({ env: {} });
    expect(
      infoSpy.mock.calls.some(args => String(args[0]).includes("source=builtin"))
    ).toBe(true);
  });
});

describe("PR-UWR-RUNTIME-READ: registry mode (RC-4 fail-closed, RC-5 identity)", () => {
  const env = { [UWR_PROFILE_SOURCE_ENV]: "registry" };

  it("loads a valid registry document, records the registry source, and logs it (RC-3)", () => {
    const infoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    const registryPath = writeTempRegistry(
      "valid.json",
      JSON.stringify(registryDocument())
    );
    const resolved = resolveUwrRuntimeConfig({ env, registryPath });
    expect(resolved.source).toBe("registry");
    expect(resolved.config).toEqual({
      id: "uwr-weighted-lifts-v0.1",
      structureWeight: 0.25,
      executionWeight: 0.25,
      riskWeight: 0.25,
      insightWeight: 0.25,
    });
    // Re-assert RC-5 value equality per axis (the loader additionally
    // guarantees the values are defaultUwrConfig's own by construction —
    // that property is enforced in afi-core's loader source/tests).
    expect(Object.is(resolved.config.structureWeight, defaultUwrConfig.structureWeight)).toBe(true);
    expect(Object.is(resolved.config.executionWeight, defaultUwrConfig.executionWeight)).toBe(true);
    expect(Object.is(resolved.config.riskWeight, defaultUwrConfig.riskWeight)).toBe(true);
    expect(Object.is(resolved.config.insightWeight, defaultUwrConfig.insightWeight)).toBe(true);
    expect(
      infoSpy.mock.calls.some(args =>
        /source=registry.*uwr-weighted-lifts-v0\.1/.test(String(args[0]))
      )
    ).toBe(true);
  });

  it("fails closed when the registry file is missing (no fallback)", () => {
    const registryPath = path.join(tempDir, "missing.json");
    let caught: unknown;
    try {
      resolveUwrRuntimeConfig({ env, registryPath });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UwrRuntimeProfileError);
    expect((caught as UwrRuntimeProfileError).reason).toBe("registry-unreadable");
    // Operationally clear: the message names the path it tried.
    expect((caught as Error).message).toContain(registryPath);
    expect((caught as Error).message).toContain("fail-closed");
  });

  it("fails closed on unparseable JSON", () => {
    const registryPath = writeTempRegistry("broken.json", "{ not json ");
    let caught: unknown;
    try {
      resolveUwrRuntimeConfig({ env, registryPath });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UwrRuntimeProfileError);
    expect((caught as UwrRuntimeProfileError).reason).toBe("registry-parse-error");
  });

  it("fails closed with the loader's machine-checkable reason on a mismatched profile", () => {
    const drifted = registryDocument();
    (drifted.weights as Record<string, number>).structureWeight = 0.24;
    const registryPath = writeTempRegistry("drifted.json", JSON.stringify(drifted));
    let caught: unknown;
    try {
      resolveUwrRuntimeConfig({ env, registryPath });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UwrProfileLoadError);
    expect((caught as UwrProfileLoadError).reason).toBe("weight-value-mismatch");
  });

  it("fails closed on a wrong profile id", () => {
    const wrongId = registryDocument();
    wrongId.profileId = "uwr-weighted-lifts-v0.2";
    const registryPath = writeTempRegistry("wrong-id.json", JSON.stringify(wrongId));
    let caught: unknown;
    try {
      resolveUwrRuntimeConfig({ env, registryPath });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UwrProfileLoadError);
    expect((caught as UwrProfileLoadError).reason).toBe("profile-id-mismatch");
  });

  it("never silently falls back: a failing registry resolve throws, and only an explicit builtin selection scores", () => {
    const registryPath = path.join(tempDir, "still-missing.json");
    expect(() => resolveUwrRuntimeConfig({ env, registryPath })).toThrow(
      UwrRuntimeProfileError
    );
    // Same call with builtin explicitly selected works — proving the earlier
    // throw was a refusal, not a degraded fallback result.
    const builtin = resolveUwrRuntimeConfig({
      env: { [UWR_PROFILE_SOURCE_ENV]: "builtin" },
      registryPath,
    });
    expect(builtin.source).toBe("builtin");
    expect(builtin.config).toBe(defaultUwrConfig);
  });
});

describe("PR-UWR-RUNTIME-READ: scoring is bit-identical under either source", () => {
  it("computeUwrScore agrees on the UP-5 golden anchor and other vectors", () => {
    const registryPath = writeTempRegistry(
      "identity.json",
      JSON.stringify(registryDocument())
    );
    const { config } = resolveUwrRuntimeConfig(
      { env: { [UWR_PROFILE_SOURCE_ENV]: "registry" }, registryPath }
    );
    const vectors = [
      // D2 M2 golden anchor axes (UP-5): uwrScore must stay 0.1875.
      { structureAxis: 0.15, executionAxis: 0, riskAxis: 0.2, insightAxis: 0.4 },
      { structureAxis: 0.5, executionAxis: 0.5, riskAxis: 0.5, insightAxis: 0.5 },
      { structureAxis: 1, executionAxis: 1, riskAxis: 1, insightAxis: 1 },
      { structureAxis: 0.8, executionAxis: 0.7, riskAxis: 0.9, insightAxis: 0.9 },
    ];
    for (const axes of vectors) {
      expect(
        Object.is(computeUwrScore(axes, config), computeUwrScore(axes, defaultUwrConfig))
      ).toBe(true);
    }
    expect(
      computeUwrScore(
        { structureAxis: 0.15, executionAxis: 0, riskAxis: 0.2, insightAxis: 0.4 },
        config
      )
    ).toBe(0.1875);
  });
});

describe("PR-UWR-RUNTIME-READ: composition-root memoization (real env pathway)", () => {
  it("getUwrRuntimeConfigOnce resolves once and caches (builtin default)", () => {
    const first = getUwrRuntimeConfigOnce();
    const second = getUwrRuntimeConfigOnce();
    expect(first.source).toBe("builtin");
    expect(second).toBe(first);
  });

  it("getUwrRuntimeConfigOnce fails closed on an invalid env flag, on every call", () => {
    process.env[UWR_PROFILE_SOURCE_ENV] = "not-a-source";
    expect(() => getUwrRuntimeConfigOnce()).toThrow(UwrRuntimeProfileError);
    // Failures are never cached: the second call re-attempts and re-throws.
    expect(() => getUwrRuntimeConfigOnce()).toThrow(UwrRuntimeProfileError);
  });

  const maybeRegistryIt = existsSync(INSTALLED_REGISTRY) || process.env.CI ? it : it.skip;
  maybeRegistryIt(
    "getUwrRuntimeConfigOnce honors AFI_UWR_PROFILE_SOURCE=registry end-to-end",
    () => {
      process.env[UWR_PROFILE_SOURCE_ENV] = "registry";
      const resolved = getUwrRuntimeConfigOnce();
      expect(resolved.source).toBe("registry");
      expect(resolved.config.id).toBe("uwr-weighted-lifts-v0.1");
    }
  );
});

describe("PR-UWR-RUNTIME-READ: installed afi-config registry (file: dependency)", () => {
  // The default path resolves through node_modules/afi-config (file: link).
  // Present on dev machines and wherever npm ci ran. In CI this test must
  // RUN (a missing installed registry there is a loud failure, not a silent
  // skip); elsewhere it skips cleanly.
  const maybeIt = existsSync(INSTALLED_REGISTRY) || process.env.CI ? it : it.skip;

  maybeIt("the real installed registry document loads through the RC-5 predicate", () => {
    const resolved = resolveUwrRuntimeConfig({
      env: { [UWR_PROFILE_SOURCE_ENV]: "registry" },
    });
    expect(resolved.source).toBe("registry");
    expect(resolved.config.id).toBe("uwr-weighted-lifts-v0.1");
    // And the on-disk document's consumed fields match this suite's mirror.
    const installed = JSON.parse(readFileSync(INSTALLED_REGISTRY, "utf8"));
    const mirror = registryDocument();
    expect(installed.profileId).toBe(mirror.profileId);
    expect(installed.supersedes).toBe(mirror.supersedes);
    expect(installed.axes).toEqual(mirror.axes);
    expect(installed.weights).toEqual(mirror.weights);
  });
});

describe("PR-UWR-RUNTIME-READ: source guardrails (module containment)", () => {
  /** Recursively scan .ts files under dir; return relative paths whose content matches. */
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

  it("the D2 pipehead/CLI surfaces never reference the runtime profile module", () => {
    // The pre-existing pipehead/cli ban regex (/uwrProfile|uwrProfilePin|
    // UWR_PROFILE_/) does not match 'uwrRuntimeProfile' identifiers — this
    // scan closes that gap WITHOUT amending the RC-7-governed bans: the
    // golden-hashed surfaces must stay flag-ignorant.
    for (const dir of ["src/pipeheads", "src/cli"]) {
      const abs = path.resolve(REPO_ROOT, dir);
      if (!existsSync(abs)) continue;
      const offenders = scanTsTree(abs, content =>
        /uwrRuntimeProfile|UwrRuntime/.test(content)
      );
      expect(offenders).toEqual([]);
    }
  });

  it("no other src/ module imports the registry path constant (string-scan bypass ban)", () => {
    // Importing UWR_REGISTRY_RELATIVE_PATH and reading the file directly
    // would bypass the 'registries/uwr-profiles' string scan. Only the
    // authorized loader module may carry the constant's name.
    const AUTHORIZED_LOADER_MODULE = "src/config/uwrRuntimeProfile.ts";
    const offenders = scanTsTree(path.resolve(REPO_ROOT, "src"), content =>
      content.includes("UWR_REGISTRY_RELATIVE_PATH")
    ).filter(rel => rel !== AUTHORIZED_LOADER_MODULE);
    expect(offenders).toEqual([]);
  });
});

describe("PR-UWR-RUNTIME-READ: plugin call-site equivalence (the changed consumer)", () => {
  /** Minimal-but-representative enriched view; adapter defaults cover the rest. */
  function enrichedFixture(): FroggyEnrichedView {
    return {
      signalId: "sig-uwr-runtime-read-test",
      symbol: "BTCUSDT",
      market: "crypto",
      timeframe: "4h",
      technical: {
        emaDistancePct: 1.5,
        isInValueSweetSpot: true,
        brokeEmaWithBody: false,
      },
      pattern: { patternName: "bull flag", patternConfidence: 80 },
      sentiment: { score: 0.4, tags: ["liquidity sweep"] },
    };
  }

  function normalized(analysis: unknown) {
    const clone = JSON.parse(JSON.stringify(analysis)) as {
      analystScore?: Record<string, unknown>;
    };
    // scoredAt is the sole nondeterministic field (new Date().toISOString()).
    if (clone.analystScore) delete clone.analystScore.scoredAt;
    return clone;
  }

  it("builtin default: plugin run() output is identical to scoreFroggyTrendPullbackFromEnriched", async () => {
    const enriched = enrichedFixture();
    const viaPlugin = await runScorer(enriched);
    const reference = scoreFroggyTrendPullbackFromEnriched(enrichedFixture());
    expect(normalized(viaPlugin.analysis)).toEqual(normalized(reference));
    // No response-contract leakage: output shape = enriched + analysis +
    // uwrResolvedSource only. (uwrResolvedSource was added by
    // PR-UWR-STAMP-SEMANTICS — uwr-runtime-consumption-v0.1.md §7 row
    // flipped via afi-governance PR #13 — to propagate the RC-6 source to
    // the vault-write stamp; graphScoringService copies enumerated fields
    // into the response contract, so this plugin-boundary field never
    // reaches ReactorScoredSignalV1.)
    expect(Object.keys(viaPlugin).sort()).toEqual(
      [...Object.keys(enriched), "analysis", "uwrResolvedSource"].sort()
    );
    // RC-6 propagation: builtin resolution flows to the stamp as-is.
    expect(viaPlugin.uwrResolvedSource).toBe("builtin");
    // Stamp inputs unchanged: same UP-10 identity flows to uwrProfileStampFor.
    expect(viaPlugin.analysis.analystScore.analystId).toBe("froggy");
    expect(viaPlugin.analysis.analystScore.strategyId).toBe("trend_pullback_v1");
  });

  const maybeRegistryIt = existsSync(INSTALLED_REGISTRY) || process.env.CI ? it : it.skip;
  maybeRegistryIt(
    "registry mode: plugin run() output is STILL identical (value identity end-to-end)",
    async () => {
      process.env[UWR_PROFILE_SOURCE_ENV] = "registry";
      __resetUwrRuntimeConfigForTests();
      const viaPlugin = await runScorer(enrichedFixture());
      const reference = scoreFroggyTrendPullbackFromEnriched(enrichedFixture());
      expect(normalized(viaPlugin.analysis)).toEqual(normalized(reference));
      // RC-6 propagation: a successful registry resolution — and only a
      // successful one; failure throws before scoring — flows to the stamp.
      expect(viaPlugin.uwrResolvedSource).toBe("registry");
    }
  );
});
