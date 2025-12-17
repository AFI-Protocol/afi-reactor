/**
 * Ingest Dedupe Service
 * 
 * Lightweight in-memory LRU cache for preventing duplicate CPJ ingestions
 * within a configurable time window.
 * 
 * Enabled via AFI_INGEST_DEDUPE=1 environment variable.
 * 
 * @module ingestDedupeService
 */

/**
 * Dedupe cache entry
 */
interface DedupeCacheEntry {
  ingestHash: string;
  signalId: string;
  firstSeenAt: Date;
}

/**
 * Simple time-based LRU cache for dedupe
 */
class IngestDedupeCache {
  private cache: Map<string, DedupeCacheEntry> = new Map();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMinutes: number = 60, maxSize: number = 10000) {
    this.ttlMs = ttlMinutes * 60 * 1000;
    this.maxSize = maxSize;
  }

  /**
   * Check if an ingestHash has been seen recently
   * 
   * @param ingestHash - SHA256 hash of CPJ payload
   * @returns Existing entry if duplicate, undefined otherwise
   */
  check(ingestHash: string): DedupeCacheEntry | undefined {
    const entry = this.cache.get(ingestHash);
    
    if (!entry) {
      return undefined;
    }

    // Check if entry has expired
    const age = Date.now() - entry.firstSeenAt.getTime();
    if (age > this.ttlMs) {
      this.cache.delete(ingestHash);
      return undefined;
    }

    return entry;
  }

  /**
   * Record a new ingest
   * 
   * @param ingestHash - SHA256 hash of CPJ payload
   * @param signalId - Generated signal ID
   */
  record(ingestHash: string, signalId: string): void {
    // Evict oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(ingestHash, {
      ingestHash,
      signalId,
      firstSeenAt: new Date(),
    });
  }

  /**
   * Cleanup expired entries (called periodically)
   */
  cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [hash, entry] of this.cache.entries()) {
      const age = now - entry.firstSeenAt.getTime();
      if (age > this.ttlMs) {
        toDelete.push(hash);
      }
    }

    for (const hash of toDelete) {
      this.cache.delete(hash);
    }
  }

  /**
   * Get cache stats for monitoring
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMinutes: this.ttlMs / 60000,
    };
  }

  /**
   * Clear all entries (for testing/shutdown)
   */
  clear(): void {
    this.cache.clear();
  }
}

// Singleton instance
let dedupeCache: IngestDedupeCache | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize dedupe cache if AFI_INGEST_DEDUPE=1
 */
export function initDedupeCache(): void {
  const enabled = process.env.AFI_INGEST_DEDUPE === "1";

  if (enabled && !dedupeCache) {
    const ttlMinutes = parseInt(process.env.AFI_INGEST_DEDUPE_TTL_MINUTES || "60", 10);
    const maxSize = parseInt(process.env.AFI_INGEST_DEDUPE_MAX_SIZE || "10000", 10);

    dedupeCache = new IngestDedupeCache(ttlMinutes, maxSize);

    // Cleanup expired entries every 5 minutes
    // Use .unref() to prevent keeping the process alive in tests
    cleanupInterval = setInterval(() => {
      dedupeCache?.cleanup();
    }, 5 * 60 * 1000);
    cleanupInterval.unref();

    console.log(`✅ Ingest dedupe cache initialized (TTL: ${ttlMinutes}m, Max: ${maxSize})`);
  }
}

/**
 * Shutdown dedupe cache (for testing/graceful shutdown)
 */
export function shutdownDedupeCache(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  if (dedupeCache) {
    dedupeCache.clear();
    dedupeCache = null;
  }
}

/**
 * Check if an ingest is a duplicate
 * 
 * @param ingestHash - SHA256 hash of CPJ payload
 * @returns Existing entry if duplicate, undefined otherwise
 */
export function checkDuplicate(ingestHash: string): DedupeCacheEntry | undefined {
  if (!dedupeCache) {
    return undefined;
  }
  return dedupeCache.check(ingestHash);
}

/**
 * Record a new ingest
 * 
 * @param ingestHash - SHA256 hash of CPJ payload
 * @param signalId - Generated signal ID
 */
export function recordIngest(ingestHash: string, signalId: string): void {
  if (dedupeCache) {
    dedupeCache.record(ingestHash, signalId);
  }
}

