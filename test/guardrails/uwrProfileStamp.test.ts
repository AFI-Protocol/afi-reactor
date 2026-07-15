/**
 * PR-UWR-STAMP tests (uwr-profile-pin-v0.1.md §7).
 *
 * Stamp-shape and wiring assertions amended by PR-UWR-STAMP-SEMANTICS
 * exactly per RC-7 grant (2) (uwr-runtime-consumption-v0.1.md §7 row flipped
 * by owner merge of afi-governance PR #13, merge commit 6b3638b): the stamp
 * now carries the RC-6 source discriminator, propagated explicitly from the
 * composition path. The registry-path ban (RC-7 grant 1 form), the
 * pipehead/CLI bans, and the test-only sibling cross-check are UNCHANGED.
 *
 * Verifies the UWR profile stamp helper (uwrProfileStampFor):
 *   1. the pinned constants match the governed profile (UP-2);
 *   2. the stamp is conditional on the UP-10-recognized scorer identity —
 *      unrecognized identities are never stamped;
 *   3. (dev/CI with sibling checkout) the hardcoded pin is value-identical
 *      to the afi-config registry instance — WITHOUT any runtime registry
 *      read: this cross-check lives in tests only (UP-12);
 *   4. registry-path boundary: only the authorized loader module references the
 *      registry path; the stamp stays OUT of the D2 pipehead surface, whose
 *      goldens must remain byte-stable (UP-5/UP-11).
 *
 * NOTE (live-beta hardening): the stamp's former persistence site — the legacy
 * Reactor scored-signal vault document — has been deleted. uwrProfileStampFor is
 * retained + tested but is now runtime-orphaned; the two "vault-write site"
 * source-scan guardrails were removed. Re-homing the stamp onto the canonical
 * afi.scored-signal-evidence.v1 record needs a governed afi-config schema change
 * (owner decision).
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
  // RC-7 grant (2): the exact-shape stamp equality is UPDATED to reflect the
  // RC-6 source discriminator (the stamp now carries `source`, and the
  // builder now takes the resolved source). The remaining UP-10
  // conditionality cases are unchanged in intent — only the required source
  // argument is threaded through (a mechanical signature adaptation). The
  // richer RC-6 coverage (both discriminator values, cross-source identity,
  // the throw-on-unknown-source condition, and the plugin propagation) lives
  // in the slot's own file test/guardrails/uwrStampSemantics.test.ts, so
  // this RC-7-governed file changes only what the grant names.
  it("stamps the recognized scorer identity (exact shape, incl. RC-6 source)", () => {
    const stamp = uwrProfileStampFor({ ...RECOGNIZED }, "builtin");
    expect(stamp).toEqual({
      profileId: "uwr-weighted-lifts-v0.1",
      status: "testnet-provisional",
      decisionRef: "afi-governance/decisions/uwr-profile-pin-v0.1.md",
      source: "builtin-value-identity",
    });
  });

  it("stamps when extra analyst-score fields are present (e.g. strategyVersion)", () => {
    const stamp = uwrProfileStampFor(
      {
        ...RECOGNIZED,
        strategyVersion: "1.0.0",
        uwrScore: 0.5,
      } as any,
      "builtin"
    );
    expect(stamp?.profileId).toBe(UWR_PROFILE_ID);
  });

  it("does NOT stamp a different analystId — recognition was never granted (UP-10)", () => {
    expect(
      uwrProfileStampFor({ ...RECOGNIZED, analystId: "other-analyst" }, "builtin")
    ).toBeUndefined();
  });

  it("does NOT stamp a different strategyId", () => {
    expect(
      uwrProfileStampFor(
        { ...RECOGNIZED, strategyId: "other_strategy_v9" },
        "builtin"
      )
    ).toBeUndefined();
  });

  it("does NOT stamp missing/absent identities", () => {
    expect(uwrProfileStampFor(null, "builtin")).toBeUndefined();
    expect(uwrProfileStampFor(undefined, "builtin")).toBeUndefined();
    expect(uwrProfileStampFor({}, "builtin")).toBeUndefined();
    expect(uwrProfileStampFor({ analystId: "froggy" }, "builtin")).toBeUndefined();
    expect(
      uwrProfileStampFor({ strategyId: "trend_pullback_v1" }, "builtin")
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

  // NOTE (live-beta hardening): the former "vault-write construction site wires
  // the stamp" guardrail was removed together with the legacy Reactor
  // scored-signal vault write it scanned for. The UWR profile stamp
  // (uwrProfileStampFor) is retained and unit-tested below, but is currently
  // runtime-orphaned (its only persistence site was deleted); re-homing it on
  // the canonical afi.scored-signal-evidence.v1 record needs a governed
  // afi-config schema change — flagged for the owner.

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
