/**
 * Telegram Signal Parser
 * 
 * Extracts trading signal fields from Telegram messages and produces CPJ v0.1 payloads.
 * 
 * Supports common signal formats:
 * - Cornix-style signals
 * - Simple "BTC LONG @ 42000" format
 * - Structured signals with entry/TP/SL
 * 
 * @module telegramParser
 */

import type { CpjV01Payload } from "../../cpj/cpjValidator.js";

/**
 * Telegram message interface (simplified)
 */
export interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  chat: {
    id: number;
    title?: string;
    username?: string;
  };
}

/**
 * Parse result with confidence score
 */
export interface ParseResult {
  cpj: CpjV01Payload | null;
  confidence: number;
  reason?: string;
}

/**
 * Parse a Telegram message into CPJ v0.1 format
 * 
 * @param message - Telegram message object
 * @returns Parse result with CPJ payload and confidence score
 */
export function parseTelegramMessage(message: TelegramMessage): ParseResult {
  const text = message.text?.trim();
  
  if (!text) {
    return {
      cpj: null,
      confidence: 0,
      reason: "No text content",
    };
  }

  // Skip bot commands and non-signal messages
  if (text.startsWith("/") || text.length < 10) {
    return {
      cpj: null,
      confidence: 0,
      reason: "Bot command or too short",
    };
  }

  // Extract signal fields using regex patterns
  const extracted = extractSignalFields(text);
  
  if (!extracted.symbolRaw || !extracted.side) {
    return {
      cpj: null,
      confidence: 0,
      reason: "Missing required fields (symbol or side)",
    };
  }

  // Calculate confidence based on how many fields we extracted
  const confidence = calculateConfidence(extracted);

  // Build CPJ payload
  const cpj: CpjV01Payload = {
    schema: "afi.cpj.v0.1",
    provenance: {
      providerType: "telegram",
      providerId: `telegram-${message.chat.id}`,
      messageId: `msg-${message.message_id}`,
      postedAt: new Date(message.date * 1000).toISOString(),
      rawText: text,
      channelName: message.chat.title || message.chat.username,
    },
    extracted,
    parse: {
      parserId: "telegram-signal-parser",
      parserVersion: "1.0.0",
      confidence,
    },
  };

  return { cpj, confidence, reason: "Parsed successfully" };
}

/**
 * Extract signal fields from message text
 */
function extractSignalFields(text: string): any {
  const upper = text.toUpperCase();
  const extracted: any = {};

  // Extract symbol (common patterns)
  const symbolPatterns = [
    /(?:SYMBOL|PAIR|COIN)[\s:]+([A-Z0-9]+(?:\/|-)? [A-Z]+)/i,
    /\b([A-Z]{2,10}(?:USDT|USD|USDC|BTC|ETH))\b/,
    /\b([A-Z]{2,10}[\/\-][A-Z]{2,10})\b/,
  ];

  for (const pattern of symbolPatterns) {
    const match = text.match(pattern);
    if (match) {
      extracted.symbolRaw = match[1].trim();
      break;
    }
  }

  // Extract side/direction
  if (/\b(LONG|BUY)\b/i.test(text)) {
    extracted.side = "long";
  } else if (/\b(SHORT|SELL)\b/i.test(text)) {
    extracted.side = "short";
  }

  // Extract entry price
  const entryMatch = text.match(/(?:ENTRY|BUY|SELL)[\s:@]+(\d+(?:\.\d+)?)/i);
  if (entryMatch) {
    extracted.entry = parseFloat(entryMatch[1]);
  }

  // Extract stop loss
  const slMatch = text.match(/(?:STOP[\s-]?LOSS|SL)[\s:]+(\d+(?:\.\d+)?)/i);
  if (slMatch) {
    extracted.stopLoss = parseFloat(slMatch[1]);
  }

  // Extract take profits (multiple)
  const tpMatches = text.matchAll(/(?:TAKE[\s-]?PROFIT|TP)[\s:]?(\d+)?[\s:]+(\d+(?:\.\d+)?)/gi);
  const takeProfits: any[] = [];
  for (const match of tpMatches) {
    takeProfits.push({ price: parseFloat(match[2]) });
  }
  if (takeProfits.length > 0) {
    extracted.takeProfits = takeProfits;
  }

  // Extract leverage
  const levMatch = text.match(/(?:LEVERAGE|LEV)[\s:]+(\d+)x?/i);
  if (levMatch) {
    extracted.leverageHint = parseInt(levMatch[1], 10);
  }

  return extracted;
}

/**
 * Calculate confidence score based on extracted fields
 */
function calculateConfidence(extracted: any): number {
  let score = 0.5; // Base score for having symbol + side

  if (extracted.entry) score += 0.15;
  if (extracted.stopLoss) score += 0.15;
  if (extracted.takeProfits?.length > 0) score += 0.1;
  if (extracted.leverageHint) score += 0.05;
  if (extracted.timeframeHint) score += 0.05;

  return Math.min(score, 1.0);
}

