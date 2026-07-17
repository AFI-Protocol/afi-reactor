/**
 * PR-UWR-STAMP tests (uwr-profile-pin-v0.1.md §7).
 *
 * Amended by FCP-GOV (afi-governance/decisions/factory-configurable-pipelines-v1.md
 * §14 — the RC-7 "amending this standing guardrail test is a governance act"
 * provision names THAT decision as the act for exactly one bounded change):
 * the froggy-only `UWR_PROFILE_SCORER_IDENTITY` gate assertions are replaced
 * by REGISTRY-BACKED (D-FCP-5) stamp-resolution assertions — a stamp is
 * issued iff the resolved registration's uwrProfileRef names a registered
 * profile AND the scorer identity triple matches the registration. Everything
 * else the grant preserves is asserted UNCHANGED below:
 *   - the RC-6 `source` discriminator vocabulary and meaning
 *     ('builtin-value-identity' / 'registry-consumed');
 *   - the 'registries/uwr-profiles' string ban across src/ (single authorized
 *     loader module);
 *   - the src/pipeheads + src/cli pin-identifier bans (golden byte-stability);
 *   - the pinned profile metadata VALUES (UP-2: profileId / status /
 *     decisionRef unchanged);
 *   - the test-only sibling registry cross-check (UP-12).
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
  UWR_STAMP_SOURCE_BUILTIN,
  UWR_STAMP_SOURCE_REGISTRY,
  REGISTERED_UWR_PROFILE_IDS,
  uwrProfileStampFor,
  type RecognizedStrategyRegistration,
} from "../../src/config/uwrProfilePin.js";

// Repo idiom (see test/pipeheads/*.test.ts): jest runs from the repo root.
const REPO_ROOT = process.cwd();
const SIBLING_REGISTRY = path.resolve(
  REPO_ROOT,
  "../afi-config/registries/uwr-profiles/uwr-weighted-lifts-v0.1.json"
);

/** A resolved, boot-validated registration referencing the registered profile. */
const FROGGY_REGISTRATION: RecognizedStrategyRegistration = {
  analystId: "froggy",
  strategyId: "trend_pullback_v1",
  strategyVersion: "1.0.0",
  uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
};

/** A DIFFERENT registered identity — the registry-backed mechanism is generic. */
const ATLAS_REGISTRATION: RecognizedStrategyRegistration = {
  analystId: "atlas-probe",
  strategyId: "multi_branch_v1",
  strategyVersion: "1.0.0",
  uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
};

const FROGGY_SCORE = {
  analystId: "froggy",
  strategyId: "trend_pullback_v1",
  strategyVersion: "1.0.0",
};

describe("PR-UWR-STAMP: pinned constants (values UNCHANGED by FCP-GOV)", () => {
  it("pins the governed profile id (UP-2)", () => {
    expect(UWR_PROFILE_ID).toBe("uwr-weighted-lifts-v0.1");
  });

  it("pins testnet-provisional status and the decision ref", () => {
    expect(UWR_PROFILE_STATUS).toBe("testnet-provisional");
    expect(UWR_PROFILE_DECISION_REF).toBe(
      "afi-governance/decisions/uwr-profile-pin-v0.1.md"
    );
  });

  it("the registered-profile set contains exactly the pinned profile (registering another is a governance act)", () => {
    expect([...REGISTERED_UWR_PROFILE_IDS]).toEqual(["uwr-weighted-lifts-v0.1"]);
  });

  it("the RC-6 source vocabulary is exactly the governed pair (meaning preserved verbatim)", () => {
    expect(UWR_STAMP_SOURCE_BUILTIN).toBe("builtin-value-identity");
    expect(UWR_STAMP_SOURCE_REGISTRY).toBe("registry-consumed");
  });
});

describe("PR-UWR-STAMP: registry-backed recognition (D-FCP-5, replaces the froggy-only gate)", () => {
  it("stamps a recognized registration + matching identity (exact shape, incl. RC-6 source)", () => {
    const stamp = uwrProfileStampFor({ ...FROGGY_SCORE }, "builtin", FROGGY_REGISTRATION);
    expect(stamp).toEqual({
      profileId: "uwr-weighted-lifts-v0.1",
      status: "testnet-provisional",
      decisionRef: "afi-governance/decisions/uwr-profile-pin-v0.1.md",
      source: "builtin-value-identity",
    });
  });

  it("stamps ANY registered identity whose registration references the registered profile (no froggy conditional)", () => {
    const stamp = uwrProfileStampFor(
      { analystId: "atlas-probe", strategyId: "multi_branch_v1", strategyVersion: "1.0.0" },
      "registry",
      ATLAS_REGISTRATION
    );
    expect(stamp).toEqual({
      profileId: "uwr-weighted-lifts-v0.1",
      status: "testnet-provisional",
      decisionRef: "afi-governance/decisions/uwr-profile-pin-v0.1.md",
      source: "registry-consumed",
    });
  });

  it("stamps when extra analyst-score fields are present (e.g. uwrScore)", () => {
    const stamp = uwrProfileStampFor(
      { ...FROGGY_SCORE, uwrScore: 0.5 } as never,
      "builtin",
      FROGGY_REGISTRATION
    );
    expect(stamp?.profileId).toBe(UWR_PROFILE_ID);
  });

  it("does NOT stamp without a resolved registration (recognition is never silent)", () => {
    expect(uwrProfileStampFor({ ...FROGGY_SCORE }, "builtin", undefined)).toBeUndefined();
    expect(uwrProfileStampFor({ ...FROGGY_SCORE }, "builtin", null)).toBeUndefined();
  });

  it("does NOT stamp a registration referencing an UNREGISTERED profile", () => {
    expect(
      uwrProfileStampFor({ ...FROGGY_SCORE }, "builtin", {
        ...FROGGY_REGISTRATION,
        uwrProfileRef: { profileId: "uwr-unregistered-v9" },
      })
    ).toBeUndefined();
  });

  it("does NOT stamp a scorer identity that mismatches the registration triple", () => {
    expect(
      uwrProfileStampFor(
        { ...FROGGY_SCORE, analystId: "other-analyst" },
        "builtin",
        FROGGY_REGISTRATION
      )
    ).toBeUndefined();
    expect(
      uwrProfileStampFor(
        { ...FROGGY_SCORE, strategyId: "other_strategy_v9" },
        "builtin",
        FROGGY_REGISTRATION
      )
    ).toBeUndefined();
    expect(
      uwrProfileStampFor(
        { ...FROGGY_SCORE, strategyVersion: "9.9.9" },
        "builtin",
        FROGGY_REGISTRATION
      )
    ).toBeUndefined();
  });

  it("does NOT stamp missing/absent identities", () => {
    expect(uwrProfileStampFor(null, "builtin", FROGGY_REGISTRATION)).toBeUndefined();
    expect(uwrProfileStampFor(undefined, "builtin", FROGGY_REGISTRATION)).toBeUndefined();
    expect(uwrProfileStampFor({}, "builtin", FROGGY_REGISTRATION)).toBeUndefined();
    expect(
      uwrProfileStampFor({ analystId: "froggy" }, "builtin", FROGGY_REGISTRATION)
    ).toBeUndefined();
    expect(
      uwrProfileStampFor({ strategyId: "trend_pullback_v1" }, "builtin", FROGGY_REGISTRATION)
    ).toBeUndefined();
  });
});

describe("PR-UWR-STAMP: value-identity with the afi-config registry (test-only read)", () => {
  // Runs on dev machines and in CI (validate-all.yml checks out afi-config
  // as a sibling); skips cleanly elsewhere. This is a TEST-ONLY read — the
  // runtime stamp metadata is a hardcoded constant and must never read the
  // uwr-profiles registry (runtime consumption keeps its own authorized
  // loader, UP-12 / RC-7 grant 1).
  const maybeIt = existsSync(SIBLING_REGISTRY) ? it : it.skip;

  maybeIt("hardcoded pin matches the registered profile instance", () => {
    const registry = JSON.parse(readFileSync(SIBLING_REGISTRY, "utf8"));
    expect(registry.profileId).toBe(UWR_PROFILE_ID);
    expect(registry.status).toBe(UWR_PROFILE_STATUS);
  });
});

describe("PR-UWR-STAMP: source guardrails (PRESERVED unchanged by FCP-GOV §14)", () => {
  const read = (rel: string) =>
    readFileSync(path.resolve(REPO_ROOT, rel), "utf8");

  it("only the authorized loader module references the uwr-profiles registry (UP-12 boundary, RC-7 grant 1)", () => {
    // PR-UWR-RUNTIME-READ (uwr-runtime-consumption-v0.1.md §7 row flipped
    // 2026-07-13; RC-7 grant 1): the single authorized loader module may
    // reference the registry path; everywhere else under src/ stays banned.
    // The stamp pin itself (uwrProfilePin.ts) remains a hardcoded constant.
    const AUTHORIZED_LOADER_MODULE = "src/config/uwrRuntimeProfile.ts";
    const offenders = scanTree(path.resolve(REPO_ROOT, "src"), content =>
      content.includes("registries/uwr-profiles")
    ).filter(rel => rel !== AUTHORIZED_LOADER_MODULE);
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

  it("no froggy-only identity conditional remains in the stamp module (FCP-GOV D-FCP-9 item 5)", () => {
    const src = read("src/config/uwrProfilePin.ts");
    expect(src).not.toContain("UWR_PROFILE_SCORER_IDENTITY");
    // Recognition is registry-backed: the module names no analyst identity.
    expect(/analystId\s*[:=]\s*["']froggy["']/.test(src)).toBe(false);
    expect(/strategyId\s*[:=]\s*["']trend_pullback_v1["']/.test(src)).toBe(false);
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
