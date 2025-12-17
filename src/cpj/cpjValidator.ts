/**
 * CPJ v0.1 Runtime Validator
 *
 * Provides AJV-based validation for Canonical Parsed JSON (CPJ) v0.1 payloads.
 * CPJ is the first normalization stage for third-party signals (Telegram/Discord)
 * before mapping to USS v1.1.
 *
 * Validators are compiled once at module load time for performance.
 *
 * @module cpjValidator
 */

import { Ajv } from "ajv";
import * as ajvFormatsModule from "ajv-formats";
import { readFileSync } from "fs";
import { join } from "path";

import type { ValidateFunction } from "ajv";

// Extract default export from ajv-formats (ESM/CJS compatibility)
const addFormats = (ajvFormatsModule as any).default || ajvFormatsModule;

/**
 * Validation result
 */
export interface ValidationResult {
  ok: boolean;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}

/**
 * CPJ v0.1 canonical payload (minimal runtime shape)
 */
export interface CpjV01Payload {
  schema: "afi.cpj.v0.1";
  provenance: {
    providerType: "telegram" | "discord" | "twitter" | "other";
    providerId: string;
    messageId: string;
    postedAt: string;
    rawText?: string;
    channelName?: string;
    authorId?: string;
    authorName?: string;
    [key: string]: any;
  };
  extracted: {
    symbolRaw: string;
    side: "long" | "short" | "buy" | "sell" | "neutral";
    entry?: number | { min: number; max: number };
    stopLoss?: number;
    takeProfits?: Array<{
      price: number;
      percentage?: number;
    }>;
    leverageHint?: number;
    timeframeHint?: string;
    venueHint?: string;
    marketTypeHint?: "spot" | "perp" | "futures";
    [key: string]: any;
  };
  parse: {
    parserId: string;
    parserVersion: string;
    confidence: number;
    warnings?: string[];
    [key: string]: any;
  };
  [key: string]: any;
}

// Initialize AJV once at module load
const ajv = new Ajv({
  strict: true,
  allErrors: true,
  verbose: false,
});
addFormats(ajv);

// Load schemas from afi-config (assuming it's in node_modules or a sibling directory)
let coreSchema: any;
let indexSchema: any;
let validateCpj: ValidateFunction | null = null;

try {
  // Load from afi-config package
  // Use process.cwd() to get project root (works in both runtime and Jest)
  const projectRoot = process.cwd();
  const configRoot = join(projectRoot, "node_modules/afi-config");

  coreSchema = JSON.parse(
    readFileSync(join(configRoot, "schemas/cpj/v0_1/core.schema.json"), "utf-8")
  );

  indexSchema = JSON.parse(
    readFileSync(join(configRoot, "schemas/cpj/v0_1/index.schema.json"), "utf-8")
  );

  // Register core schema first (for $ref resolution)
  ajv.addSchema(coreSchema);

  // Compile index schema
  validateCpj = ajv.compile(indexSchema);

  console.log("✅ CPJ v0.1 validator initialized successfully");
} catch (error: any) {
  console.error("❌ Failed to initialize CPJ v0.1 validator:", error.message);
  console.error("   Ensure afi-config is installed as a dependency");
  // Don't throw - allow server to start but validation will fail
}

/**
 * Validate a CPJ v0.1 payload
 * 
 * @param payload - The payload to validate
 * @returns Validation result with ok flag and errors if invalid
 */
export function validateCpjV01(payload: any): ValidationResult {
  if (!validateCpj) {
    return {
      ok: false,
      errors: [
        {
          field: "validator",
          message: "CPJ v0.1 validator not initialized - check afi-config dependency",
        },
      ],
    };
  }

  const valid = validateCpj(payload);

  if (valid) {
    return { ok: true };
  }

  // Transform AJV errors into simpler format
  const errors = (validateCpj.errors || []).map((err) => ({
    field: err.instancePath || err.schemaPath || "unknown",
    message: err.message || "validation error",
  }));

  return {
    ok: false,
    errors,
  };
}

/**
 * Type guard to check if payload is a valid CPJ v0.1 payload
 */
export function isValidCpjV01(payload: any): payload is CpjV01Payload {
  const result = validateCpjV01(payload);
  return result.ok;
}

