/**
 * USS v1.1 Runtime Validator
 *
 * Provides AJV-based validation for canonical USS v1.1 payloads.
 * Validators are compiled once at module load time for performance.
 *
 * @module ussValidator
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
 * USS v1.1 canonical payload (minimal runtime shape)
 */
export interface UssV11Payload {
  schema: "afi.usignal.v1.1";
  provenance: {
    source: string;
    providerId: string;
    signalId: string;
    ingestedAt?: string;
    ingestHash?: string;
    providerType?: string;
    providerRef?: string;
    [key: string]: any;
  };
  core?: any;
  lens?: string;
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
let validateUsignal: ValidateFunction | null = null;

try {
  // Load from afi-config package
  // Use process.cwd() to get project root (works in both runtime and Jest)
  const projectRoot = process.cwd();
  const configRoot = join(projectRoot, "node_modules/afi-config");

  coreSchema = JSON.parse(
    readFileSync(join(configRoot, "schemas/usignal/v1_1/core.schema.json"), "utf-8")
  );

  indexSchema = JSON.parse(
    readFileSync(join(configRoot, "schemas/usignal/v1_1/index.schema.json"), "utf-8")
  );

  // Register core schema first (for $ref resolution)
  ajv.addSchema(coreSchema);

  // Compile index schema
  validateUsignal = ajv.compile(indexSchema);

  console.log("✅ USS v1.1 validator initialized successfully");
} catch (error: any) {
  console.error("❌ Failed to initialize USS v1.1 validator:", error.message);
  console.error("   Ensure afi-config is installed as a dependency");
  // Don't throw - allow server to start but validation will fail
}

/**
 * Validate a USS v1.1 payload
 * 
 * @param payload - The payload to validate
 * @returns Validation result with ok flag and errors if invalid
 */
export function validateUsignalV11(payload: any): ValidationResult {
  if (!validateUsignal) {
    return {
      ok: false,
      errors: [
        {
          field: "validator",
          message: "USS v1.1 validator not initialized - check afi-config dependency",
        },
      ],
    };
  }

  const valid = validateUsignal(payload);

  if (valid) {
    return { ok: true };
  }

  // Transform AJV errors into simpler format
  const errors = (validateUsignal.errors || []).map((err) => ({
    field: err.instancePath || err.schemaPath || "unknown",
    message: err.message || "validation error",
  }));

  return {
    ok: false,
    errors,
  };
}

/**
 * Type guard to check if payload is a valid USS v1.1 payload
 */
export function isValidUssV11(payload: any): payload is UssV11Payload {
  const result = validateUsignalV11(payload);
  return result.ok;
}

