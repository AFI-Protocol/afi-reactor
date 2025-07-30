import { MongoClient, Db, Collection } from 'mongodb';

export interface VaultedSignal {
  signalId: string;
  score: number;
  confidence?: number;
  timestamp: Date;
  meta: Record<string, any>;
  relatedSignals?: string[];
  lineage?: string;
  cognitiveTags?: string[];
}

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = 'afi_protocol';
const collectionName = 'tssd_vault';

const client = new MongoClient(uri);
let db: Db;
let collection: Collection<VaultedSignal>;

async function initVaultCollection(): Promise<void> {
  if (!db) {
    await client.connect();
    db = client.db(dbName);
  }

  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (collections.length === 0) {
    await db.createCollection(collectionName, {
      timeseries: {
        timeField: 'timestamp',
        metaField: 'meta',
        granularity: 'minutes'
      }
    });
    console.log(`📘 Created time-series collection: ${collectionName}`);
  }

  collection = db.collection<VaultedSignal>(collectionName);
}

export async function insertVaultedSignal(signal: VaultedSignal) {
  try {
    await initVaultCollection();

    const result = await collection.insertOne(signal);
    console.log(`✅ Vaulted signal inserted with _id: ${result.insertedId}`);
    return result;
  } catch (err) {
    console.error('❌ Error inserting vaulted signal:', err);
    throw err;
  }
}

export async function closeMongoConnection() {
  await client.close();
}