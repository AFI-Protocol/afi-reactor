import { MongoClient } from "mongodb";
import { config } from "dotenv";
config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = "afi";
const COLLECTION = "tssd_signals";

async function storeSignal(signal: any) {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);
    await collection.insertOne(signal);
    console.log("🏦 Stored signal to MongoDB:", signal.signalId);
  } catch (err) {
    console.error("❌ Failed to store signal:", err);
  } finally {
    await client.close();
  }
}

export default {
  run: async (signal: any) => {
    await storeSignal(signal);
    return {
      ...signal,
      vaultStatus: "stored",
    };
  },
};