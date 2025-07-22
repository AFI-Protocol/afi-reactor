// plugins/replay-scoring.ts
import { MongoClient } from "mongodb";
import path from "path";
import { pathToFileURL } from "url";

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = "eliza";
const COLLECTION = "tssd_signals";

export default {
  run: async (_input: any) => {
    console.log("⏪ Replaying stored signals for scoring...");

    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    const signals = await collection.find({}).toArray();
    console.log(`📦 Retrieved ${signals.length} stored signals.`);

    const results = [];

    for (const signal of signals) {
      try {
        const pluginPath = path.resolve("plugins/afi-ensemble-scorer.ts");
        const pluginUrl = pathToFileURL(pluginPath).href;
        const scorerModule = await import(pluginUrl);
        const scorer = scorerModule.default;

        if (typeof scorer?.run !== "function") {
          console.warn("⚠️ Scorer plugin missing run function.");
          continue;
        }

        const newScore = await scorer.run(signal);

        results.push({
          signalId: signal.signalId,
          oldScore: signal.score,
          newScore: newScore.score,
          delta: newScore.score - signal.score,
        });
      } catch (err) {
        console.error("❌ Error during replay scoring:", err);
      }
    }

    await client.close();

    console.log("📊 Replay results:");
    for (const result of results) {
      console.log(
        `🔁 ${result.signalId} | Δ Score: ${result.delta.toFixed(4)}`
      );
    }

    return { total: results.length, results };
  },
};