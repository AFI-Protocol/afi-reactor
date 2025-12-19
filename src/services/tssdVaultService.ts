/**
 * Reactor Scored Signal Vault Service
 *
 * Provides MongoDB persistence for scored signals from AFI Reactor.
 *
 * ISOLATION: This service uses Reactor-owned collections, isolated from afi-infra TSSD vault.
 *
 * Features:
 * - Lazy connection (connects on first insert)
 * - Graceful degradation (if MongoDB unavailable, logs error but doesn't crash)
 * - Singleton pattern (shared connection across requests)
 * - ESM-compliant (no .ts imports, .js extensions on relative imports)
 *
 * Environment Variables:
 * - AFI_MONGO_URI: MongoDB connection string (required)
 * - AFI_MONGO_DB_NAME: Database name (default: "afi_reactor")
 * - AFI_MONGO_COLLECTION_SCORED: Collection name (default: "reactor_scored_signals_v1")
 *
 * @module tssdVaultService
 */

import { MongoClient, Db, Collection } from "mongodb";
import type { ReactorScoredSignalDocument } from "../types/ReactorScoredSignalV1.js";

export type VaultWriteStatus = "success" | "skipped" | "failed" | "failed-missing-provenance";

/**
 * Reactor Vault Service Configuration
 */
export interface ReactorVaultConfig {
  uri: string;
  dbName: string;
  collectionName: string;
}

/**
 * Reactor Scored Signal Vault Service
 *
 * Singleton service for persisting scored signals to MongoDB.
 */
export class TssdVaultService {
  private static instance: TssdVaultService | null = null;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private collection: Collection<ReactorScoredSignalDocument> | null = null;
  private config: ReactorVaultConfig;
  private isConnected: boolean = false;

  private constructor(config: ReactorVaultConfig) {
    this.config = config;
  }

  /**
   * Get or create the singleton instance
   */
  static getInstance(): TssdVaultService | null {
    const uri = process.env.AFI_MONGO_URI;
    const dbName = process.env.AFI_MONGO_DB_NAME || "afi_reactor";
    const collectionName = process.env.AFI_MONGO_COLLECTION_SCORED || "reactor_scored_signals_v1";

    if (!uri) {
      console.info("ℹ️  Reactor vault disabled: AFI_MONGO_URI not set");
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
      this.collection = this.db.collection<ReactorScoredSignalDocument>(this.config.collectionName);
      this.isConnected = true;
      console.info(`✅ Reactor vault connected: ${this.config.dbName}.${this.config.collectionName}`);
    } catch (error) {
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Insert a scored signal document into the Reactor vault
   *
   * @param doc - Reactor scored signal document to insert
   * @returns Vault write status
   */
  async insertSignalDocument(doc: ReactorScoredSignalDocument): Promise<VaultWriteStatus> {
    try {
      await this.connect();

      if (!this.collection) {
        throw new Error("MongoDB collection not initialized");
      }

      await this.collection.insertOne(doc as any);
      console.info(`✅ Reactor vault insert successful: signalId=${doc.signalId}`);
      return "success";
    } catch (error: any) {
      console.error(`❌ Reactor vault insert failed:`, {
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
  async getCollection(): Promise<Collection<ReactorScoredSignalDocument> | null> {
    try {
      await this.connect();
      return this.collection;
    } catch (error: any) {
      console.error(`❌ Reactor vault getCollection failed:`, error.message || String(error));
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
      console.info("🔌 Reactor vault connection closed");
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
 * Helper function to get the Reactor collection for advanced operations
 *
 * @returns MongoDB collection or null if vault disabled or connection failed
 */
export async function getReactorScoredCollection(): Promise<Collection<ReactorScoredSignalDocument> | null> {
  const service = getTssdVaultService();
  if (!service) {
    return null;
  }
  return service.getCollection();
}

/**
 * Legacy alias for backward compatibility
 * @deprecated Use getReactorScoredCollection instead
 */
export async function getTssdCollection(): Promise<Collection<ReactorScoredSignalDocument> | null> {
  return getReactorScoredCollection();
}

