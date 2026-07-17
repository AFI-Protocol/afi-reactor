/**
 * PR-UWR-STAMP-SEMANTICS tests (uwr-runtime-consumption-v0.1.md §7 row
 * flipped by owner merge of afi-governance PR #13, merge commit 6b3638b;
 * RC-6 + RC-7 grant 2).
 *
 * Verifies the RC-6 source discriminator end-to-end through the REAL
 * composition path (the froggy plugin resolves the config, scores, and
 * propagates the resolved source; uwrProfileStampFor turns it into the
 * persisted discriminator):
 *   1. builtin (default) mode stamps "builtin-value-identity";
 *   2. registry mode stamps "registry-consumed" — and can only do so after
 *      the registry was successfully read AND RC-5-validated, because a
 *      failed resolution throws before any scoring (RC-4 fail-closed);
 *   3. failed resolution (invalid flag; unreadable registry) rejects the
 *      scoring run entirely — no analysis, no record, no stamp — and a
 *      subsequent honest builtin run stamps builtin, never registry;
 *   4. profile identity/value metadata (profileId/status/decisionRef) is
 *      preserved bit-for-bit in both modes; only `source` differs.
 *
 * Scope framing: the discriminator is persisted-record metadata only
 * (RC-6). It changes no scoring values (UP-5 anchor asserted below), no
 * response contract, no golden surface; qualification, reward, mint, and
 * settlement remain untouched and separately governed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from "@jest/globals";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getUwrRuntimeConfigOnce,
  resolveUwrRuntimeConfig,
  __resetUwrRuntimeConfigForTests,
  UwrRuntimeProfileError,
  UWR_PROFILE_SOURCE_ENV,
  UWR_REGISTRY_RELATIVE_PATH,
} from "../../src/config/uwrRuntimeProfile.js";
import {
  UWR_PROFILE_ID,
  UWR_PROFILE_STATUS,
  UWR_PROFILE_DECISION_REF,
  UWR_STAMP_SOURCE_BUILTIN,
  UWR_STAMP_SOURCE_REGISTRY,
  uwrProfileStampFor,
  type RecognizedStrategyRegistration,
} from "../../src/config/uwrProfilePin.js";
import type { UwrProfileStamp } from "../../src/types/ReactorScoredSignalV1.js";
import type { FroggyEnrichedView } from "../../node_modules/afi-core/analysts/froggy.enrichment_adapter.js";
import { scorerFroggyTrendPullbackNode } from "../../src/pipeline/nodes/scorerFroggyTrendPullback.js";
import { SILENT_NODE_LOGGER, type NodeRunContext } from "../../src/pipeline/nodeSdk.js";

// Repo idiom (see test/pipeheads/*.test.ts): jest runs from the repo root.
const REPO_ROOT = process.cwd();
const INSTALLED_REGISTRY = path.resolve(REPO_ROOT, UWR_REGISTRY_RELATIVE_PATH);

const RECOGNIZED = {
  analystId: "froggy",
  strategyId: "trend_pullback_v1",
};

// FCP-GOV D-FCP-9 item 5: recognition is REGISTRY-BACKED — the stamp site
// consumes the resolved, boot-validated analyst-strategy registration
// (triple + uwrProfileRef) instead of a hardcoded froggy identity gate.
const RECOGNIZED_REGISTRATION: RecognizedStrategyRegistration = {
  analystId: "froggy",
  strategyId: "trend_pullback_v1",
  strategyVersion: "1.0.0",
  uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
};

/** The LIVE scoring seam (D-FCP-9: the old froggy analyst plugin is deleted;
 * the scorer node composes the identical afi-core kernels and emits the
 * identical {…enriched, analysis, uwrResolvedSource} envelope). */
type ScoredEnvelope = FroggyEnrichedView & {
  analysis: {
    analystScore: {
      analystId?: string;
      strategyId?: string;
      uwrScore?: number;
      uwrAxes?: Record<string, number>;
    };
  };
  uwrResolvedSource: "builtin" | "registry";
};

function nodeCtx(): NodeRunContext {
  return {
    signal: {
      schema: "afi.usignal.v1.1",
      provenance: {
        source: "test",
        providerId: "uwr-stamp-semantics-test-provider",
        signalId: "sig-uwr-stamp-semantics-test",
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

/** Same minimal-but-representative enriched view as uwrRuntimeProfile.test.ts. */
function enrichedFixture(): FroggyEnrichedView {
  return {
    signalId: "sig-uwr-stamp-semantics-test",
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

/** Mirrors how the canonical evidence stamp site consumes the composition
 * path's output: stampFor(analystScore, PROPAGATED source, RESOLVED
 * registration) — the source is never re-derived here, and recognition is
 * registry-backed (src/evidence/reactorEvidenceRecord.ts passes the resolved
 * registration of the executed strategy). */
function stampFromPluginOutput(analyzed: {
  analysis: { analystScore: { analystId?: string; strategyId?: string } };
  uwrResolvedSource: "builtin" | "registry";
}): UwrProfileStamp | undefined {
  return uwrProfileStampFor(
    analyzed.analysis.analystScore,
    analyzed.uwrResolvedSource,
    RECOGNIZED_REGISTRATION
  );
}

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "uwr-stamp-semantics-"));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Hygiene both directions (same discipline as uwrRuntimeProfile.test.ts).
  __resetUwrRuntimeConfigForTests();
  delete process.env[UWR_PROFILE_SOURCE_ENV];
});

afterEach(() => {
  __resetUwrRuntimeConfigForTests();
  delete process.env[UWR_PROFILE_SOURCE_ENV];
  process.chdir(REPO_ROOT);
  jest.restoreAllMocks();
});

describe("PR-UWR-STAMP-SEMANTICS: builtin (default) mode stamps builtin-value-identity", () => {
  it("end-to-end: plugin scores with builtin and the stamp discriminates builtin", async () => {
    const analyzed = await runScorer(enrichedFixture());
    expect(analyzed.uwrResolvedSource).toBe("builtin");

    const stamp = stampFromPluginOutput(analyzed);
    expect(stamp).toBeDefined();
    expect(stamp!.source).toBe(UWR_STAMP_SOURCE_BUILTIN);
    expect(stamp!.source).toBe("builtin-value-identity");

    // Identity/value metadata preserved (PR-UWR-STAMP fields, unchanged).
    expect(stamp!.profileId).toBe(UWR_PROFILE_ID);
    expect(stamp!.status).toBe(UWR_PROFILE_STATUS);
    expect(stamp!.decisionRef).toBe(UWR_PROFILE_DECISION_REF);
    // (Scoring-value preservation for the golden input is enforced by the
    // byte-stable D2 M2 goldens in test/pipeheads; cross-source value
    // identity for THIS fixture is asserted in the registry-mode test.)
  });
});

describe("PR-UWR-STAMP-SEMANTICS: registry mode stamps registry-consumed only after a successful read", () => {
  const maybeRegistryIt =
    existsSync(INSTALLED_REGISTRY) || process.env.CI ? it : it.skip;

  maybeRegistryIt(
    "end-to-end: successful registry resolution flows to a registry-consumed stamp",
    async () => {
      // Baseline: the SAME fixture scored under builtin (default).
      const builtinAnalyzed = await runScorer(enrichedFixture());
      expect(builtinAnalyzed.uwrResolvedSource).toBe("builtin");

      process.env[UWR_PROFILE_SOURCE_ENV] = "registry";
      __resetUwrRuntimeConfigForTests();

      const analyzed = await runScorer(enrichedFixture());
      // The plugin can only have gotten here if the registry was read and
      // RC-5-validated: resolution is fail-closed (RC-4), so "registry"
      // as a propagated source IS proof of successful consumption.
      expect(analyzed.uwrResolvedSource).toBe("registry");

      const stamp = stampFromPluginOutput(analyzed);
      expect(stamp).toBeDefined();
      expect(stamp!.source).toBe(UWR_STAMP_SOURCE_REGISTRY);
      expect(stamp!.source).toBe("registry-consumed");

      // Identity/value metadata identical to the builtin-mode stamp.
      expect(stamp!.profileId).toBe(UWR_PROFILE_ID);
      expect(stamp!.status).toBe(UWR_PROFILE_STATUS);
      expect(stamp!.decisionRef).toBe(UWR_PROFILE_DECISION_REF);

      // Value identity across sources (RC-5): the same input scores
      // IDENTICALLY under registry and builtin — consumption is provenance,
      // not behavior. Only the discriminator may differ.
      expect(analyzed.analysis.analystScore.uwrScore).toBe(
        builtinAnalyzed.analysis.analystScore.uwrScore
      );
      expect(analyzed.analysis.analystScore.uwrAxes).toEqual(
        builtinAnalyzed.analysis.analystScore.uwrAxes
      );
      expect(stampFromPluginOutput(builtinAnalyzed)!.source).toBe(
        UWR_STAMP_SOURCE_BUILTIN
      );
    }
  );
});

describe("PR-UWR-STAMP-SEMANTICS: failed resolution produces NO stamp (RC-4 × RC-6)", () => {
  it("invalid source flag: the scoring run itself rejects — nothing exists to stamp", async () => {
    process.env[UWR_PROFILE_SOURCE_ENV] = "fallback";
    __resetUwrRuntimeConfigForTests();

    await expect(runScorer(enrichedFixture())).rejects.toThrow(
      UwrRuntimeProfileError
    );
    await expect(runScorer(enrichedFixture())).rejects.toMatchObject({
      reason: "invalid-source-flag",
    });
  });

  it("unreadable registry in registry mode: the scoring run rejects fail-closed — no analysis, no stamp", async () => {
    // Run from a cwd with no node_modules/afi-config: the cwd-anchored
    // registry read cannot succeed, so registry mode must refuse to score.
    process.env[UWR_PROFILE_SOURCE_ENV] = "registry";
    __resetUwrRuntimeConfigForTests();
    process.chdir(tempDir);
    try {
      await expect(runScorer(enrichedFixture())).rejects.toMatchObject({
        reason: "registry-unreadable",
      });
    } finally {
      process.chdir(REPO_ROOT);
    }
  });

  it("after a failed registry attempt, an honest builtin run stamps builtin — never registry", async () => {
    // Failures are never memoized (RC-4): a later builtin resolution must
    // yield a builtin stamp, not echo the earlier registry request.
    process.env[UWR_PROFILE_SOURCE_ENV] = "registry";
    __resetUwrRuntimeConfigForTests();
    process.chdir(tempDir);
    try {
      await expect(runScorer(enrichedFixture())).rejects.toThrow();
    } finally {
      process.chdir(REPO_ROOT);
    }

    delete process.env[UWR_PROFILE_SOURCE_ENV];
    __resetUwrRuntimeConfigForTests();
    const analyzed = await runScorer(enrichedFixture());
    const stamp = stampFromPluginOutput(analyzed);
    expect(stamp!.source).toBe(UWR_STAMP_SOURCE_BUILTIN);
  });

  it("resolver failure means there is no resolved source at all (nothing to propagate)", () => {
    // Belt-and-braces at the resolver layer: a failed registry resolution
    // throws rather than returning any { source } — so no stamp path can
    // ever observe a "registry" source from a failed read.
    expect(() =>
      resolveUwrRuntimeConfig({
        env: { [UWR_PROFILE_SOURCE_ENV]: "registry" },
        registryPath: path.join(tempDir, "does-not-exist.json"),
      })
    ).toThrow(UwrRuntimeProfileError);
  });

  const maybeRegistryIt =
    existsSync(INSTALLED_REGISTRY) || process.env.CI ? it : it.skip;
  maybeRegistryIt(
    "a SUCCESSFUL registry resolution is the only way to observe source=registry",
    () => {
      process.env[UWR_PROFILE_SOURCE_ENV] = "registry";
      __resetUwrRuntimeConfigForTests();
      expect(() => getUwrRuntimeConfigOnce()).not.toThrow();
      expect(getUwrRuntimeConfigOnce().source).toBe("registry");
    }
  );
});

describe("PR-UWR-STAMP-SEMANTICS: discriminator values are the governed RC-6 names, exactly", () => {
  it("builtin-value-identity / registry-consumed (uwr-runtime-consumption-v0.1.md RC-6)", () => {
    expect(UWR_STAMP_SOURCE_BUILTIN).toBe("builtin-value-identity");
    expect(UWR_STAMP_SOURCE_REGISTRY).toBe("registry-consumed");
  });
});

// Pure-function coverage of the RC-6 discriminator in uwrProfileStampFor.
// Kept in THIS slot file (not the RC-7-governed uwrProfileStamp.test.ts,
// which changes only the two assertions RC-7 grant (2) names): both
// discriminator values, cross-source identity, the throw-on-unknown-source
// honesty condition, and the gate-ordering negatives.
describe("PR-UWR-STAMP-SEMANTICS: uwrProfileStampFor source discriminator (unit)", () => {
  it("registry source stamps the exact registry-consumed shape", () => {
    expect(
      uwrProfileStampFor({ ...RECOGNIZED }, "registry", RECOGNIZED_REGISTRATION)
    ).toEqual({
      profileId: "uwr-weighted-lifts-v0.1",
      status: "testnet-provisional",
      decisionRef: "afi-governance/decisions/uwr-profile-pin-v0.1.md",
      source: "registry-consumed",
    });
  });

  it("identity/value metadata is IDENTICAL across sources — only the discriminator differs", () => {
    const builtin = uwrProfileStampFor({ ...RECOGNIZED }, "builtin", RECOGNIZED_REGISTRATION);
    const registry = uwrProfileStampFor({ ...RECOGNIZED }, "registry", RECOGNIZED_REGISTRATION);
    const { source: b, ...builtinRest } = builtin!;
    const { source: r, ...registryRest } = registry!;
    expect(builtinRest).toEqual(registryRest);
    // profileId/status/decisionRef preserved bit-for-bit (PR-UWR-STAMP).
    expect(builtinRest).toEqual({
      profileId: UWR_PROFILE_ID,
      status: UWR_PROFILE_STATUS,
      decisionRef: UWR_PROFILE_DECISION_REF,
    });
    expect(b).toBe(UWR_STAMP_SOURCE_BUILTIN);
    expect(r).toBe(UWR_STAMP_SOURCE_REGISTRY);
  });

  it("THROWS on an unpropagated/unknown source with a stampable identity (RC-6 honesty)", () => {
    // Omitting the stamp instead would masquerade as a pre-program record.
    expect(() =>
      uwrProfileStampFor({ ...RECOGNIZED }, undefined as any, RECOGNIZED_REGISTRATION)
    ).toThrow(/refusing to stamp/);
    expect(() =>
      uwrProfileStampFor({ ...RECOGNIZED }, "fallback" as any, RECOGNIZED_REGISTRATION)
    ).toThrow(/refusing to stamp/);
  });

  it("the registry-backed identity gate PRECEDES the source discriminator — unrecognized identities never stamp, regardless of source", () => {
    // Pins the ordering (registry-backed form of the former UP-10 gate): an
    // identity that mismatches the resolved registration returns undefined
    // even in registry mode, and even with an unknown source (the identity
    // gate refuses before stampSourceFor could throw). A refactor that
    // discriminated the source first would break exactly these.
    expect(
      uwrProfileStampFor(
        { ...RECOGNIZED, analystId: "other-analyst" },
        "registry",
        RECOGNIZED_REGISTRATION
      )
    ).toBeUndefined();
    expect(
      uwrProfileStampFor(
        { ...RECOGNIZED, strategyId: "other_strategy_v9" },
        "registry",
        RECOGNIZED_REGISTRATION
      )
    ).toBeUndefined();
    expect(
      uwrProfileStampFor(
        { analystId: "other-analyst" },
        "fallback" as any,
        RECOGNIZED_REGISTRATION
      )
    ).toBeUndefined();
    expect(
      uwrProfileStampFor(null, "fallback" as any, RECOGNIZED_REGISTRATION)
    ).toBeUndefined();
    // No registration resolved → nothing is ever stamped (recognition is
    // registry-backed, never silent), regardless of source.
    expect(uwrProfileStampFor({ ...RECOGNIZED }, "registry", undefined)).toBeUndefined();
    expect(
      uwrProfileStampFor({ ...RECOGNIZED }, "fallback" as any, undefined)
    ).toBeUndefined();
  });
});

describe("PR-UWR-STAMP-SEMANTICS: source is PROPAGATED end-to-end, never re-derived", () => {
  const read = (rel: string) =>
    readFileSync(path.resolve(REPO_ROOT, rel), "utf8");

  it("the scorer-node composition path propagates the source it actually scored with", () => {
    // D-FCP-9: the legacy analyst plugin is deleted; the single scoring seam
    // is the scorer category node.
    const src = read("src/pipeline/nodes/scorerFroggyTrendPullback.ts");
    // The propagated value is the resolver's own resolution result — set in
    // the same function that scored with uwrRuntime.config (fail-closed
    // resolution has already succeeded by then), so a "registry" value is
    // proof of successful consumption, not a request.
    expect(src).toContain("uwrResolvedSource: uwrRuntime.source");
  });

  // NOTE (live-beta hardening): the "vault-write stamp site consumes the
  // propagated source" guardrail was removed with the legacy Reactor
  // scored-signal vault write it scanned for. The resolver-side propagation is
  // still asserted above; the stamp's persistence site no longer exists (the
  // stamp is runtime-orphaned pending a governed home — flagged for the owner).
});
