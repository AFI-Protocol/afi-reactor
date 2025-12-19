/**
 * MTProto Collector State Persistence
 * 
 * Tracks last-seen message IDs per channel to avoid re-processing messages on restart.
 * 
 * This is collector-side dedupe (lightweight) - server-side ingest dedupe via ingestHash
 * is still the primary mechanism.
 * 
 * @module mtprotoState
 */

import * as fs from "fs";
import * as path from "path";

/**
 * State structure
 */
interface CollectorState {
  channels: {
    [channelId: string]: {
      lastMessageId: number;
      lastUpdated: string;
    };
  };
}

/**
 * State manager for MTProto collector
 */
export class MtprotoStateManager {
  private statePath: string;
  private state: CollectorState;

  constructor(statePath: string) {
    this.statePath = statePath;
    this.state = this.loadState();
  }

  /**
   * Get last seen message ID for a channel
   */
  getLastMessageId(channelId: string): number {
    return this.state.channels[channelId]?.lastMessageId || 0;
  }

  /**
   * Update last seen message ID for a channel
   */
  updateLastMessageId(channelId: string, messageId: number): void {
    if (!this.state.channels[channelId]) {
      this.state.channels[channelId] = {
        lastMessageId: messageId,
        lastUpdated: new Date().toISOString(),
      };
    } else {
      // Only update if newer
      if (messageId > this.state.channels[channelId].lastMessageId) {
        this.state.channels[channelId].lastMessageId = messageId;
        this.state.channels[channelId].lastUpdated = new Date().toISOString();
      }
    }

    // Save to disk
    this.saveState();
  }

  /**
   * Load state from file
   */
  private loadState(): CollectorState {
    try {
      if (fs.existsSync(this.statePath)) {
        const data = fs.readFileSync(this.statePath, "utf-8");
        const state = JSON.parse(data);
        console.log(`📂 Loaded collector state from ${this.statePath}`);
        return state;
      }
    } catch (error: any) {
      console.warn(`⚠️  Could not load state: ${error.message}`);
    }

    return { channels: {} };
  }

  /**
   * Save state to file
   */
  private saveState(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.statePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (error: any) {
      console.error(`❌ Could not save state: ${error.message}`);
    }
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.state = { channels: {} };
    this.saveState();
  }
}

