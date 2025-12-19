// @ts-nocheck
/**
 * Telegram MTProto Collector
 * 
 * Collects messages from Telegram channels using MTProto user-client (gramJS).
 * 
 * Unlike the Bot API collector, this can read public channels without admin rights.
 * 
 * Environment variables:
 * - AFI_TELEGRAM_MTPROTO_ENABLED=1 - Enable collector
 * - AFI_TELEGRAM_MTPROTO_CHANNELS - Comma-separated channel usernames/IDs
 * - AFI_TELEGRAM_MTPROTO_FETCH_HISTORY=0|1 - Fetch history on startup (default: 0)
 * - AFI_TELEGRAM_MTPROTO_HISTORY_LIMIT=50 - Max messages to fetch from history
 * - AFI_TELEGRAM_MTPROTO_THROTTLE_MS=500 - Throttle delay for joins/fetches
 * - AFI_TELEGRAM_MTPROTO_STATE_PATH - Path to state file (default: ./.secrets/telegram_mtproto.state.json)
 * - AFI_CPJ_INGEST_URL - Reactor CPJ endpoint
 * - WEBHOOK_SHARED_SECRET - Shared secret for auth
 * - AFI_CPJ_MIN_CONFIDENCE - Min confidence threshold
 * 
 * @module mtprotoCollector
 */

import { Api } from "telegram";
import { NewMessage, NewMessageEvent } from "telegram/events/index.js";
import type { MtprotoClient } from "./mtprotoClient.js";
import { convertMessageToCpj } from "./mtprotoToCpj.js";
import { MtprotoStateManager } from "./mtprotoState.js";

/**
 * MTProto collector configuration
 */
export interface MtprotoCollectorConfig {
  channels: string[];
  fetchHistory: boolean;
  historyLimit: number;
  throttleMs: number;
  statePath: string;
  ingestUrl: string;
  sharedSecret: string;
  minConfidence: number;
}

/**
 * MTProto collector class
 */
export class MtprotoCollector {
  private client: MtprotoClient;
  private config: MtprotoCollectorConfig;
  private stateManager: MtprotoStateManager;
  private channelEntities: Map<string, any> = new Map();

  constructor(client: MtprotoClient, config: MtprotoCollectorConfig) {
    this.client = client;
    this.config = config;
    this.stateManager = new MtprotoStateManager(config.statePath);
  }

  /**
   * Start collecting messages
   */
  async start(): Promise<void> {
    console.log(`🤖 Starting Telegram MTProto collector...`);
    console.log(`   Channels: ${this.config.channels.join(", ")}`);
    console.log(`   Fetch history: ${this.config.fetchHistory}`);
    console.log(`   Min confidence: ${this.config.minConfidence}`);

    const telegramClient = this.client.getClient();

    // Join/resolve channels
    for (const channel of this.config.channels) {
      await this.joinChannel(channel);
      await this.sleep(this.config.throttleMs);
    }

    // Fetch history if enabled
    if (this.config.fetchHistory) {
      for (const channel of this.config.channels) {
        await this.fetchChannelHistory(channel);
        await this.sleep(this.config.throttleMs);
      }
    }

    // Subscribe to new messages
    telegramClient.addEventHandler(
      this.handleNewMessage.bind(this),
      new NewMessage({})
    );

    console.log(`✅ MTProto collector started and listening for new messages`);
  }

  /**
   * Stop collecting messages
   */
  async stop(): Promise<void> {
    console.log(`🛑 Stopping MTProto collector...`);
    // Event handlers are cleaned up when client disconnects
  }

  /**
   * Join/resolve a channel
   */
  private async joinChannel(channel: string): Promise<void> {
    try {
      const telegramClient = this.client.getClient();
      
      console.log(`📡 Resolving channel: ${channel}`);
      
      const entity = await telegramClient.getEntity(channel);
      const channelId = this.getChannelId(entity);
      
      this.channelEntities.set(channelId, entity);
      
      console.log(`✅ Resolved channel: ${channel} (ID: ${channelId})`);
    } catch (error: any) {
      console.error(`❌ Failed to resolve channel ${channel}:`, error.message);
    }
  }

  /**
   * Fetch channel history
   */
  private async fetchChannelHistory(channel: string): Promise<void> {
    try {
      const telegramClient = this.client.getClient();
      const entity = await telegramClient.getEntity(channel);
      const channelId = this.getChannelId(entity);
      
      const lastSeenId = this.stateManager.getLastMessageId(channelId);
      
      console.log(`📜 Fetching history for ${channel} (last seen: ${lastSeenId})`);

      const messages = await telegramClient.getMessages(entity, {
        limit: this.config.historyLimit,
      });

      let processedCount = 0;
      
      for (const message of messages) {
        if (message instanceof Api.Message) {
          // Skip if we've seen this message before
          if (message.id <= lastSeenId) {
            continue;
          }

          await this.processMessage(message, channelId, channel);
          processedCount++;
        }
      }

      console.log(`✅ Processed ${processedCount} historical messages from ${channel}`);
    } catch (error: any) {
      console.error(`❌ Failed to fetch history for ${channel}:`, error.message);
    }
  }

  /**
   * Handle new message event
   */
  private async handleNewMessage(event: NewMessageEvent): Promise<void> {
    const message = event.message;
    
    if (!(message instanceof Api.Message)) {
      return;
    }

    // Get channel info
    const chatId = message.chatId?.toString();
    if (!chatId) {
      return;
    }

    // Check if this is from a channel we're monitoring
    const channelEntity = this.channelEntities.get(chatId);
    if (!channelEntity) {
      return;
    }

    const channelUsername = this.getChannelUsername(channelEntity);
    
    await this.processMessage(message, chatId, channelUsername);
  }

  /**
   * Process a single message
   */
  private async processMessage(
    message: Api.Message,
    channelId: string,
    channelUsername: string
  ): Promise<void> {
    console.log(`📨 New message from ${channelUsername}:`, {
      messageId: message.id,
      text: message.message?.substring(0, 100),
    });

    // Convert to CPJ
    const result = convertMessageToCpj(message, channelId, channelUsername);

    if (!result.cpj) {
      console.log(`   ⏭️  Skipped: ${result.reason}`);
      return;
    }

    if (result.confidence < this.config.minConfidence) {
      console.log(`   ⏭️  Skipped: Low confidence (${result.confidence.toFixed(2)} < ${this.config.minConfidence})`);
      return;
    }

    // Post CPJ to reactor
    await this.postCpjToReactor(result.cpj);

    // Update state
    this.stateManager.updateLastMessageId(channelId, message.id);
  }

  /**
   * Post CPJ payload to reactor endpoint
   */
  private async postCpjToReactor(cpj: any): Promise<void> {
    try {
      const response = await fetch(this.config.ingestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": this.config.sharedSecret,
        },
        body: JSON.stringify(cpj),
      });

      const result = await response.json();

      if (response.ok) {
        console.log(`   ✅ Ingested:`, {
          signalId: result.signalId,
          ingestHash: result.ingestHash?.substring(0, 16) + "...",
          uwrScore: result.pipelineResult?.analystScore?.uwrScore,
        });
      } else if (response.status === 409) {
        console.log(`   ⚠️  Duplicate: ${result.ingestHash?.substring(0, 16)}...`);
      } else if (response.status === 422) {
        console.log(`   ❌ Symbol normalization failed:`, {
          symbolRaw: result.symbolRaw,
          reason: result.reason,
        });
      } else {
        console.error(`   ❌ Ingestion failed (${response.status}):`, result.error || result.message);
      }
    } catch (error: any) {
      console.error(`   ❌ Error posting to reactor:`, error.message);
    }
  }

  // Helper methods
  private getChannelId(entity: any): string {
    return entity.id?.toString() || "unknown";
  }

  private getChannelUsername(entity: any): string {
    return entity.username || `channel-${entity.id}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create and start MTProto collector from environment variables
 */
export async function startMtprotoCollector(client: MtprotoClient): Promise<MtprotoCollector | null> {
  const enabled = process.env.AFI_TELEGRAM_MTPROTO_ENABLED === "1";

  if (!enabled) {
    return null;
  }

  const channelsStr = process.env.AFI_TELEGRAM_MTPROTO_CHANNELS;
  const fetchHistory = process.env.AFI_TELEGRAM_MTPROTO_FETCH_HISTORY === "1";
  const historyLimit = parseInt(process.env.AFI_TELEGRAM_MTPROTO_HISTORY_LIMIT || "50", 10);
  const throttleMs = parseInt(process.env.AFI_TELEGRAM_MTPROTO_THROTTLE_MS || "500", 10);
  const statePath = process.env.AFI_TELEGRAM_MTPROTO_STATE_PATH || "./.secrets/telegram_mtproto.state.json";
  const ingestUrl = process.env.AFI_CPJ_INGEST_URL || "http://localhost:8080/api/ingest/cpj";
  const sharedSecret = process.env.WEBHOOK_SHARED_SECRET || "";
  const minConfidence = parseFloat(process.env.AFI_CPJ_MIN_CONFIDENCE || "0.55");

  if (!channelsStr) {
    console.error(`❌ AFI_TELEGRAM_MTPROTO_CHANNELS not set`);
    return null;
  }

  const channels = channelsStr.split(",").map((ch) => ch.trim());

  const collector = new MtprotoCollector(client, {
    channels,
    fetchHistory,
    historyLimit,
    throttleMs,
    statePath,
    ingestUrl,
    sharedSecret,
    minConfidence,
  });

  await collector.start();

  return collector;
}
// @ts-nocheck
