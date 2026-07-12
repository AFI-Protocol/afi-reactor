/**
 * PR-UWR-STAMP tests (uwr-profile-pin-v0.1.md §7).
 *
 * Verifies the UWR profile stamp that froggyDemoService writes into
 * persisted ReactorScoredSignalDocument records:
 *   1. the pinned constants match the governed profile (UP-2);
 *   2. the stamp is conditional on the UP-10-recognized scorer identity —
 *      unrecognized identities are never stamped;
 *   3. (dev/CI with sibling checkout) the hardcoded pin is value-identical
 *      to the afi-config registry instance — WITHOUT any runtime registry
 *      read: this cross-check lives in tests only (UP-12);
 *   4. source guardrails: the stamp is wired at the vault-write construction
 *      site and stays OUT of the D2 pipehead surface, whose goldens must
 *      remain byte-stable (UP-5/UP-11).
 *
 * Scope framing: stamping is traceability metadata only. It does not wire
 * the qualification gate, create reward eligibility, or touch mint paths —
 * each remains separately authorized (§6/§7).
 */

import { describe, it, expect } from "@jest/globals";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  UWR_PROFILE_ID,
  UWR_PROFILE_STATUS,
  UWR_PROFILE_DECISION_REF,
  UWR_PROFILE_SCORER_IDENTITY,
  uwrProfileStampFor,
} from "../../src/config/uwrProfilePin.js";

// Repo idiom (see test/pipeheads/*.test.ts): jest runs from the repo root.
const REPO_ROOT = process.cwd();
const SIBLING_REGISTRY = path.resolve(
  REPO_ROOT,
  "../afi-config/registries/uwr-profiles/uwr-weighted-lifts-v0.1.json"
);

const RECOGNIZED = {
  analystId: "froggy",
  strategyId: "trend_pullback_v1",
};

describe("PR-UWR-STAMP: pinned constants", () => {
  it("pins the governed profile id (UP-2)", () => {
    expect(UWR_PROFILE_ID).toBe("uwr-weighted-lifts-v0.1");
  });

  it("pins testnet-provisional status and the decision ref", () => {
    expect(UWR_PROFILE_STATUS).toBe("testnet-provisional");
    expect(UWR_PROFILE_DECISION_REF).toBe(
      "afi-governance/decisions/uwr-profile-pin-v0.1.md"
    );
  });

  it("pins the UP-10 scorer identity", () => {
    expect(UWR_PROFILE_SCORER_IDENTITY).toEqual(RECOGNIZED);
  });
});

describe("PR-UWR-STAMP: uwrProfileStampFor (UP-10 conditionality)", () => {
  it("stamps the recognized scorer identity", () => {
    const stamp = uwrProfileStampFor({ ...RECOGNIZED });
    expect(stamp).toEqual({
      profileId: "uwr-weighted-lifts-v0.1",
      status: "testnet-provisional",
      decisionRef: "afi-governance/decisions/uwr-profile-pin-v0.1.md",
    });
  });

  it("stamps when extra analyst-score fields are present (e.g. strategyVersion)", () => {
    const stamp = uwrProfileStampFor({
      ...RECOGNIZED,
      strategyVersion: "1.0.0",
      uwrScore: 0.5,
    } as any);
    expect(stamp?.profileId).toBe(UWR_PROFILE_ID);
  });

  it("does NOT stamp a different analystId — recognition was never granted (UP-10)", () => {
    expect(
      uwrProfileStampFor({ ...RECOGNIZED, analystId: "other-analyst" })
    ).toBeUndefined();
  });

  it("does NOT stamp a different strategyId", () => {
    expect(
      uwrProfileStampFor({ ...RECOGNIZED, strategyId: "other_strategy_v9" })
    ).toBeUndefined();
  });

  it("does NOT stamp missing/absent identities", () => {
    expect(uwrProfileStampFor(null)).toBeUndefined();
    expect(uwrProfileStampFor(undefined)).toBeUndefined();
    expect(uwrProfileStampFor({})).toBeUndefined();
    expect(uwrProfileStampFor({ analystId: "froggy" })).toBeUndefined();
    expect(
      uwrProfileStampFor({ strategyId: "trend_pullback_v1" })
    ).toBeUndefined();
  });
});

describe("PR-UWR-STAMP: value-identity with the afi-config registry (test-only read)", () => {
  // Runs on dev machines and in CI (validate-all.yml checks out afi-config
  // as a sibling); skips cleanly elsewhere. This is a TEST-ONLY read — the
  // runtime stamp is a hardcoded constant and must never read the registry
  // (runtime consumption requires its own separate authorization, UP-12).
  const maybeIt = existsSync(SIBLING_REGISTRY) ? it : it.skip;

  maybeIt("hardcoded pin matches the registered profile instance", () => {
    const registry = JSON.parse(readFileSync(SIBLING_REGISTRY, "utf8"));
    expect(registry.profileId).toBe(UWR_PROFILE_ID);
    expect(registry.status).toBe(UWR_PROFILE_STATUS);
    expect(registry.scorerIdentity.analystId).toBe(
      UWR_PROFILE_SCORER_IDENTITY.analystId
    );
    expect(registry.scorerIdentity.strategyId).toBe(
      UWR_PROFILE_SCORER_IDENTITY.strategyId
    );
  });
});

describe("PR-UWR-STAMP: source guardrails", () => {
  const read = (rel: string) =>
    readFileSync(path.resolve(REPO_ROOT, rel), "utf8");

  it("vault-write construction site wires the stamp conditionally", () => {
    const src = read("src/services/froggyDemoService.ts");
    expect(src).toContain('from "../config/uwrProfilePin.js"');
    expect(src).toContain("uwrProfileStampFor(");
    // Conditional spread: absent field, never a persisted null.
    expect(src).toMatch(/uwrProfile \? \{ uwrProfile \} : \{\}/);
  });

  it("runtime does not read the uwr-profiles registry (UP-12 boundary)", () => {
    // The registry path must not appear anywhere under src/ — the pin is a
    // hardcoded constant; registry consumption is separately authorized.
    const offenders = scanTree(path.resolve(REPO_ROOT, "src"), content =>
      content.includes("registries/uwr-profiles")
    );
    expect(offenders).toEqual([]);
  });

  it("the stamp stays out of the D2 pipehead surface (golden byte-stability, UP-5/UP-11)", () => {
    // The D2 M2 goldens hash the ScoredSignal v1 projection built under
    // src/pipeheads. The stamp must never enter that surface.
    for (const dir of ["src/pipeheads", "src/cli"]) {
      const abs = path.resolve(REPO_ROOT, dir);
      if (!existsSync(abs)) continue;
      const offenders = scanTree(abs, content =>
        /uwrProfile|uwrProfilePin|UWR_PROFILE_/.test(content)
      );
      expect(offenders).toEqual([]);
    }
  });
});

/** Recursively scan .ts files under dir; return relative paths whose content matches. */
function scanTree(dir: string, matches: (content: string) => boolean): string[] {
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
