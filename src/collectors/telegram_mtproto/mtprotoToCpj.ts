// @ts-nocheck
/**
 * MTProto Message to CPJ Converter
 * 
 * Converts Telegram message events from gramJS to CPJ v0.1 format.
 * 
 * This module performs minimal parsing - just enough to extract basic signal fields.
 * Complex parsing is left to downstream processors.
 * 
 * @module mtprotoToCpj
 */

import type { Api } from "telegram";
import type { CpjV01Payload } from "../../cpj/cpjValidator.js";

/**
 * Convert result with confidence score
 */
export interface MtprotoCpjResult {
  cpj: CpjV01Payload | null;
  confidence: number;
  reason?: string;
}

/**
 * Convert a Telegram message to CPJ v0.1 format
 * 
 * @param message - Telegram message from gramJS
 * @param channelId - Numeric channel ID
 * @param channelUsername - Channel username (if available)
 * @returns Conversion result with CPJ payload and confidence score
 */
export function convertMessageToCpj(
  message: Api.Message,
  channelId: string,
  channelUsername?: string
): MtprotoCpjResult {
  const text = message.message?.trim();

  if (!text || text.length < 10) {
    return {
      cpj: null,
      confidence: 0,
      reason: "No text or too short",
    };
  }

  // Skip bot commands
  if (text.startsWith("/")) {
    return {
      cpj: null,
      confidence: 0,
      reason: "Bot command",
    };
  }

  // Extract signal fields using simple regex patterns
  const extracted = extractSignalFields(text);

  if (!extracted.symbolRaw || !extracted.side) {
    return {
      cpj: null,
      confidence: 0,
      reason: "Missing required fields (symbol or side)",
    };
  }

  // Calculate confidence
  const confidence = calculateConfidence(extracted);

  // Build CPJ payload
  const cpj: CpjV01Payload = {
    schema: "afi.cpj.v0.1",
    provenance: {
      providerType: "telegram",
      providerId: `telegram-mtproto-${channelId}`,
      messageId: `msg-${message.id}`,
      postedAt: new Date(message.date * 1000).toISOString(),
      rawText: text,
      channelName: channelUsername || `channel-${channelId}`,
    },
    extracted,
    parse: {
      parserId: "telegram-mtproto-raw",
      parserVersion: "1.0.0",
      confidence,
    },
  };

  return { cpj, confidence, reason: "Parsed successfully" };
}

/**
 * Extract signal fields from message text
 * 
 * Uses same patterns as Bot API parser for consistency
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

  // Extract timeframe
  const tfMatch = text.match(/(?:TIMEFRAME|TF)[\s:]+(\d+[mhd])/i);
  if (tfMatch) {
    extracted.timeframeHint = tfMatch[1].toLowerCase();
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
// @ts-nocheck
