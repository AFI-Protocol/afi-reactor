/**
 * Boot-validation integration (W3 spec section 3 + task item 8): the server
 * REFUSES TO START on an invalid active registry. src/server.ts calls
 * initRuntimeComposition() before listen() (asserted by source scan in
 * test/guardrails/no-hardcoded-composition.test.ts); here the unit seam
 * proves that call throws on every invalid-root shape and initializes the
 * executor-backed composition on a valid one.
 */
import { jest } from "@jest/globals";

// ccxt's compiled dist pulls ESM-only crypto deps jest cannot parse (repo
// idiom — see test/oracle/*.test.ts). No ccxt request is ever issued.
jest.mock("ccxt", () => {
  class UnusedExchange {}
  return {
    __esModule: true,
    default: { blofin: UnusedExchange, coinbase: UnusedExchange },
  };
});

import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getRuntimeComposition,
  initRuntimeComposition,
  __resetRuntimeCompositionForTests,
  __setRuntimeCompositionOverridesForTests,
} from "../../src/config/runtimeComposition.js";
import { RuntimeConfigValidationError } from "../../src/pipeline/registryLoader.js";
import { FIXTURE_CONFIG_ROOT } from "./support/testHarness.js";

afterEach(() => {
  __resetRuntimeCompositionForTests();
});

describe("runtime composition boot gate (server refuses to start on invalid registries)", () => {
  it("initializes the executor-backed composition over a valid registry root", () => {
    __setRuntimeCompositionOverridesForTests({ configRoot: FIXTURE_CONFIG_ROOT });
    const composition = initRuntimeComposition();
    expect([...composition.runtime.strategies.keys()]).toEqual([
      "froggy/trend_pullback_v1@1.0.0",
    ]);
    expect(composition.executor).toBeDefined();
    // lazy accessor returns the SAME initialized composition
    expect(getRuntimeComposition()).toBe(composition);
  });

  it("REFUSES on a missing registry root (throw at boot — no lazy discovery)", () => {
    const empty = mkdtempSync(join(tmpdir(), "afi-reactor-boot-empty-"));
    try {
      __setRuntimeCompositionOverridesForTests({ configRoot: empty });
      expect(() => initRuntimeComposition()).toThrow(RuntimeConfigValidationError);
      // the lazy request-path accessor refuses identically (never serves)
      expect(() => getRuntimeComposition()).toThrow(RuntimeConfigValidationError);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("REFUSES on an invalid ACTIVE registry entry (hash mismatch)", () => {
    const root = mkdtempSync(join(tmpdir(), "afi-reactor-boot-invalid-"));
    try {
      cpSync(FIXTURE_CONFIG_ROOT, root, { recursive: true });
      const regPath = join(
        root,
        "registries/analyst-strategies/froggy--trend_pullback_v1--1.0.0.json"
      );
      const reg = JSON.parse(readFileSync(regPath, "utf8"));
      reg.analystConfigHash.value = reg.analystConfigHash.value.replace(/^./, "0");
      writeFileSync(regPath, JSON.stringify(reg, null, 2));

      __setRuntimeCompositionOverridesForTests({ configRoot: root });
      expect(() => initRuntimeComposition()).toThrow(/analystConfigHash mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
