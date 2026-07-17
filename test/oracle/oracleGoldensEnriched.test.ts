/**
 * ORACLE-EQUIVALENCE — golden captures, ENRICHED (recorded-provider) variant.
 *
 * Same endpoints, same shared DAG path, same capture matrix (fixture ×
 * {builtin, registry} UWR mode) as oracleGoldensFailSoft.test.ts, but with the
 * external enrichment providers replaced by RECORDED fixed responses at their
 * module seams (repo idiom — see test/enrichment/*.test.ts):
 *
 *   - coinalyzeClient.fetchCoinalyzePerpMetrics → fixed perp metrics (the
 *     sentiment lego's real math runs on them);
 *   - newsdataNewsProvider.createNewsDataProvider → provider returning a fixed
 *     NewsShockSummary (NEWS_PROVIDER=newsdata enables the path);
 *   - tinyBrainsClient.fetchAiMlForFroggy → fixed FroggyAiMlV1 prediction;
 *   - regimeCandleProvider.fetchRegimeCandles + fearGreedClient
 *     .fetchFearGreedHistory → fixed series (regime math runs for real).
 *
 * This locks the ENRICHED scoring path (sentiment/news/aiMl/regime present)
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

// RECORDED provider responses — fixed, committed-in-code stubs at the exact
// adapter-module seams the live plugins call.
jest.mock("../../src/adapters/coinalyze/coinalyzeClient.js", () => ({
  fetchCoinalyzePerpMetrics: jest.fn(async () => ({
    fundingRate: 0.0001,
    fundingHistory: [0.00008, 0.00009, 0.0001],
    oiUsd: 1_500_000_000,
    oiHistoryUsd: [1_400_000_000, 1_450_000_000, 1_500_000_000],
    longShortRatio: 1.2,
  })),
}));

jest.mock("../../src/news/newsdataNewsProvider.js", () => ({
  createNewsDataProvider: jest.fn(() => ({
    fetchRecentNews: async () => ({
      hasShockEvent: true,
      shockDirection: "bullish" as const,
      headlines: ["Oracle recorded headline A", "Oracle recorded headline B"],
      items: [
        {
          title: "Oracle recorded headline A",
          source: "oracle-wire",
          url: "https://example.invalid/a",
          publishedAt: new Date("2026-01-15T09:30:00Z"),
        },
        {
          title: "Oracle recorded headline B",
          source: "oracle-wire",
          url: "https://example.invalid/b",
          publishedAt: new Date("2026-01-15T08:45:00Z"),
        },
      ],
    }),
  })),
}));

jest.mock("../../src/aiMl/tinyBrainsClient.js", () => ({
  fetchAiMlForFroggy: jest.fn(async () => ({
    convictionScore: 0.85,
    direction: "long" as const,
    regime: "bull",
    riskFlag: false,
    notes: "oracle recorded prediction (fixed)",
  })),
}));

jest.mock("../../src/indicator/regimeCandleProvider.js", () => {
  // 60 deterministic daily candles — a pure function of the index, no clock.
  const candles = Array.from({ length: 60 }, (_, i) => {
    const base = 40000 + 100 * i + 500 * Math.sin(i / 5);
    return {
      timestampMs: Date.UTC(2025, 10, 1) + i * 86_400_000,
      open: base,
      high: base * 1.01,
      low: base * 0.99,
      close: base * 1.002,
    };
  });
  return { fetchRegimeCandles: jest.fn(async () => candles) };
});

jest.mock("../../src/adapters/external/fearGreedClient.js", () => {
  const actual = jest.requireActual(
    "../../src/adapters/external/fearGreedClient.js"
  ) as Record<string, unknown>;
  const points = Array.from({ length: 90 }, (_, i) => ({
    timestampSec: Math.floor(Date.UTC(2025, 9, 15) / 1000) + i * 86_400,
    value: 55 + Math.round(10 * Math.sin(i / 7)),
    classification: "Greed",
  }));
  return {
    ...actual,
    fetchFearGreedHistory: jest.fn(async () => points),
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
  restoreNet = disableNetwork(); // belt & suspenders — every provider is stubbed
  shutdownDedupeCache();
  // Enable the news path so the mocked provider factory is consulted; the
  // sentiment lego needs no key (the coinalyze CLIENT is the recorded seam).
  process.env.NEWS_PROVIDER = "newsdata";
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
      // The recorded providers must actually be ON this path (this is the
      // point of the variant): sentiment, news, and aiMl are all present.
      expect(enrichedView.sentiment).toBeDefined();
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
