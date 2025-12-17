/**
 * CPJ Ingestion Smoke Test
 *
 * This script performs an end-to-end smoke test of the CPJ ingestion lane:
 * 1. Imports the Express app (without starting the server)
 * 2. POSTs CPJ fixtures using supertest
 * 3. Asserts 200 OK responses with expected fields
 *
 * Usage:
 *   npm run test:cpj:smoke
 *   or
 *   node --loader ts-node/esm scripts/cpj_smoke.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import request from "supertest";
import app from "../src/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set NODE_ENV to test to prevent server from auto-starting
process.env.NODE_ENV = "test";

interface CpjResponse {
  ok: boolean;
  signalId: string;
  providerId: string;
  ingestHash: string;
  uss: any;
  pipelineResult: any;
}

async function runSmokeTest() {
  console.log("🧪 CPJ Ingestion Smoke Test\n");

  let passCount = 0;
  let failCount = 0;

  // Test 1: BloFin perp signal
  try {
    console.log("Test 1: BloFin perp signal (telegram-blofin-perp.example.json)");
    // Path from afi-reactor/dist/scripts/ to afi-config/examples/
    const blofinFixture = JSON.parse(
      readFileSync(
        join(__dirname, "../../../afi-config/examples/cpj/v0_1/telegram-blofin-perp.example.json"),
        "utf-8"
      )
    );

    const res1 = await request(app)
      .post("/api/ingest/cpj")
      .send(blofinFixture)
      .expect(200);

    const body1 = res1.body as CpjResponse;

    // Assertions
    if (!body1.ok) throw new Error("Expected ok: true");
    if (!body1.signalId) throw new Error("Missing signalId");
    if (!body1.providerId) throw new Error("Missing providerId");
    if (!body1.ingestHash) throw new Error("Missing ingestHash");
    if (!body1.uss) throw new Error("Missing uss");
    if (!body1.pipelineResult) throw new Error("Missing pipelineResult");

    console.log(`  ✅ signalId: ${body1.signalId}`);
    console.log(`  ✅ providerId: ${body1.providerId}`);
    console.log(`  ✅ ingestHash: ${body1.ingestHash.substring(0, 16)}...`);
    console.log(`  ✅ USS symbol: ${body1.uss.facts?.symbol}`);
    console.log(`  ✅ Pipeline result received\n`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ FAILED:`, err);
    failCount++;
  }

  // Test 2: Coinbase spot signal
  try {
    console.log("Test 2: Coinbase spot signal (telegram-coinbase-spot.example.json)");
    // Path from afi-reactor/dist/scripts/ to afi-config/examples/
    const coinbaseFixture = JSON.parse(
      readFileSync(
        join(__dirname, "../../../afi-config/examples/cpj/v0_1/telegram-coinbase-spot.example.json"),
        "utf-8"
      )
    );

    const res2 = await request(app)
      .post("/api/ingest/cpj")
      .send(coinbaseFixture)
      .expect(200);

    const body2 = res2.body as CpjResponse;

    // Assertions
    if (!body2.ok) throw new Error("Expected ok: true");
    if (!body2.signalId) throw new Error("Missing signalId");
    if (!body2.providerId) throw new Error("Missing providerId");
    if (!body2.ingestHash) throw new Error("Missing ingestHash");
    if (body2.uss.facts?.symbol !== "SOL/USD") {
      throw new Error(`Expected symbol SOL/USD, got ${body2.uss.facts?.symbol}`);
    }

    console.log(`  ✅ signalId: ${body2.signalId}`);
    console.log(`  ✅ providerId: ${body2.providerId}`);
    console.log(`  ✅ ingestHash: ${body2.ingestHash.substring(0, 16)}...`);
    console.log(`  ✅ USS symbol: ${body2.uss.facts?.symbol}`);
    console.log(`  ✅ Pipeline result received\n`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ FAILED:`, err);
    failCount++;
  }

  // Test 3: Invalid CPJ (missing required fields)
  try {
    console.log("Test 3: Invalid CPJ (should return 400)");
    const invalidCpj = {
      schema: "afi.cpj.v0.1",
      provenance: {
        providerType: "telegram",
        // Missing required fields
      },
      extracted: {
        symbolRaw: "BTCUSDT",
        side: "long",
      },
      parse: {
        parserId: "test",
        parserVersion: "1.0.0",
        confidence: 0.9,
      },
    };

    const res3 = await request(app)
      .post("/api/ingest/cpj")
      .send(invalidCpj)
      .expect(400);

    if (!res3.body.error) throw new Error("Expected error field in response");
    console.log(`  ✅ Correctly rejected invalid CPJ with 400`);
    console.log(`  ✅ Error: ${res3.body.error}\n`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ FAILED:`, err);
    failCount++;
  }

  // Summary
  console.log("━".repeat(60));
  console.log(`\n📊 Smoke Test Results:`);
  console.log(`   ✅ Passed: ${passCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   Total:  ${passCount + failCount}\n`);

  if (failCount > 0) {
    process.exit(1);
  } else {
    console.log("🎉 All smoke tests passed!\n");
    process.exit(0);
  }
}

runSmokeTest().catch((err) => {
  console.error("💥 Smoke test crashed:", err);
  process.exit(1);
});

