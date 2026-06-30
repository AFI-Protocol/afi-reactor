/**
 * Hardening tests for the normalize pipehead's identity handling
 * (m2-cross-area-end-to-end; per the m1 interfaces-and-lanes scrutiny
 * non-blocking finding).
 *
 * When a required identity field (signalId / symbol / market / timeframe) is
 * missing, non-string, or empty in the validated USS, `normalizeToBundle` must
 * surface a STRUCTURED error (carrying field-level `{field, message}` entries)
 * instead of silently emitting an empty-string identity. The canonical-fixture
 * happy path is unchanged: identity is still carried through verbatim.
 *
 * These tests are pure and offline (no afi-core scorer needed): the lane
 * results come from the real fan-out over the committed OHLCV fixture and only
 * the rawUss identity is varied.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type { AnalysisLaneResult, PipeheadContext } from "../../src/pipeheads/types.js";
import { createFrozenClock } from "../../src/pipeheads/clock.js";
import { fanOut } from "../../src/pipeheads/fanOut.js";
import {
  normalizeToBundle,
  validateBundleIdentity,
  NormalizeIdentityError,
} from "../../src/pipeheads/normalizePipehead.js";

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), rel), "utf-8")) as T;
}

function loadRawUss(): Record<string, unknown> {
  return loadJson<Record<string, unknown>>("test/pipeheads/fixtures/signal.uss.json");
}

function loadOhlcv(): AfiCandle[] {
  return loadJson<AfiCandle[]>("test/pipeheads/fixtures/ohlcv.json");
}

function ctx(rawUss: unknown = loadRawUss()): PipeheadContext {
  return { signalId: "btc-usdt-perp-4h-0001", rawUss, clock: createFrozenClock() };
}

async function laneResults(): Promise<AnalysisLaneResult[]> {
  return fanOut({ candles: loadOhlcv() }, ctx());
}

/** Deep-clone the canonical fixture so each case mutates an isolated copy. */
function cloneUss(): Record<string, unknown> {
  return loadRawUss();
}

describe("normalize identity hardening — happy path unchanged", () => {
  it("carries the canonical fixture identity through verbatim (no throw)", async () => {
    const bundle = normalizeToBundle(await laneResults(), loadRawUss());
    expect(bundle.signalId).toBe("btc-usdt-perp-4h-0001");
    expect(bundle.symbol).toBe("BTC/USDT");
    expect(bundle.market).toBe("perp");
    expect(bundle.timeframe).toBe("4h");
    expect(bundle.provenance?.signalId).toBe("btc-usdt-perp-4h-0001");
  });

  it("validateBundleIdentity reports ok for the canonical fixture", () => {
    const result = validateBundleIdentity(loadRawUss());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity).toEqual({
        signalId: "btc-usdt-perp-4h-0001",
        symbol: "BTC/USDT",
        market: "perp",
        timeframe: "4h",
      });
    }
  });
});

describe("normalize identity hardening — malformed identity is a structured error", () => {
  interface Case {
    name: string;
    mutate: (uss: Record<string, unknown>) => void;
    field: RegExp;
  }

  const cases: Case[] = [
    {
      name: "missing provenance.signalId",
      mutate: (uss) => {
        delete (uss.provenance as Record<string, unknown>).signalId;
      },
      field: /signalId/,
    },
    {
      name: "empty provenance.signalId",
      mutate: (uss) => {
        (uss.provenance as Record<string, unknown>).signalId = "";
      },
      field: /signalId/,
    },
    {
      name: "non-string provenance.signalId",
      mutate: (uss) => {
        (uss.provenance as Record<string, unknown>).signalId = 123;
      },
      field: /signalId/,
    },
    {
      name: "missing facts.symbol",
      mutate: (uss) => {
        delete (uss.facts as Record<string, unknown>).symbol;
      },
      field: /symbol/,
    },
    {
      name: "empty facts.market",
      mutate: (uss) => {
        (uss.facts as Record<string, unknown>).market = "";
      },
      field: /market/,
    },
    {
      name: "non-string facts.timeframe",
      mutate: (uss) => {
        (uss.facts as Record<string, unknown>).timeframe = null;
      },
      field: /timeframe/,
    },
  ];

  for (const { name, mutate, field } of cases) {
    it(`validateBundleIdentity returns a structured failure: ${name}`, () => {
      const uss = cloneUss();
      mutate(uss);
      const result = validateBundleIdentity(uss);
      expect(result.ok).toBe(false);
      const errors = (result as Extract<typeof result, { ok: false }>).errors;
      expect(Array.isArray(errors)).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
      for (const e of errors) {
        expect(typeof e.field).toBe("string");
        expect(e.field.length).toBeGreaterThan(0);
        expect(typeof e.message).toBe("string");
        expect(e.message.length).toBeGreaterThan(0);
      }
      expect(errors.some((e) => field.test(e.field))).toBe(true);
    });

    it(`normalizeToBundle throws a structured NormalizeIdentityError (not empty identity): ${name}`, async () => {
      const results = await laneResults();
      const uss = cloneUss();
      mutate(uss);
      let thrown: unknown;
      try {
        normalizeToBundle(results, uss);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(NormalizeIdentityError);
      const error = thrown as NormalizeIdentityError;
      expect(Array.isArray(error.errors)).toBe(true);
      expect(error.errors.length).toBeGreaterThan(0);
      expect(error.errors.some((e) => field.test(e.field))).toBe(true);
    });
  }

  it("never silently emits an empty-string identity bundle for malformed input", async () => {
    const results = await laneResults();
    const uss = cloneUss();
    (uss.provenance as Record<string, unknown>).signalId = "";
    expect(() => normalizeToBundle(results, uss)).toThrow(NormalizeIdentityError);
  });
});
