/**
 * ORACLE-EQUIVALENCE — golden captures, ENRICHED (recorded-provider) variant.
 *
 * Same endpoints, same shared graph path, same capture matrix (fixture ×
 * {builtin, registry} UWR mode) as oracleGoldensFailSoft.test.ts, but with the
 * REMOTE reference-lane adapters replaced by RECORDED fixed transports at
 * their singleton seams (the five-lane provider runtime, FLPR-GOV):
 *
 *   - sentimentCftcCotAdapter → recorded CFTC COT report row (the adapter's
 *     real derivation math runs on it);
 *   - newsSecEdgarAdapter → recorded EDGAR full-text hits + a fixed clock
 *     (the adapter's real normalization runs on them);
 *   - aimlTinyBrainsAdapter → recorded Tiny Brains prediction;
 *   - technical (demo feed via the guarded seam) and the first-party
 *     candlestick pattern lane run their REAL local kernels unmocked.
 *
 * This locks the ENRICHED scoring path (all five categories present)
 * byte-exactly, complementing the fail-soft suite that locks the defaults.
 * Goldens are regenerated ONLY via `npm run oracle:regen`.
 */

import { describe, it, expect, beforeAll, afterAll, jest } from "@jest/globals";
import request from "supertest";

jest.mock("ccxt", () => {
  class OracleUnusedExchange {}
  return {
    __esModule: true,
    default: { blofin: OracleUnusedExchange, coinbase: OracleUnusedExchange },
  };
});

// RECORDED transports — fixed, committed-in-code stubs injected at the exact
// adapter singleton seams the provider runtime registers.
jest.mock("../../src/providers/adapters/sentimentCftcCotAdapter.js", () => {
  const actual = jest.requireActual(
    "../../src/providers/adapters/sentimentCftcCotAdapter.js"
  ) as typeof import("../../src/providers/adapters/sentimentCftcCotAdapter.js");
  const row = {
    market_and_exchange_names: "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: "2026-01-13T00:00:00.000",
    lev_money_positions_long: "60000",
    lev_money_positions_short: "40000",
    open_interest_all: "100000",
    change_in_open_interest_all: "5000",
  };
  const fetchImpl = (async () =>
    ({ ok: true, status: 200, statusText: "OK", json: async () => [row] }) as Response) as typeof fetch;
  return {
    ...actual,
    sentimentCftcCotAdapter: actual.createSentimentCftcCotAdapter({ fetchImpl }),
  };
});

jest.mock("../../src/providers/adapters/newsSecEdgarAdapter.js", () => {
  const actual = jest.requireActual(
    "../../src/providers/adapters/newsSecEdgarAdapter.js"
  ) as typeof import("../../src/providers/adapters/newsSecEdgarAdapter.js");
  const body = {
    hits: {
      hits: [
        {
          _source: {
            adsh: "0001234567-26-000123",
            ciks: ["0001234567"],
            display_names: ["Oracle Recorded Filer A (ORFA)"],
            root_forms: ["8-K"],
            file_date: "2026-01-15",
          },
        },
        {
          _source: {
            adsh: "0001234567-26-000122",
            ciks: ["0001234567"],
            display_names: ["Oracle Recorded Filer A (ORFA)"],
            root_forms: ["10-Q"],
            file_date: "2026-01-14",
          },
        },
      ],
    },
  };
  const fetchImpl = (async () =>
    ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response) as typeof fetch;
  return {
    ...actual,
    newsSecEdgarAdapter: actual.createNewsSecEdgarAdapter({
      fetchImpl,
      now: () => new Date("2026-01-15T12:00:00.000Z"),
    }),
  };
});

jest.mock("../../src/providers/adapters/aimlTinyBrainsAdapter.js", () => {
  const actual = jest.requireActual(
    "../../src/providers/adapters/aimlTinyBrainsAdapter.js"
  ) as typeof import("../../src/providers/adapters/aimlTinyBrainsAdapter.js");
  return {
    ...actual,
    aimlTinyBrainsAdapter: actual.createAimlTinyBrainsAdapter({
      callService: (async () => ({
        convictionScore: 0.85,
        direction: "long" as const,
        regime: "bull",
        riskFlag: false,
        notes: "oracle recorded prediction (fixed; dropped at the adapter edge)",
      })) as never,
    }),
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
  restoreNet = disableNetwork(); // belt & suspenders — every remote lane is stubbed
  shutdownDedupeCache();
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

describe.each(UWR_MODES)(
  "oracle goldens (recorded providers, UWR $mode mode)",
  ({ mode, stampSource }) => {
    beforeAll(() => {
      if (mode === "builtin") delete process.env[UWR_PROFILE_SOURCE_ENV];
      else process.env[UWR_PROFILE_SOURCE_ENV] = mode;
      __resetUwrRuntimeConfigForTests();
    });

    it.each(FIXTURES)("freezes enriched $name behavior byte-exactly", async ({ name, endpoint, file }) => {
      const store = new OracleEvidenceStore();
      setEvidenceStore(store);
      analystSpy.mockClear();

      const res = await request(app).post(endpoint).send(loadFixture(file));
      expect(res.status).toBe(200);
      expect(res.body.persistence?.outcome).toBe("inserted");

      expect(analystSpy).toHaveBeenCalledTimes(1);
      const enrichedView = analystSpy.mock.calls[0][0] as {
        sentiment?: unknown;
        news?: unknown;
        aiMl?: unknown;
      };
      // The recorded lanes must actually be ON this path (the point of the
      // variant): news and aiMl are always present; the keyless CFTC COT
      // sentiment reference lane maps only LISTED COT markets (BTC/ETH), so
      // the SOL fixtures honestly carry no sentiment axes — never a
      // fabricated default market (FLPR-GOV D-FLPR-4).
      const hasListedCotMarket = !name.includes("neutral");
      if (hasListedCotMarket) expect(enrichedView.sentiment).toBeDefined();
      else expect(enrichedView.sentiment).toBeUndefined();
      expect(enrichedView.news).toBeDefined();
      expect(enrichedView.aiMl).toBeDefined();

      const scorerInput = buildFroggyTrendPullbackInputFromEnriched(enrichedView as never);
      expect(store.submissions).toHaveLength(1);
      const record = store.submissions[0];
      expect(record.uwrProfile.source).toBe(stampSource);

      const isCpj = endpoint === "/api/ingest/cpj";
      const scored = isCpj ? res.body.pipelineResult : res.body;
      expectGolden(`enriched/${name}.${mode}.json`, {
        endpoint,
        uwrMode: mode,
        canonicalUss: normalizeVolatile(isCpj ? res.body.uss : res.body.rawUss),
        scorerInput,
        analystScore: normalizeVolatile(scored.analystScore),
        uwrResolvedSource: scored.uwrResolvedSource,
        decayParams: scored.decayParams,
        inputHash: record.provenanceRecord.inputHash,
        outputHash: record.provenanceRecord.outputHash,
        evidenceRecord: normalizeVolatile(record),
        httpResponse: normalizeVolatile(res.body),
      });
    });
  }
);
