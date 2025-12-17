/**
 * Telegram MTProto Client
 * 
 * Handles Telegram user session authentication and connection management using gramJS.
 * 
 * This is a user-client (not a bot), allowing read access to public channels without admin rights.
 * 
 * Environment variables:
 * - AFI_TELEGRAM_MTPROTO_API_ID - Telegram API ID (from my.telegram.org)
 * - AFI_TELEGRAM_MTPROTO_API_HASH - Telegram API hash
 * - AFI_TELEGRAM_MTPROTO_PHONE - Phone number for login (with country code, e.g., +1234567890)
 * - AFI_TELEGRAM_MTPROTO_SESSION_PATH - Path to session file (default: ./.secrets/telegram.session)
 * 
 * @module mtprotoClient
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import * as input from "input";
import * as fs from "fs";
import * as path from "path";

/**
 * MTProto client configuration
 */
export interface MtprotoClientConfig {
  apiId: number;
  apiHash: string;
  phone: string;
  sessionPath: string;
}

/**
 * MTProto client wrapper
 */
export class MtprotoClient {
  private client: TelegramClient | null = null;
  private config: MtprotoClientConfig;
  private sessionString: string = "";

  constructor(config: MtprotoClientConfig) {
    this.config = config;
  }

  /**
   * Connect and authenticate
   */
  async connect(): Promise<void> {
    console.log(`🔌 Connecting to Telegram MTProto...`);

    // Load existing session if available
    this.sessionString = this.loadSession();

    const session = new StringSession(this.sessionString);
    
    this.client = new TelegramClient(
      session,
      this.config.apiId,
      this.config.apiHash,
      {
        connectionRetries: 5,
        useWSS: false, // Use TCP for better reliability
      }
    );

    await this.client.start({
      phoneNumber: async () => this.config.phone,
      password: async () => {
        return await input.text("Please enter your 2FA password (if enabled): ");
      },
      phoneCode: async () => {
        return await input.text("Please enter the code you received: ");
      },
      onError: (err) => {
        console.error(`❌ Authentication error:`, err);
      },
    });

    // Save session after successful login
    this.sessionString = (this.client.session as StringSession).save() as any;
    this.saveSession(this.sessionString);

    console.log(`✅ Connected to Telegram MTProto`);
  }

  /**
   * Disconnect from Telegram
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
      console.log(`🔌 Disconnected from Telegram MTProto`);
    }
  }

  /**
   * Get the underlying TelegramClient
   */
  getClient(): TelegramClient {
    if (!this.client) {
      throw new Error("Client not connected. Call connect() first.");
    }
    return this.client;
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.client !== null && this.client.connected;
  }

  /**
   * Load session from file
   */
  private loadSession(): string {
    try {
      if (fs.existsSync(this.config.sessionPath)) {
        const session = fs.readFileSync(this.config.sessionPath, "utf-8");
        console.log(`📂 Loaded existing session from ${this.config.sessionPath}`);
        return session;
      }
    } catch (error: any) {
      console.warn(`⚠️  Could not load session: ${error.message}`);
    }
    return "";
  }

  /**
   * Save session to file
   */
  private saveSession(sessionString: string): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.config.sessionPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.config.sessionPath, sessionString, "utf-8");
      console.log(`💾 Saved session to ${this.config.sessionPath}`);
    } catch (error: any) {
      console.error(`❌ Could not save session: ${error.message}`);
    }
  }
}

/**
 * Create MTProto client from environment variables
 */
export function createMtprotoClientFromEnv(): MtprotoClient | null {
  const apiId = process.env.AFI_TELEGRAM_MTPROTO_API_ID;
  const apiHash = process.env.AFI_TELEGRAM_MTPROTO_API_HASH;
  const phone = process.env.AFI_TELEGRAM_MTPROTO_PHONE;
  const sessionPath = process.env.AFI_TELEGRAM_MTPROTO_SESSION_PATH || "./.secrets/telegram.session";

  if (!apiId || !apiHash || !phone) {
    console.error(`❌ Missing required MTProto env vars (API_ID, API_HASH, PHONE)`);
    return null;
  }

  return new MtprotoClient({
    apiId: parseInt(apiId, 10),
    apiHash,
    phone,
    sessionPath,
  });
}

