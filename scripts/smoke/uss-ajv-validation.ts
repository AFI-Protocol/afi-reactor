/**
 * USS v1.1 AJV Validation Smoke Test
 * 
 * Proves that AJV validation works in real Node runtime (not Jest).
 * Tests canonical USS v1.1 validation with required provenance fields.
 * 
 * Exit codes:
 * - 0: All validations passed
 * - 1: Validation failed
 */

import { validateUsignalV11 } from "../../src/uss/ussValidator.js";
import { mapTradingViewToUssV11 } from "../../src/uss/tradingViewMapper.js";

// Test 1: Valid minimal USS v1.1 payload
function testValidMinimalPayload(): boolean {
  console.log("\n[Test 1] Validating minimal USS v1.1 payload...");
  
  const validPayload = {
    schema: "afi.usignal.v1.1",
    provenance: {
      source: "tradingview-webhook",
      providerId: "test-provider",
      signalId: "test-signal-123",
    },
  };

  const result = validateUsignalV11(validPayload);

  if (result.ok) {
    console.log("✅ PASS: Minimal USS v1.1 payload validated successfully");
    return true;
  } else {
    console.error("❌ FAIL: Minimal USS v1.1 payload validation failed");
    console.error("Errors:", result.errors);
    return false;
  }
}

// Test 2: Invalid payload missing providerId
function testInvalidMissingProviderId(): boolean {
  console.log("\n[Test 2] Validating payload missing providerId (should fail)...");
  
  const invalidPayload = {
    schema: "afi.usignal.v1.1",
    provenance: {
      source: "tradingview-webhook",
      signalId: "test-signal-123",
      // Missing providerId
    },
  };

  const result = validateUsignalV11(invalidPayload);

  if (!result.ok) {
    console.log("✅ PASS: Correctly rejected payload missing providerId");
    console.log("Expected errors:", result.errors);
    return true;
  } else {
    console.error("❌ FAIL: Should have rejected payload missing providerId");
    return false;
  }
}

// Test 3: Invalid payload missing signalId
function testInvalidMissingSignalId(): boolean {
  console.log("\n[Test 3] Validating payload missing signalId (should fail)...");
  
  const invalidPayload = {
    schema: "afi.usignal.v1.1",
    provenance: {
      source: "tradingview-webhook",
      providerId: "test-provider",
      // Missing signalId
    },
  };

  const result = validateUsignalV11(invalidPayload);

  if (!result.ok) {
    console.log("✅ PASS: Correctly rejected payload missing signalId");
    console.log("Expected errors:", result.errors);
    return true;
  } else {
    console.error("❌ FAIL: Should have rejected payload missing signalId");
    return false;
  }
}

// Test 4: TradingView mapper produces valid USS v1.1
function testTradingViewMapper(): boolean {
  console.log("\n[Test 4] Validating TradingView mapper output...");
  
  const tvPayload = {
    symbol: "BTC/USDT",
    timeframe: "15m",
    strategy: "test_strategy",
    direction: "long" as const,
  };

  const uss = mapTradingViewToUssV11(tvPayload);
  const result = validateUsignalV11(uss);

  if (result.ok) {
    console.log("✅ PASS: TradingView mapper produces valid USS v1.1");
    console.log("Mapped USS:", {
      schema: uss.schema,
      providerId: uss.provenance.providerId,
      signalId: uss.provenance.signalId,
      source: uss.provenance.source,
    });
    return true;
  } else {
    console.error("❌ FAIL: TradingView mapper produced invalid USS v1.1");
    console.error("Errors:", result.errors);
    return false;
  }
}

// Run all tests
async function main() {
  console.log("=".repeat(60));
  console.log("USS v1.1 AJV Validation Smoke Test");
  console.log("=".repeat(60));

  const results = [
    testValidMinimalPayload(),
    testInvalidMissingProviderId(),
    testInvalidMissingSignalId(),
    testTradingViewMapper(),
  ];

  const allPassed = results.every((r) => r);

  console.log("\n" + "=".repeat(60));
  if (allPassed) {
    console.log("✅ ALL TESTS PASSED");
    console.log("=".repeat(60));
    process.exit(0);
  } else {
    console.error("❌ SOME TESTS FAILED");
    console.log("=".repeat(60));
    process.exit(1);
  }
}

main();

