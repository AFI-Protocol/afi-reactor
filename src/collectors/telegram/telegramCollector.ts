/**
 * Telegram Collector
 * 
 * Polls Telegram channels for new trading signals and posts CPJ payloads to the reactor.
 * 
 * Uses Telegram Bot API with long polling to fetch new messages.
 * 
 * Environment variables:
 * - AFI_TELEGRAM_ENABLED=1 - Enable collector
 * - AFI_TELEGRAM_TOKEN - Bot token from @BotFather
 * - AFI_TELEGRAM_CHANNELS - Comma-separated channel IDs or @usernames
 * - AFI_TELEGRAM_POLL_INTERVAL_MS - Poll interval (default: 5000)
 * - AFI_CPJ_INGEST_URL - Reactor CPJ endpoint URL
 * - WEBHOOK_SHARED_SECRET - Shared secret for authentication
 * 
 * @module telegramCollector
 */

import TelegramBot from "node-telegram-bot-api";
import { parseTelegramMessage, type TelegramMessage } from "./telegramParser.js";

/**
 * Telegram collector configuration
 */
interface TelegramCollectorConfig {
  token: string;
  channels: string[];
  pollIntervalMs: number;
  ingestUrl: string;
  sharedSecret: string;
  minConfidence: number;
}

/**
 * Telegram collector class
 */
export class TelegramCollector {
  private bot: TelegramBot;
  private config: TelegramCollectorConfig;
  private lastUpdateId: number = 0;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(config: TelegramCollectorConfig) {
    this.config = config;
    this.bot = new TelegramBot(config.token, { polling: false });
  }

  /**
   * Start collecting messages
   */
  async start(): Promise<void> {
    console.log(`🤖 Starting Telegram collector...`);
    console.log(`   Channels: ${this.config.channels.join(", ")}`);
    console.log(`   Poll interval: ${this.config.pollIntervalMs}ms`);
    console.log(`   Min confidence: ${this.config.minConfidence}`);

    // Start polling loop
    this.pollMessages();
  }

  /**
   * Stop collecting messages
   */
  async stop(): Promise<void> {
    console.log(`🛑 Stopping Telegram collector...`);
    
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    await this.bot.stopPolling();
  }

  /**
   * Poll for new messages
   */
  private async pollMessages(): Promise<void> {
    try {
      // Get updates since last poll
      const updates = await this.bot.getUpdates({
        offset: this.lastUpdateId + 1,
        timeout: 30,
      });

      for (const update of updates) {
        this.lastUpdateId = update.update_id;

        // Process channel posts
        if (update.channel_post) {
          await this.processMessage(update.channel_post as any);
        }

        // Process regular messages (for testing with personal chats)
        if (update.message) {
          await this.processMessage(update.message as any);
        }
      }
    } catch (error: any) {
      console.error(`❌ Error polling Telegram:`, error.message);
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => {
      this.pollMessages();
    }, this.config.pollIntervalMs);
  }

  /**
   * Process a single message
   */
  private async processMessage(message: TelegramMessage): Promise<void> {
    const chatId = message.chat.id.toString();
    const chatUsername = message.chat.username;

    // Check if this channel is in our watch list
    const isWatched = this.config.channels.some(
      (ch) => ch === chatId || ch === `@${chatUsername}` || ch === chatUsername
    );

    if (!isWatched) {
      return; // Skip messages from unwatched channels
    }

    console.log(`📨 New message from ${message.chat.title || chatUsername}:`, {
      messageId: message.message_id,
      text: message.text?.substring(0, 100),
    });

    // Parse message into CPJ
    const parseResult = parseTelegramMessage(message);

    if (!parseResult.cpj) {
      console.log(`   ⏭️  Skipped: ${parseResult.reason}`);
      return;
    }

    if (parseResult.confidence < this.config.minConfidence) {
      console.log(`   ⏭️  Skipped: Low confidence (${parseResult.confidence.toFixed(2)} < ${this.config.minConfidence})`);
      return;
    }

    // Post CPJ to reactor
    await this.postCpjToReactor(parseResult.cpj);
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
          decision: result.pipelineResult?.validatorDecision?.decision,
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
}

/**
 * Create and start Telegram collector from environment variables
 */
export async function startTelegramCollector(): Promise<TelegramCollector | null> {
  const enabled = process.env.AFI_TELEGRAM_ENABLED === "1";
  
  if (!enabled) {
    return null;
  }

  const token = process.env.AFI_TELEGRAM_TOKEN;
  const channelsStr = process.env.AFI_TELEGRAM_CHANNELS;
  const ingestUrl = process.env.AFI_CPJ_INGEST_URL || "http://localhost:8080/api/ingest/cpj";
  const sharedSecret = process.env.WEBHOOK_SHARED_SECRET || "";
  const pollIntervalMs = parseInt(process.env.AFI_TELEGRAM_POLL_INTERVAL_MS || "5000", 10);
  const minConfidence = parseFloat(process.env.AFI_CPJ_MIN_CONFIDENCE || "0.55");

  if (!token) {
    console.error(`❌ AFI_TELEGRAM_TOKEN not set`);
    return null;
  }

  if (!channelsStr) {
    console.error(`❌ AFI_TELEGRAM_CHANNELS not set`);
    return null;
  }

  const channels = channelsStr.split(",").map((ch) => ch.trim());

  const collector = new TelegramCollector({
    token,
    channels,
    pollIntervalMs,
    ingestUrl,
    sharedSecret,
    minConfidence,
  });

  await collector.start();

  return collector;
}

