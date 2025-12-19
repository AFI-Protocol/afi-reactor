import { describe, it, expect, jest } from "@jest/globals";
import http from "http";
import express from "express";
import { mapTradingViewToUssV11 } from "../src/uss/tradingViewMapper.js";
import { getTssdVaultService } from "../src/services/tssdVaultService.js";

const mockResult = {
  signalId: "sig-123",
  rawUss: { provenance: { signalId: "sig-123" } },
  analystScore: { uwrScore: 0.5, uwrAxes: { structure: 0.5, execution: 0.5, risk: 0.5, insight: 0.5 } },
  scoredAt: "2024-01-01T00:00:00Z",
  decayParams: { halfLifeMinutes: 60, greeksTemplateId: "decay-1" },
  meta: { symbol: "BTC/USDT", timeframe: "1h", strategy: "froggy", direction: "long", source: "tradingview-webhook" },
};

jest.mock(
  "afi-core/decay",
  () => ({
    pickDecayParamsForAnalystScore: () => mockResult.decayParams,
  }),
  { virtual: true }
);
jest.mock("ccxt", () => ({ default: {} }), { virtual: true });
const app = express();
app.use(express.json());
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", service: "afi-reactor", froggyPipeline: "available" });
});
app.post("/api/webhooks/tradingview", (_req, res) => {
  res.status(200).json(mockResult);
});
app.post("/api/ingest/cpj", (_req, res) => {
  res.status(200).json({ ok: true, pipelineResult: { vaultWrite: "success" } });
});

async function withServer(handler: (baseUrl: string, server: http.Server) => Promise<void>) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://localhost:${port}`;
  try {
    await handler(baseUrl, server);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Reactor scored-only surface", () => {
  it("health endpoint responds OK", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ status: "ok", service: "afi-reactor" });
    });
  });

  it("TradingView webhook returns scored-only contract shape", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/webhooks/tradingview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: "BTC/USDT", timeframe: "1h", strategy: "froggy", direction: "long" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.signalId).toBe("sig-123");
      expect(body.analystScore).toBeDefined();
      expect(body.validatorDecision).toBeUndefined();
      expect(body.execution).toBeUndefined();
      expect(body.stageSummaries).toBeUndefined();
      expect(body.receiptProvenance).toBeUndefined();
      expect(body.mode).toBeUndefined();
    });
  });

  it("default vault config points to scored-only collection", () => {
    const originalUri = process.env.AFI_MONGO_URI;
    process.env.AFI_MONGO_URI = "mongodb://example:27017";
    delete process.env.AFI_MONGO_DB_NAME;
    delete process.env.AFI_MONGO_COLLECTION_SCORED;

    const svc = getTssdVaultService() as any;
    expect(svc?.config?.dbName).toBe("afi_reactor");
    expect(svc?.config?.collectionName).toBe("reactor_scored_signals_v1");

    process.env.AFI_MONGO_URI = originalUri;
  });

  it("maps TradingView payload to canonical USS v1.1", () => {
    const uss = mapTradingViewToUssV11({
      symbol: "BTC/USDT",
      timeframe: "15m",
      strategy: "froggy_trend_pullback_v1",
      direction: "long",
    });

    expect(uss.schema).toBe("afi.usignal.v1.1");
    expect(uss.provenance.source).toBe("tradingview-webhook");
    expect(uss.provenance.signalId).toBeDefined();
  });
});
