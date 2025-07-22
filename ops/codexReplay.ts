import { MongoClient } from "mongodb";
import fs from "fs/promises";
import path from "path";
import { executePipeline } from "./runner/executePipeline.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = "afi";
const COLLECTION_NAME = "tssd_signals";
const OUTPUT_LOG = "codex/codex.replay.log.json";

async function fetchStoredSignals(limit = 10) {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    return await collection.find({}).sort({ timestamp: -1 }).limit(limit).toArray();
  } finally {
    await client.close();
  }
}

async function replaySignals() {
  console.log("🔁 Starting replay from vault...");
  const signals = await fetchStoredSignals();
  const results = [];

  for (const signal of signals) {
    try {
      console.log(`⚙️ Replaying signal: ${signal.signalId}`);
      const result = await executePipeline("signal-to-vault", signal);
      results.push({ signalId: signal.signalId, result });
    } catch (err) {
      console.error(`❌ Error replaying signal ${signal.signalId}:`, err);
    }
  }

  await fs.writeFile(OUTPUT_LOG, JSON.stringify(results, null, 2));
  console.log(`✅ Replay complete. Results saved to ${OUTPUT_LOG}`);
}

replaySignals().catch(console.error);