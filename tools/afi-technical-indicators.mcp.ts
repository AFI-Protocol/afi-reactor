import { MongoClient } from "mongodb";
import { Signal } from "../types/Signal.js"; // Ensure this path reflects your actual structure

export async function analyze(signal: Signal): Promise<Signal & { sma: number }> {
  const SMA_PERIOD = 5;
  const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
  const DB_NAME = "afi";
  const COLLECTION_NAME = "tssd_signals";

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const collection = db.collection(COLLECTION_NAME);

  const recentSignals = await collection
    .find({})
    .sort({ timestamp: -1 })
    .limit(SMA_PERIOD)
    .toArray();

  await client.close();

  const closes = recentSignals.map((s) => s.score || 0);
  const sma = closes.reduce((acc, val) => acc + val, 0) / SMA_PERIOD;

  console.log(`📈 Calculated SMA(${SMA_PERIOD}) = ${sma.toFixed(4)}`);

  return {
    ...signal,
    sma: parseFloat(sma.toFixed(4)),
  };
}

export default { analyze };