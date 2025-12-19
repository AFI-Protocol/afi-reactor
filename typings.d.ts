// Legacy ambient typings shim for older tests/missing module declarations.
// Prefer real @types packages; this is a fallback only.

// Optional: global placeholders for test frameworks
declare var describe: any;
declare var it: any;
declare var test: any;

// Minimal ambient modules for build-time compatibility (scored-only public surface)
declare module "afi-core/analyst" {
  export type AnalystScoreTemplate = any;
}
declare module "afi-core/analysts/froggy.enrichment_adapter.js" {
  export type EnrichmentProfile = any;
  export type FroggyEnrichedView = any;
}
declare module "afi-core/analysts/froggy.trend_pullback_v1.js" {
  export type FroggyTrendPullbackScore = any;
}
declare module "afi-core/validators/ValidatorDecision.js" {
  export type ValidatorDecisionBase = any;
}
declare module "afi-core/validators/NoveltyScorer.js" {
  export type NoveltySignalInput = any;
}
declare module "afi-core/validators/NoveltyTypes.js" {
  export type NoveltyResult = any;
  export type NoveltyClass = any;
}
declare module "afi-core/decay" {
  export type DecayParams = any;
}
declare module "ccxt" {
  const ccxt: any;
  export = ccxt;
}
declare module "node-telegram-bot-api" {
  export default class TelegramBot {
    constructor(token: string, options?: any);
    on(event: string, callback: (...args: any[]) => void): void;
    sendMessage(chatId: any, text: string, opts?: any): void;
  }
}
declare module "telegram" {
  export class TelegramClient {
    constructor(session: any, apiId: any, apiHash: any, options?: any);
    connect(): Promise<void>;
    start(options: any): Promise<void>;
  }
  export class StringSession {
    constructor(session?: string);
    save(): string;
  }
  export type Message = any;
}
declare module "telegram/events/index.js" {
  export class NewMessage {
    constructor(options?: any);
  }
  export type NewMessageEvent = any;
}
declare module "telegram/sessions/index.js" {
  export const StringSession: any;
}
declare module "input" {
  const input: any;
  export = input;
}
declare module "ajv" {
  export type ValidateFunction = any;
  export default class Ajv {
    constructor(options?: any);
    addSchema(schema: any, key?: string): void;
    getSchema(key: string): ValidateFunction | undefined;
    compile(schema: any): ValidateFunction;
  }
}
declare module "ajv-formats" {
  export default function addFormats(ajv: any): void;
}
declare module "trading-signals" {
  export const StochasticRSI: any;
}
