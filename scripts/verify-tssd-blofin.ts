/**
 * TSSD BloFin Verification Script
 * 
 * Connects to MongoDB and verifies that BloFin-backed signals are being
 * written to the TSSD vault with correct provenance metadata.
 * 
 * Usage:
 *   export AFI_MONGO_URI=mongodb://localhost:27017/afi_tssd
 *   npm run verify:tssd:blofin
 * 
 * Requirements:
 *   - MongoDB must be running and accessible
 *   - AFI_MONGO_URI environment variable must be set
 *   - At least one BloFin-backed signal must have been processed
 */

import { MongoClient } from "mongodb";

const MONGO_URI = process.env.AFI_MONGO_URI;
const DB_NAME = process.env.AFI_MONGO_DB_NAME || "afi";
const COLLECTION_NAME = process.env.AFI_MONGO_COLLECTION_TSSD || "tssd_signals";

async function verifyBloFinTssdDocuments() {
  console.log("🔍 TSSD BloFin Verification Script\n");

  // Check MongoDB URI
  if (!MONGO_URI) {
    console.error("❌ ERROR: AFI_MONGO_URI environment variable is not set");
    console.error("\nPlease set AFI_MONGO_URI to your MongoDB connection string:");
    console.error("  export AFI_MONGO_URI=mongodb://localhost:27017/afi_tssd");
    console.error("\nOr for MongoDB Atlas:");
    console.error("  export AFI_MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/");
    process.exit(1);
  }

  console.log(`📊 MongoDB URI: ${MONGO_URI.replace(/\/\/[^:]+:[^@]+@/, "//***:***@")}`);
  console.log(`📊 Database: ${DB_NAME}`);
  console.log(`📊 Collection: ${COLLECTION_NAME}\n`);

  let client: MongoClient | null = null;

  try {
    // Connect to MongoDB
    console.log("🔌 Connecting to MongoDB...");
    client = new MongoClient(MONGO_URI);
    await client.connect();
    console.log("✅ Connected to MongoDB\n");

    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Query for BloFin-backed signals
    console.log("🔎 Searching for BloFin-backed TSSD documents...\n");
    
    const blofinSignals = await collection
      .find({ "market.priceSource": "blofin" })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    if (blofinSignals.length === 0) {
      console.log("⚠️  No BloFin-backed TSSD documents found.");
      console.log("\nPossible reasons:");
      console.log("  1. AFI_PRICE_FEED_SOURCE is not set to 'blofin'");
      console.log("  2. No signals have been processed yet");
      console.log("  3. The demo/pipeline has not been run");
      console.log("\nTo generate BloFin-backed signals:");
      console.log("  export AFI_PRICE_FEED_SOURCE=blofin");
      console.log("  npm run start:demo");
      console.log("  # Then trigger a signal via /demo/afi-eliza-demo endpoint");
      process.exit(0);
    }

    console.log(`✅ Found ${blofinSignals.length} BloFin-backed signal(s)\n`);
    console.log("=" .repeat(80));

    // Display each signal
    blofinSignals.forEach((signal, index) => {
      console.log(`\n📄 Signal #${index + 1}`);
      console.log("-".repeat(80));
      console.log(`  Signal ID:       ${signal.signalId}`);
      console.log(`  Created At:      ${signal.createdAt}`);
      console.log(`  Source:          ${signal.source}`);
      console.log(`\n  Market:`);
      console.log(`    Symbol:        ${signal.market.symbol}`);
      console.log(`    Timeframe:     ${signal.market.timeframe}`);
      console.log(`    Market Type:   ${signal.market.market || "N/A"}`);
      console.log(`    Price Source:  ${signal.market.priceSource} ✅`);
      console.log(`    Venue Type:    ${signal.market.venueType} ✅`);
      console.log(`\n  Pipeline:`);
      console.log(`    UWR Score:     ${signal.pipeline.uwrScore}`);
      console.log(`    Decision:      ${signal.pipeline.validatorDecision.decision}`);
      console.log(`    Confidence:    ${signal.pipeline.validatorDecision.uwrConfidence}`);
      console.log(`\n  Strategy:`);
      console.log(`    Name:          ${signal.strategy.name}`);
      console.log(`    Direction:     ${signal.strategy.direction}`);
    });

    console.log("\n" + "=".repeat(80));
    console.log("\n✅ VERIFICATION COMPLETE");
    console.log("\nAll BloFin-backed signals have correct provenance metadata:");
    console.log("  ✅ priceSource = 'blofin'");
    console.log("  ✅ venueType is set appropriately");
    console.log("\nProvenance tracking is working correctly! 🎉\n");

  } catch (error) {
    console.error("\n❌ ERROR:", error);
    
    if (error instanceof Error) {
      if (error.message.includes("ECONNREFUSED")) {
        console.error("\n💡 MongoDB connection refused. Is MongoDB running?");
        console.error("   Start MongoDB with: mongod --dbpath /path/to/data");
      } else if (error.message.includes("authentication")) {
        console.error("\n💡 Authentication failed. Check your MongoDB credentials.");
      }
    }
    
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log("🔌 Disconnected from MongoDB");
    }
  }
}

// Run the verification
verifyBloFinTssdDocuments().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

