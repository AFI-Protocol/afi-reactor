/**
 * D2 schema validation adapter — validates generated District 2 artifacts
 * against the MERGED afi-config provenance schemas
 * (`afi-config/schemas/provenance/v1/*.schema.json`, D2 M1).
 *
 * Conventions mirror the canonical USS validator (`src/uss/ussValidator.ts`):
 * schemas are loaded from the installed `afi-config` package (file: link),
 * compiled once at module load on a DEDICATED strict AJV instance, and
 * initialization failures degrade to a structured `{ ok:false }` result —
 * never an uncaught module-load throw. The AJV options + `x-afi*` vocabulary
 * match afi-config's own strict provenance test harness exactly; nothing here
 * loosens AJV strictness globally (the USS validator's instance is untouched)
 * and no schema content is duplicated locally.
 *
 * ESM: relative imports use `.js`.
 */

import AjvImport from "ajv";
import * as ajvFormatsModule from "ajv-formats";
import { readFileSync } from "fs";
import { join } from "path";

import type { ValidateFunction } from "ajv";

/** Minimal structural view of the Ajv v8 surface this adapter uses. */
interface AjvLike {
  addSchema(schema: object): unknown;
  addVocabulary(vocabulary: string[]): unknown;
  compile(schema: object): ValidateFunction;
}

// ESM/CJS interop (mirrors ussValidator): resolve the Ajv class and the
// ajv-formats function regardless of how the CJS packages surface under the
// active module resolution.
type AjvCtor = new (options: Record<string, unknown>) => AjvLike;
const AjvClass = ((AjvImport as unknown as { default?: unknown }).default ??
  AjvImport) as AjvCtor;
const addFormats = ((ajvFormatsModule as { default?: unknown }).default ??
  ajvFormatsModule) as (ajv: AjvLike) => unknown;

/** Structured field-level validation error (same contract as the USS validator). */
export interface D2ValidationError {
  field: string;
  message: string;
}

/** Structured validation result; `errors` is always an array (empty when ok). */
export interface D2ValidationResult {
  ok: boolean;
  errors: D2ValidationError[];
}

/**
 * The eight merged D2 provenance artifact kinds (EV3-GOV D-EV3-8(2): the
 * dormant EnrichmentProvenance draft was subsumed by the provider invocation
 * proof and DELETED — nine kinds became eight; DSC-GOV D-DSC-3(3) superseded
 * prospectively).
 */
export type D2ArtifactKind =
  | "canonical-hash"
  | "evidence-ref"
  | "source-disclosure-profile"
  | "analyst-input-envelope"
  | "scored-signal"
  | "provenance-record"
  | "replay-profile"
  | "trade-plan";

export const D2_ARTIFACT_KINDS: readonly D2ArtifactKind[] = [
  "canonical-hash",
  "evidence-ref",
  "source-disclosure-profile",
  "analyst-input-envelope",
  "scored-signal",
  "provenance-record",
  "replay-profile",
  "trade-plan",
] as const;

const SCHEMA_FILES: Record<D2ArtifactKind, string> = {
  "canonical-hash": "canonical-hash.schema.json",
  "evidence-ref": "evidence-ref.schema.json",
  "source-disclosure-profile": "source-disclosure-profile.schema.json",
  "analyst-input-envelope": "analyst-input-envelope.schema.json",
  "scored-signal": "scored-signal.schema.json",
  "provenance-record": "provenance-record.schema.json",
  "replay-profile": "replay-profile.schema.json",
  "trade-plan": "trade-plan.schema.json",
};

/**
 * afi-config's custom schema annotation vocabulary (same list its own strict
 * provenance harness registers).
 */
const X_AFI_VOCABULARY = [
  "x-afiStatus",
  "x-afiPartOf",
  "x-afiDoctrineRefs",
  "x-afiOpenItems",
  "x-afiProposedNotAccepted",
];

const validators = new Map<D2ArtifactKind, ValidateFunction>();
let initializationError: string | null = null;

try {
  // Load from the installed afi-config package (file:../afi-config link) —
  // same resolution convention as src/uss/ussValidator.ts.
  const schemaRoot = join(
    process.cwd(),
    "node_modules/afi-config/schemas/provenance/v1"
  );

  const ajv = new AjvClass({
    strict: true,
    allowUnionTypes: true,
    strictRequired: false,
    allErrors: true,
    verbose: false,
  });
  addFormats(ajv);
  ajv.addVocabulary(X_AFI_VOCABULARY);

  const loaded = new Map<D2ArtifactKind, Record<string, unknown>>();
  for (const kind of D2_ARTIFACT_KINDS) {
    const raw = readFileSync(join(schemaRoot, SCHEMA_FILES[kind]), "utf-8");
    loaded.set(kind, JSON.parse(raw) as Record<string, unknown>);
  }

  // Register every schema by its $id first so cross-file relative $refs
  // (e.g. "canonical-hash.schema.json") resolve, then compile each.
  for (const schema of loaded.values()) {
    ajv.addSchema(schema);
  }
  for (const [kind, schema] of loaded.entries()) {
    validators.set(kind, ajv.compile({ $ref: schema.$id as string }));
  }

  console.log("✅ D2 provenance schema validators initialized successfully");
} catch (error) {
  initializationError = error instanceof Error ? error.message : String(error);
  console.error(
    "❌ Failed to initialize D2 provenance schema validators:",
    initializationError
  );
  console.error("   Ensure afi-config (with schemas/provenance/v1) is installed");
  // Don't throw — validation degrades to a structured failure result.
}

/** `/provenance/signalId` -> `provenance.signalId`; empty -> parent handling. */
function dottedPath(instancePath: string): string {
  return instancePath.split("/").filter(Boolean).join(".");
}

/** Matches ajv's required-keyword message, capturing the missing property key. */
const REQUIRED_PROPERTY_RE = /must have required property '([^']+)'/;

function normalizeAjvError(error: {
  instancePath?: string;
  schemaPath?: string;
  message?: string;
}): D2ValidationError {
  const message = error.message ?? "validation error";
  const instancePath = error.instancePath ?? "";
  const required = REQUIRED_PROPERTY_RE.exec(message);
  if (required) {
    const parent = dottedPath(instancePath);
    return { field: parent ? `${parent}.${required[1]}` : required[1], message };
  }
  const dotted = dottedPath(instancePath);
  if (dotted !== "") {
    return { field: dotted, message };
  }
  return { field: "(root)", message };
}

/**
 * Validate a generated D2 artifact against its merged afi-config schema.
 * Structured result, never a throw; `errors` is always an array.
 */
export function validateD2Artifact(
  kind: D2ArtifactKind,
  value: unknown
): D2ValidationResult {
  const validator = validators.get(kind);
  if (!validator) {
    return {
      ok: false,
      errors: [
        {
          field: "validator",
          message:
            `D2 schema validator for "${kind}" not initialized` +
            (initializationError ? ` (${initializationError})` : "") +
            " - check the afi-config dependency",
        },
      ],
    };
  }
  const valid = validator(value);
  if (valid) {
    return { ok: true, errors: [] };
  }
  const errors = (validator.errors ?? []).map(normalizeAjvError);
  return {
    ok: false,
    errors:
      errors.length > 0
        ? errors
        : [{ field: "(root)", message: `payload failed ${kind} v1 validation` }],
  };
}

export const validateCanonicalHashV1 = (value: unknown): D2ValidationResult =>
  validateD2Artifact("canonical-hash", value);
export const validateEvidenceRefV1 = (value: unknown): D2ValidationResult =>
  validateD2Artifact("evidence-ref", value);
export const validateSourceDisclosureProfileV1 = (
  value: unknown
): D2ValidationResult => validateD2Artifact("source-disclosure-profile", value);
export const validateAnalystInputEnvelopeV1 = (value: unknown): D2ValidationResult =>
  validateD2Artifact("analyst-input-envelope", value);
export const validateScoredSignalV1 = (value: unknown): D2ValidationResult =>
  validateD2Artifact("scored-signal", value);
export const validateProvenanceRecordV1 = (value: unknown): D2ValidationResult =>
  validateD2Artifact("provenance-record", value);
export const validateReplayProfileV1 = (value: unknown): D2ValidationResult =>
  validateD2Artifact("replay-profile", value);
/**
 * TradePlan v1 validation helper only — the Reactor does NOT generate
 * TradePlan objects (no live surface carries trade levels and CPJ mapping is
 * frozen).
 */
export const validateTradePlanV1 = (value: unknown): D2ValidationResult =>
  validateD2Artifact("trade-plan", value);
