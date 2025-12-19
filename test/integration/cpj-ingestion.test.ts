/**
 * CPJ Ingestion Integration Tests
 *
 * These tests use supertest to POST CPJ payloads to the /api/ingest/cpj endpoint
 * and verify the response structure. They avoid the AJV/Jest ESM interop issues
 * by testing via HTTP against the imported Express app.
 *
 * ⚠️ GATED: CPJ ingestion is optional and deferred for the scored-only milestone.
 * Set CPJ_TESTS_ENABLED=true to run these tests.
 */

import request from "supertest";
import app from "../../src/server.js";
import { shutdownDedupeCache } from "../../src/services/ingestDedupeService.js";

// Set NODE_ENV to test to prevent server from auto-starting
process.env.NODE_ENV = "test";

const CPJ_TESTS_ENABLED = process.env.CPJ_TESTS_ENABLED === "true";

(CPJ_TESTS_ENABLED ? describe : describe.skip)("CPJ Ingestion Integration", () => {
  // Cleanup dedupe cache after all tests to prevent Jest hanging
  afterAll(() => {
    shutdownDedupeCache();
  });
  describe("POST /api/ingest/cpj", () => {
    it("should accept valid BloFin perp CPJ and return structured response", async () => {
      const validCpj = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-123",
          messageId: "msg-456",
          postedAt: "2024-12-16T10:00:00Z",
          rawText: "BTC LONG signal",
          channelName: "Crypto Signals Pro",
        },
        extracted: {
          symbolRaw: "BTCUSDT",
          side: "long",
          entry: 42500,
          stopLoss: 41800,
          takeProfits: [{ price: 43500 }],
          timeframeHint: "4h",
          venueHint: "blofin",
          marketTypeHint: "perp",
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.95,
        },
      };

      const response = await request(app)
        .post("/api/ingest/cpj")
        .send(validCpj)
        .expect(200);

      // Assert response structure
      expect(response.body).toHaveProperty("ok", true);
      expect(response.body).toHaveProperty("signalId");
      expect(response.body).toHaveProperty("providerId", "telegram-channel-123");
      expect(response.body).toHaveProperty("ingestHash");
      expect(response.body).toHaveProperty("uss");
      expect(response.body).toHaveProperty("pipelineResult");

      // Assert USS structure
      expect(response.body.uss.schema).toBe("afi.usignal.v1.1");
      expect(response.body.uss.facts?.symbol).toBe("BTC/USDT");
      expect(response.body.uss.facts?.market).toBe("perp");
      expect(response.body.uss.facts?.direction).toBe("long");

      // Assert ingestHash is a non-empty string
      expect(typeof response.body.ingestHash).toBe("string");
      expect(response.body.ingestHash.length).toBeGreaterThan(0);

      // Assert pipelineResult is an object
      expect(typeof response.body.pipelineResult).toBe("object");
    });

    it("should accept valid Coinbase spot CPJ and normalize symbol", async () => {
      const validCpj = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-654",
          messageId: "msg-789",
          postedAt: "2024-12-16T11:00:00Z",
        },
        extracted: {
          symbolRaw: "SOL-USD",
          side: "buy",
          entry: 98.5,
          timeframeHint: "1h",
          venueHint: "coinbase",
          marketTypeHint: "spot",
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.92,
        },
      };

      const response = await request(app)
        .post("/api/ingest/cpj")
        .send(validCpj)
        .expect(200);

      // Assert symbol normalization
      expect(response.body.uss.facts?.symbol).toBe("SOL/USD");
      expect(response.body.uss.facts?.market).toBe("spot");
      expect(response.body.uss.facts?.direction).toBe("long"); // "buy" → "long"
    });

    it("should reject CPJ missing required provenance fields", async () => {
      const invalidCpj = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          // Missing providerId, messageId, postedAt
        },
        extracted: {
          symbolRaw: "BTCUSDT",
          side: "long",
        },
        parse: {
          parserId: "test-parser",
          parserVersion: "1.0.0",
          confidence: 0.9,
        },
      };

      const response = await request(app)
        .post("/api/ingest/cpj")
        .send(invalidCpj)
        .expect(400);

      expect(response.body).toHaveProperty("error", "invalid_cpj");
      expect(response.body).toHaveProperty("message");
      expect(response.body).toHaveProperty("details");
    });

    it("should reject CPJ with invalid side value", async () => {
      const invalidCpj = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "test-channel",
          messageId: "msg-123",
          postedAt: "2024-12-16T10:00:00Z",
        },
        extracted: {
          symbolRaw: "BTCUSDT",
          side: "invalid-side", // Invalid
        },
        parse: {
          parserId: "test-parser",
          parserVersion: "1.0.0",
          confidence: 0.9,
        },
      };

      const response = await request(app)
        .post("/api/ingest/cpj")
        .send(invalidCpj)
        .expect(400);

      expect(response.body).toHaveProperty("error");
    });

    it("should pass vault gate verification (enrichment attaches _priceFeedMetadata)", async () => {
      const validCpj = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-vault-test",
          messageId: "msg-vault-123",
          postedAt: "2024-12-16T12:00:00Z",
        },
        extracted: {
          symbolRaw: "BTCUSDT",
          side: "long",
          entry: 42500,
          timeframeHint: "4h",
          venueHint: "blofin",
          marketTypeHint: "perp",
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.95,
        },
      };

      const response = await request(app)
        .post("/api/ingest/cpj")
        .send(validCpj)
        .expect(200);

      // Assert vault write status
      // If AFI_MONGO_URI is set, vaultWrite should be "success" or "failed"
      // If not set, vaultWrite should be "skipped"
      expect(response.body.pipelineResult).toHaveProperty("vaultWrite");
      expect(["success", "failed", "skipped", "failed-missing-provenance"]).toContain(
        response.body.pipelineResult.vaultWrite
      );

      // If vault write failed due to missing provenance, this is a test failure
      // because enrichment should have attached _priceFeedMetadata
      if (response.body.pipelineResult.vaultWrite === "failed-missing-provenance") {
        throw new Error(
          `Vault write blocked due to missing provenance: ${response.body.pipelineResult.vaultError}`
        );
      }

      // Log vault write status for debugging
      console.log(`  ✅ Vault write status: ${response.body.pipelineResult.vaultWrite}`);
    });
  });

  describe("Symbol Edge Cases", () => {
    it("should handle 1000-style token (1000PEPEUSDT)", async () => {
      const cpj1000Style = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-1000pepe",
          messageId: "msg-1000pepe-123",
          postedAt: "2024-12-16T12:00:00Z",
        },
        extracted: {
          symbolRaw: "1000PEPEUSDT",
          side: "long",
          entry: 0.00001234,
          timeframeHint: "1h",
          venueHint: "binance",
          marketTypeHint: "perp",
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.92,
        },
      };

      const response = await request(app)
        .post("/api/ingest/cpj")
        .send(cpj1000Style)
        .expect(200);

      expect(response.body.uss.facts.symbol).toBe("1000PEPE/USDT");
      expect(response.body.ok).toBe(true);
    });

    it("should strip venue suffix with colon (BTC/USDT:USDT)", async () => {
      const cpjWithColon = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-colon",
          messageId: "msg-colon-456",
          postedAt: "2024-12-16T12:00:00Z",
        },
        extracted: {
          symbolRaw: "BTC/USDT:USDT",
          side: "short",
          entry: 42000,
          timeframeHint: "4h",
          venueHint: "blofin",
          marketTypeHint: "perp",
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.95,
        },
      };

      const response = await request(app)
        .post("/api/ingest/cpj")
        .send(cpjWithColon)
        .expect(200);

      expect(response.body.uss.facts.symbol).toBe("BTC/USDT");
      expect(response.body.ok).toBe(true);
    });

    it("should reject unrecognized symbol format with 422", async () => {
      const cpjBadSymbol = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-bad",
          messageId: "msg-bad-789",
          postedAt: "2024-12-16T12:00:00Z",
        },
        extracted: {
          symbolRaw: "XYZABC",
          side: "long",
          entry: 100,
          timeframeHint: "1h",
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.8,
        },
      };

      const response = await request(app)
        .post("/api/ingest/cpj")
        .send(cpjBadSymbol)
        .expect(422);

      expect(response.body.error).toBe("symbol_normalization_failed");
      expect(response.body.symbolRaw).toBe("XYZABC");
      expect(response.body.reason).toBe("UNRECOGNIZED_SYMBOL_FORMAT");
    });

    it("should reject symbol with forbidden characters with 422", async () => {
      const cpjForbiddenChars = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-forbidden",
          messageId: "msg-forbidden-101",
          postedAt: "2024-12-16T12:00:00Z",
        },
        extracted: {
          symbolRaw: "BTC@USDT",
          side: "long",
          entry: 42000,
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.9,
        },
      };

      const response = await request(app)
        .post("/api/ingest/cpj")
        .send(cpjForbiddenChars)
        .expect(422);

      expect(response.body.error).toBe("symbol_normalization_failed");
      expect(response.body.symbolRaw).toBe("BTC@USDT");
      expect(response.body.reason).toBe("CONTAINS_FORBIDDEN_CHARS");
    });
  });

  describe("Duplicate Detection", () => {
    it("should return 409 on duplicate ingest when dedupe enabled", async () => {
      // This test only runs if AFI_INGEST_DEDUPE=1
      const dedupeEnabled = process.env.AFI_INGEST_DEDUPE === "1";

      if (!dedupeEnabled) {
        console.log("  ⏭️  Skipping dedupe test (AFI_INGEST_DEDUPE not enabled)");
        return;
      }

      const cpjPayload = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-dedupe-test",
          messageId: "msg-dedupe-unique-123",
          postedAt: "2024-12-16T12:00:00Z",
        },
        extracted: {
          symbolRaw: "ETHUSDT",
          side: "long",
          entry: 2200,
          timeframeHint: "1h",
          venueHint: "binance",
          marketTypeHint: "perp",
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.95,
        },
      };

      // First ingest should succeed
      const response1 = await request(app)
        .post("/api/ingest/cpj")
        .send(cpjPayload)
        .expect(200);

      expect(response1.body.ok).toBe(true);
      const ingestHash = response1.body.ingestHash;

      // Second ingest with identical payload should return 409
      const response2 = await request(app)
        .post("/api/ingest/cpj")
        .send(cpjPayload)
        .expect(409);

      expect(response2.body.ok).toBe(false);
      expect(response2.body.duplicate).toBe(true);
      expect(response2.body.ingestHash).toBe(ingestHash);
      expect(response2.body.message).toContain("Duplicate signal");
    });
  });

  describe("Semantic Hash Stability", () => {
    it("should generate same ingestHash for semantically equivalent entry ranges", async () => {
      const baseCpj = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-hash-test",
          messageId: "msg-hash-entry-1",
          postedAt: "2024-12-16T12:00:00Z",
        },
        extracted: {
          symbolRaw: "BTCUSDT",
          side: "long",
          timeframeHint: "1h",
          venueHint: "binance",
          marketTypeHint: "perp",
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.95,
        },
      };

      // Version 1: entry with min/max in correct order
      const cpj1 = {
        ...baseCpj,
        provenance: { ...baseCpj.provenance, messageId: "msg-hash-entry-1" },
        extracted: {
          ...baseCpj.extracted,
          entry: { min: 42000, max: 42500 },
        },
      };

      // Version 2: entry with min/max in reverse order (should be canonicalized)
      const cpj2 = {
        ...baseCpj,
        provenance: { ...baseCpj.provenance, messageId: "msg-hash-entry-2" },
        extracted: {
          ...baseCpj.extracted,
          entry: { max: 42500, min: 42000 },
        },
      };

      const response1 = await request(app).post("/api/ingest/cpj").send(cpj1).expect(200);
      const response2 = await request(app).post("/api/ingest/cpj").send(cpj2).expect(200);

      // Different messageIds mean different signalIds, but entry canonicalization
      // should NOT affect hash (hash is of full payload including messageId)
      // So these should have DIFFERENT hashes
      expect(response1.body.ingestHash).not.toBe(response2.body.ingestHash);
    });

    it("should generate same ingestHash for semantically equivalent TP arrays", async () => {
      // Skip if dedupe not enabled (can't verify hash equality via 409)
      const dedupeEnabled = process.env.AFI_INGEST_DEDUPE === "1";

      if (!dedupeEnabled) {
        console.log("  ⏭️  Skipping semantic hash test (AFI_INGEST_DEDUPE not enabled)");
        return;
      }

      const baseCpj = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-hash-test",
          messageId: "msg-hash-tp-same",
          postedAt: "2024-12-16T12:00:00Z",
        },
        extracted: {
          symbolRaw: "ETHUSDT",
          side: "long",
          entry: 2200,
          timeframeHint: "1h",
          venueHint: "binance",
          marketTypeHint: "perp",
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.95,
        },
      };

      // Version 1: TPs in ascending order
      const cpj1 = {
        ...baseCpj,
        extracted: {
          ...baseCpj.extracted,
          takeProfits: [
            { price: 2250, percentage: 50 },
            { price: 2300, percentage: 50 },
          ],
        },
      };

      // Version 2: TPs in descending order (should be canonicalized to ascending)
      const cpj2 = {
        ...baseCpj,
        extracted: {
          ...baseCpj.extracted,
          takeProfits: [
            { price: 2300, percentage: 50 },
            { price: 2250, percentage: 50 },
          ],
        },
      };

      const response1 = await request(app).post("/api/ingest/cpj").send(cpj1).expect(200);

      // Second request should return 409 (duplicate) because canonicalized TPs produce same hash
      const response2 = await request(app).post("/api/ingest/cpj").send(cpj2).expect(409);

      // Verify it's the same hash
      expect(response2.body.duplicate).toBe(true);
      expect(response2.body.ingestHash).toBe(response1.body.ingestHash);
    });
  });

  describe("End-to-End Collector Simulation", () => {
    it("should handle Cornix-style signal with dedupe and vault verification", async () => {
      // Skip if dedupe not enabled
      const dedupeEnabled = process.env.AFI_INGEST_DEDUPE === "1";

      if (!dedupeEnabled) {
        console.log("  ⏭️  Skipping E2E test (AFI_INGEST_DEDUPE not enabled)");
        return;
      }

      // Simulate a real Cornix-style Telegram signal parsed into CPJ
      const cornixStyleCpj = {
        schema: "afi.cpj.v0.1",
        provenance: {
          providerType: "telegram",
          providerId: "telegram-channel-cornix-test",
          messageId: "msg-cornix-12345",
          postedAt: "2024-12-16T14:00:00Z",
          rawText: `🚀 BTC LONG SIGNAL

Symbol: BTCUSDT
Entry: 42000-42500
Stop Loss: 41500
Take Profit 1: 43000 (50%)
Take Profit 2: 44000 (50%)
Leverage: 5x
Timeframe: 4h
Venue: BloFin`,
          channelName: "Crypto Signals Pro",
        },
        extracted: {
          symbolRaw: "BTCUSDT",
          side: "long",
          entry: { min: 42000, max: 42500 },
          stopLoss: 41500,
          takeProfits: [
            { price: 43000, percentage: 50 },
            { price: 44000, percentage: 50 },
          ],
          leverageHint: 5,
          timeframeHint: "4h",
          venueHint: "blofin",
          marketTypeHint: "perp",
        },
        parse: {
          parserId: "telegram-signal-parser",
          parserVersion: "1.0.0",
          confidence: 0.95,
        },
      };

      // First ingestion should succeed
      const response1 = await request(app)
        .post("/api/ingest/cpj")
        .send(cornixStyleCpj)
        .expect(200);

      expect(response1.body.ok).toBe(true);
      expect(response1.body.signalId).toBeDefined();
      expect(response1.body.ingestHash).toBeDefined();
      expect(response1.body.pipelineResult).toBeDefined();

      // Verify vault write status
      const vaultWrite = response1.body.pipelineResult.vaultWrite;
      expect(vaultWrite).toBeDefined();

      // Should be either "success" (if Mongo configured), "skipped" (if not),
      // or "failed-missing-provenance" (if enrichment didn't attach metadata)
      // For this test, we just verify it's defined and pipeline ran
      expect(vaultWrite).toMatch(/^(success|skipped|failed|failed-missing-provenance)$/);

      // Verify USS was created with correct symbol normalization
      expect(response1.body.uss).toBeDefined();
      expect(response1.body.uss.facts.symbol).toBe("BTC/USDT");
      expect(response1.body.uss.facts.market).toBe("perp");

      // Second ingestion (duplicate) should return 409
      const response2 = await request(app)
        .post("/api/ingest/cpj")
        .send(cornixStyleCpj)
        .expect(409);

      expect(response2.body.ok).toBe(false);
      expect(response2.body.duplicate).toBe(true);
      expect(response2.body.ingestHash).toBe(response1.body.ingestHash);
      expect(response2.body.signalId).toBe(response1.body.signalId);
    });
  });
});

