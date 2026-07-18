/**
 * ORACLE-EQUIVALENCE — golden captures, FAIL-SOFT environment.
 *
 * Freezes the live behavior of BOTH scored endpoints
 * (POST /api/webhooks/tradingview; POST /api/ingest/cpj) through the REAL
 * shared path — strategy resolution → boot-validated registry composition →
 * GraphExecutor over the registered froggy manifest → the seven category
 * nodes — as committed goldens. Originally captured against the legacy
 * froggyScoringService path; the manifest-driven executor was proven
 * byte-equivalent against these goldens with ONLY the documented intentional
 * diffs (test/oracle/INTENTIONAL_DIFFS.md) regenerated.
 *
 * Deterministic environment (installOracleEnv + disableNetwork):
 *   - AFI_PRICE_FEED_SOURCE=demo → deterministic synthetic candles;
 *   - external providers OFF (no keys provisioned, no TINY_BRAINS_URL) and
 *     global fetch disabled → the REAL lane degradations are exercised
 *     (sentiment lane degraded, the SEC-EDGAR lane's honest empty summary,
 *     aiMl lane degraded) exactly as with no network.
 *
 * Per fixture × {builtin, registry} UWR mode the golden pins:
 *   canonical USS, the EXACT scorer input (FroggyTrendPullbackInput derived by
 *   afi-core's buildFroggyTrendPullbackInputFromEnriched from the enriched
 *   view captured at the analyst-plugin seam — a spy, src untouched),
 *   analystScore (incl. uwrAxes), uwrResolvedSource, decayParams,
 *   inputHash/outputHash (afi.hash.v1 — deterministic for fixed fixtures),
 *   the governed evidence record captured at the store seam, and the HTTP
 *   response envelope — all volatile clock values normalized to '<CLOCK>'
 *   (scoredAt is NOT injectable in the live path).
 *
 * Goldens are regenerated ONLY via `npm run oracle:regen`.
 */

import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import request from "supertest";

// ccxt's compiled dist pulls ESM-only crypto deps jest cannot parse; the demo
// price feed never issues a ccxt request (repo idiom — see
// test/froggyWebhookService.test.ts). The registry constructs the blofin /
// coinbase adapter singletons at module load, so the mock must be
// constructible — but no method is ever called in the oracle environment.
jest.mock("ccxt", () => {
  class OracleUnusedExchange {}
  return {
    __esModule: true,
    default: { blofin: OracleUnusedExchange, coinbase: OracleUnusedExchange },
  };
});

import app from "../../src/server.js";
import { setEvidenceStore, resetEvidenceStore } from "../../src/evidence/index.js";
import { shutdownDedupeCache } from "../../src/services/ingestDedupeService.js";
import {
  __resetUwrRuntimeConfigForTests,
  UWR_PROFILE_SOURCE_ENV,
} from "../../src/config/uwrRuntimeProfile.js";
import { scorerFroggyTrendPullbackNode } from "../../src/pipeline/nodes/scorerFroggyTrendPullback.js";
// @ts-ignore — afi-core subpath types resolve via package exports; jest maps to source
import { buildFroggyTrendPullbackInputFromEnriched } from "afi-core/analysts/froggy.enrichment_adapter.js";
import {
  OracleEvidenceStore,
  expectGolden,
  installOracleEnv,
  disableNetwork,
  loadFixture,
  normalizeVolatile,
} from "./support/oracleHarness.js";

let restoreEnv: () => void;
let restoreNet: () => void;
// The scorer-node seam replaces the legacy analyst-plugin seam: the live
// path now scores through the registered scorer category node. The node's
// input IS the (aiMl-augmented) enriched view — same capture semantics.
const analystSpy = jest.spyOn(scorerFroggyTrendPullbackNode, "run");

beforeAll(() => {
  restoreEnv = installOracleEnv();
  restoreNet = disableNetwork();
  shutdownDedupeCache(); // ensure no ambient dedupe cache leaks into the oracle
});

afterAll(() => {
  analystSpy.mockRestore();
  resetEvidenceStore();
  shutdownDedupeCache();
  restoreNet();
  restoreEnv();
  delete process.env[UWR_PROFILE_SOURCE_ENV];
  __resetUwrRuntimeConfigForTests();
});

const FIXTURES: Array<{ name: string; endpoint: string; file: string }> = [
  { name: "tv-long", endpoint: "/api/webhooks/tradingview", file: "tradingview/tv-long.json" },
  { name: "tv-short", endpoint: "/api/webhooks/tradingview", file: "tradingview/tv-short.json" },
  { name: "tv-neutral", endpoint: "/api/webhooks/tradingview", file: "tradingview/tv-neutral.json" },
  { name: "cpj-blofin-perp-long", endpoint: "/api/ingest/cpj", file: "cpj/cpj-blofin-perp-long.json" },
  { name: "cpj-coinbase-spot-sell", endpoint: "/api/ingest/cpj", file: "cpj/cpj-coinbase-spot-sell.json" },
  { name: "cpj-blofin-perp-neutral", endpoint: "/api/ingest/cpj", file: "cpj/cpj-blofin-perp-neutral.json" },
];

const UWR_MODES = [
  { mode: "builtin", stampSource: "builtin-value-identity" },
  { mode: "registry", stampSource: "registry-consumed" },
] as const;

async function captureCase(
  endpoint: string,
  payload: unknown,
  uwrMode: string
): Promise<Record<string, unknown>> {
  const store = new OracleEvidenceStore();
  setEvidenceStore(store);
  analystSpy.mockClear();

  const res = await request(app).post(endpoint).send(payload as object);
  expect(res.status).toBe(200);
  expect(res.body.persistence?.outcome).toBe("inserted");

  // The EXACT enriched view the analyst scored, captured at the plugin seam.
  expect(analystSpy).toHaveBeenCalledTimes(1);
  const enrichedView = analystSpy.mock.calls[0][0];
  // The exact scorer input — same pure afi-core derivation the plugin performs.
  const scorerInput = buildFroggyTrendPullbackInputFromEnriched(enrichedView as never);

  // The governed evidence record captured at the server's store seam.
  expect(store.submissions).toHaveLength(1);
  const record = store.submissions[0];

  const isCpj = endpoint === "/api/ingest/cpj";
  const scored = isCpj ? res.body.pipelineResult : res.body;

  return {
    endpoint,
    uwrMode,
    canonicalUss: normalizeVolatile(isCpj ? res.body.uss : res.body.rawUss),
    scorerInput,
    // afi-core stamps its own volatile scoredAt inside analystScore — the same
    // '<CLOCK>' normalization applies (every scoring VALUE stays byte-exact).
    analystScore: normalizeVolatile(scored.analystScore),
    uwrResolvedSource: scored.uwrResolvedSource,
    decayParams: scored.decayParams,
    inputHash: record.provenanceRecord.inputHash,
    outputHash: record.provenanceRecord.outputHash,
    evidenceRecord: normalizeVolatile(record),
    httpResponse: normalizeVolatile(res.body),
  };
}

describe.each(UWR_MODES)(
  "oracle goldens (fail-soft env, UWR $mode mode)",
  ({ mode, stampSource }) => {
    beforeAll(() => {
      if (mode === "builtin") delete process.env[UWR_PROFILE_SOURCE_ENV];
      else process.env[UWR_PROFILE_SOURCE_ENV] = mode;
      __resetUwrRuntimeConfigForTests();
    });

    it.each(FIXTURES)("freezes $name behavior byte-exactly", async ({ name, endpoint, file }) => {
      const capture = await captureCase(endpoint, loadFixture(file), mode);
      // Governed-stamp semantics beyond the golden bytes (RC-6): the persisted
      // stamp discriminates the source the composition path ACTUALLY used.
      const record = (capture.evidenceRecord as { uwrProfile: { source: string } });
      expect(record.uwrProfile.source).toBe(stampSource);
      expectGolden(`fail-soft/${name}.${mode}.json`, capture);
    });
  }
);
