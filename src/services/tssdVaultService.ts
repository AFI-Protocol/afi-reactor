/**
 * T.S.S.D. Vault Service (Phase 1)
 * 
 * Provides MongoDB persistence for scored + validated signals from the AFI Eliza Demo pipeline.
 * 
 * Features:
 * - Lazy connection (connects on first insert)
 * - Graceful degradation (if MongoDB unavailable, logs error but doesn't crash)
 * - Singleton pattern (shared connection across requests)
 * - ESM-compliant (no .ts imports, .js extensions on relative imports)
 * 
 * Environment Variables:
 * - AFI_MONGO_URI: MongoDB connection string (required)
 * - AFI_MONGO_DB_NAME: Database name (default: "afi")
 * - AFI_MONGO_COLLECTION_TSSD: Collection name (default: "tssd_signals")
 * 
 * @module tssdVaultService
 */

import { MongoClient, Db, Collection } from "mongodb";
import type { TssdSignalDocument, VaultWriteStatus } from "../types/TssdSignalDocument.js";

/**
 * TSSD Vault Service Configuration
 */
export interface TssdVaultConfig {
  uri: string;
  dbName: string;
  collectionName: string;
}

/**
 * TSSD Vault Service
 * 
 * Singleton service for persisting signals to MongoDB.
 */
export class TssdVaultService {
  private static instance: TssdVaultService | null = null;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private collection: Collection<TssdSignalDocument> | null = null;
  private config: TssdVaultConfig;
  private isConnected: boolean = false;

  private constructor(config: TssdVaultConfig) {
    this.config = config;
  }

  /**
   * Get or create the singleton instance
   */
  static getInstance(): TssdVaultService | null {
    const uri = process.env.AFI_MONGO_URI;
    const dbName = process.env.AFI_MONGO_DB_NAME || "afi";
    const collectionName = process.env.AFI_MONGO_COLLECTION_TSSD || "tssd_signals";

    if (!uri) {
      console.info("ℹ️  TSSD vault disabled: AFI_MONGO_URI not set");
      return null;
    }

    if (!TssdVaultService.instance) {
      TssdVaultService.instance = new TssdVaultService({
        uri,
        dbName,
        collectionName,
      });
    }

    return TssdVaultService.instance;
  }

  /**
   * Connect to MongoDB (lazy connection)
   */
  private async connect(): Promise<void> {
    if (this.isConnected && this.client && this.db && this.collection) {
      return; // Already connected
    }

    try {
      this.client = new MongoClient(this.config.uri);
      await this.client.connect();
      this.db = this.client.db(this.config.dbName);
      this.collection = this.db.collection<TssdSignalDocument>(this.config.collectionName);
      this.isConnected = true;
      console.info(`✅ TSSD vault connected: ${this.config.dbName}.${this.config.collectionName}`);
    } catch (error) {
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Insert a signal document into the TSSD vault
   * 
   * @param doc - TSSD signal document to insert
   * @returns Vault write status
   */
  async insertSignalDocument(doc: TssdSignalDocument): Promise<VaultWriteStatus> {
    try {
      await this.connect();

      if (!this.collection) {
        throw new Error("MongoDB collection not initialized");
      }

      await this.collection.insertOne(doc as any);
      console.info(`✅ TSSD vault insert successful: signalId=${doc.signalId}`);
      return "success";
    } catch (error: any) {
      console.error(`❌ TSSD vault insert failed:`, {
        signalId: doc.signalId,
        error: error.message || String(error),
      });
      return "failed";
    }
  }

  /**
   * Get the MongoDB collection (for advanced operations)
   *
   * @returns MongoDB collection or null if not connected
   */
  async getCollection(): Promise<Collection<TssdSignalDocument> | null> {
    try {
      await this.connect();
      return this.collection;
    } catch (error: any) {
      console.error(`❌ TSSD vault getCollection failed:`, error.message || String(error));
      return null;
    }
  }

  /**
   * Close the MongoDB connection (for cleanup)
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      this.client = null;
      this.db = null;
      this.collection = null;
      console.info("🔌 TSSD vault connection closed");
    }
  }
}

/**
 * Helper function to get the vault service instance
 *
 * @returns TssdVaultService instance or null if disabled
 */
export function getTssdVaultService(): TssdVaultService | null {
  return TssdVaultService.getInstance();
}

/**
 * Helper function to get the TSSD collection for advanced operations
 *
 * @returns MongoDB collection or null if vault disabled or connection failed
 */
export async function getTssdCollection(): Promise<Collection<TssdSignalDocument> | null> {
  const service = getTssdVaultService();
  if (!service) {
    return null;
  }
  return service.getCollection();
}

