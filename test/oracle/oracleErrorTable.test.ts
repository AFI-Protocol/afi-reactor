/**
 * ORACLE-EQUIVALENCE — error-table suite.
 *
 * Freezes the endpoint error CONTRACT (status + error code + honesty flags) of
 * the live server (src/server.ts:194 tradingview, :326 cpj; failure mapping in
 * src/evidence/submitScoredSignalEvidence.ts:209-239 + server.ts:68-86). No
 * goldens needed — each row asserts the exact status and error discriminator
 * the manifest-driven executor must reproduce.
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

import app from "../../src/server.js";
import { setEvidenceStore, resetEvidenceStore } from "../../src/evidence/index.js";
import {
  initDedupeCache,
  shutdownDedupeCache,
} from "../../src/services/ingestDedupeService.js";
import {
  __resetUwrRuntimeConfigForTests,
  UWR_PROFILE_SOURCE_ENV,
} from "../../src/config/uwrRuntimeProfile.js";
import {
  OracleEvidenceStore,
  UnavailableEvidenceStore,
  installOracleEnv,
  disableNetwork,
  loadFixture,
} from "./support/oracleHarness.js";

let restoreEnv: () => void;
let restoreNet: () => void;

beforeAll(() => {
  restoreEnv = installOracleEnv();
  restoreNet = disableNetwork();
  shutdownDedupeCache();
});

afterAll(() => {
  resetEvidenceStore();
  shutdownDedupeCache();
  restoreNet();
  restoreEnv();
  delete process.env[UWR_PROFILE_SOURCE_ENV];
  __resetUwrRuntimeConfigForTests();
});

const TV = "/api/webhooks/tradingview";
const CPJ = "/api/ingest/cpj";

function tvPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...loadFixture("tradingview/tv-long.json"), ...overrides };
}

describe("oracle error table — request validation (400/401/422)", () => {
  beforeAll(() => setEvidenceStore(new OracleEvidenceStore()));
  afterAll(() => resetEvidenceStore());

  it.each([
    ["symbol", "Missing required field: symbol"],
    ["timeframe", "Missing required field: timeframe"],
    ["strategy", "Missing required field: strategy"],
    ["direction", "Missing required field: direction"],
  ])("tradingview missing %s → 400", async (field, message) => {
    const payload = tvPayload();
    delete payload[field];
    const res = await request(app).post(TV).send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(message);
  });

  it("tradingview invalid direction → 400", async () => {
    const res = await request(app).post(TV).send(tvPayload({ direction: "sideways" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid direction/);
  });

  it("tradingview bad shared secret → 401 (and correct secret passes auth)", async () => {
    process.env.WEBHOOK_SHARED_SECRET = "oracle-secret";
    try {
      const bad = await request(app).post(TV).send(tvPayload({ secret: "wrong" }));
      expect(bad.status).toBe(401);
      expect(bad.body.error).toBe("Unauthorized: invalid secret");
      const good = await request(app)
        .post(TV)
        .send(tvPayload({ secret: "oracle-secret", signalId: "oracle-tv-auth-0001" }));
      expect(good.status).toBe(200);
    } finally {
      delete process.env.WEBHOOK_SHARED_SECRET;
    }
  });

  it("cpj bad shared secret → 401", async () => {
    process.env.WEBHOOK_SHARED_SECRET = "oracle-secret";
    try {
      const res = await request(app)
        .post(CPJ)
        .send({ ...loadFixture("cpj/cpj-blofin-perp-long.json"), secret: "wrong" });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized: invalid secret");
    } finally {
      delete process.env.WEBHOOK_SHARED_SECRET;
    }
  });

  it("tradingview payload mapping to schema-invalid USS → 400 invalid_uss", async () => {
    // A non-string providerId survives the field checks but violates the
    // governed USS v1.1 schema (provenance.providerId: string).
    const res = await request(app).post(TV).send(tvPayload({ providerId: 123 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_uss");
  });

  it("invalid CPJ (missing parse block) → 400 invalid_cpj", async () => {
    const payload = loadFixture("cpj/cpj-blofin-perp-long.json");
    delete payload.parse;
    const res = await request(app).post(CPJ).send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_cpj");
  });

  it("cpj un-normalizable symbol → 422 symbol_normalization_failed", async () => {
    const payload = loadFixture("cpj/cpj-blofin-perp-long.json");
    payload.extracted.symbolRaw = "??!!";
    const res = await request(app).post(CPJ).send(payload);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("symbol_normalization_failed");
    expect(res.body.symbolRaw).toBe("??!!");
  });
});

describe("oracle error table — configuration fail-closed (500)", () => {
  beforeAll(() => setEvidenceStore(new OracleEvidenceStore()));
  afterAll(() => resetEvidenceStore());

  it("AFI_PRICE_FEED_SOURCE unset in production runtime → 500 (fail closed, no silent demo)", async () => {
    // getDefaultPriceSource() falls back to demo ONLY under NODE_ENV=test; the
    // production runtime fails closed. Flip both for exactly one request.
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.AFI_PRICE_FEED_SOURCE;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app)
        .post(TV)
        .send(tvPayload({ signalId: "oracle-tv-nofeed-0001" }));
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal_error");
      expect(res.body.message).toMatch(/AFI_PRICE_FEED_SOURCE is required/);
    } finally {
      process.env.NODE_ENV = savedNodeEnv;
      process.env.AFI_PRICE_FEED_SOURCE = "demo";
    }
  });

  it("invalid AFI_UWR_PROFILE_SOURCE → 500 and NO evidence record (RC-4 fail closed)", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);
    process.env[UWR_PROFILE_SOURCE_ENV] = "fallback"; // ungoverned flag value
    __resetUwrRuntimeConfigForTests();
    try {
      const res = await request(app)
        .post(TV)
        .send(tvPayload({ signalId: "oracle-tv-uwrfail-0001" }));
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal_error");
      expect(store.submissions).toHaveLength(0); // nothing was ever submitted
    } finally {
      delete process.env[UWR_PROFILE_SOURCE_ENV];
      __resetUwrRuntimeConfigForTests();
    }
  });
});

describe("oracle error table — persistence honesty (503/409/200-idempotent)", () => {
  afterAll(() => resetEvidenceStore());

  it("store unavailable (Mongo down) → 503, persisted:false — never a masked 200", async () => {
    setEvidenceStore(new UnavailableEvidenceStore());
    const res = await request(app)
      .post(TV)
      .send(tvPayload({ signalId: "oracle-tv-mongodown-0001" }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("evidence_persistence_persistence");
    expect(res.body.persisted).toBe(false);
    expect(res.body.signalId).toBe("oracle-tv-mongodown-0001");
  });

  it("same-signalId resubmit: identical content → 200 idempotent-duplicate; different content → 409 conflict", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);
    const payload = tvPayload({ signalId: "oracle-tv-dup-0001" });

    const first = await request(app).post(TV).send(payload);
    expect(first.status).toBe(200);
    expect(first.body.persistence.outcome).toBe("inserted");

    // Deterministic scoring ⇒ a byte-identical record ⇒ idempotent 200.
    const identical = await request(app).post(TV).send(payload);
    expect(identical.status).toBe(200);
    expect(identical.body.persistence.outcome).toBe("idempotent-duplicate");
    expect(store.records.size).toBe(1);

    // Same signalId, genuinely different content ⇒ honest 409, append-once.
    const conflicting = await request(app)
      .post(TV)
      .send(tvPayload({ signalId: "oracle-tv-dup-0001", direction: "short" }));
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error).toBe("evidence_persistence_conflict");
    expect(conflicting.body.persisted).toBe(false);
    expect(store.records.size).toBe(1); // stored record unchanged
  });

  it("tradingview double-post WITHOUT signalId → two 200s, two distinct records", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);
    const payload = tvPayload();
    delete payload.signalId;

    const first = await request(app).post(TV).send(payload);
    expect(first.status).toBe(200);
    // The derived signalId is second-resolution (tradingViewMapper) — cross
    // the second boundary so the second post derives a distinct identity.
    await new Promise((r) => setTimeout(r, 1100));
    const second = await request(app).post(TV).send(payload);
    expect(second.status).toBe(200);

    expect(first.body.signalId).not.toBe(second.body.signalId);
    expect(first.body.persistence.outcome).toBe("inserted");
    expect(second.body.persistence.outcome).toBe("inserted");
    expect(store.records.size).toBe(2);
  }, 15000);

  it("cpj re-ingest with AFI_INGEST_DEDUPE=1 → 409 duplicate (pre-scoring dedupe)", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);
    process.env.AFI_INGEST_DEDUPE = "1";
    initDedupeCache();
    try {
      const payload = loadFixture("cpj/cpj-blofin-perp-long.json");
      const first = await request(app).post(CPJ).send(payload);
      expect(first.status).toBe(200);

      const dup = await request(app).post(CPJ).send(payload);
      expect(dup.status).toBe(409);
      expect(dup.body.ok).toBe(false);
      expect(dup.body.duplicate).toBe(true);
      expect(dup.body.ingestHash).toBe(first.body.ingestHash);
      expect(store.records.size).toBe(1); // the duplicate never re-scored/persisted
    } finally {
      delete process.env.AFI_INGEST_DEDUPE;
      shutdownDedupeCache();
    }
  });
});
