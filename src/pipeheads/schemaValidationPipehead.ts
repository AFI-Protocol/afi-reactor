/**
 * Schema-validation pipehead — CANONICAL USS v1.1 validation (Decision Record
 * DR-001 RESOLVED).
 *
 * This pipehead now delegates to the canonical `validateUsignalV11`
 * (`src/uss/ussValidator.ts`): ajv (v8) + ajv-formats compiled over the
 * canonical afi-config schemas (`schemas/usignal/v1_1/{core,index}.schema.json`,
 * afi-config is installed as `file:../afi-config`). The former self-contained
 * STRUCTURAL validator this module used to carry has been replaced at the
 * clean seam that DR-001 reserved for exactly this swap — no caller changed.
 *
 * Public result contract (unchanged): `{ ok, errors: [{ field, message }] }`
 * with `errors` ALWAYS present as an array (empty when `ok`) so callers never
 * branch on `undefined`. Canonical ajv errors are normalized:
 *   - required-property errors map `field` to the MISSING KEY's dotted path
 *     (e.g. `provenance.signalId`), never just the parent object;
 *   - other instance-path errors become dotted paths (`/facts/direction` ->
 *     `facts.direction`);
 *   - document-root errors (empty instancePath) map to `(root)`.
 *
 * Output is purely a function of the input (deterministic); timestamps come
 * from `ctx.clock()` and never affect the result. Malformed input yields a
 * structured `status: 'failed'` result — never an uncaught throw.
 *
 * ESM: relative imports use `.js`.
 */

import { validateUsignalV11 } from "../uss/ussValidator.js";
import type { Pipehead, PipeheadContext, PipeheadExecutionResult } from "./types.js";

export interface UssValidationError {
  field: string;
  message: string;
}

/**
 * Same result contract the structural validator honored, now produced by the
 * canonical validator: `errors` is always present as an array (empty when
 * `ok`) so callers never branch on `undefined`.
 */
export interface UssValidationResult {
  ok: boolean;
  errors: UssValidationError[];
}

export const USS_V11_SCHEMA_CONST = "afi.usignal.v1.1";

export const SCHEMA_VALIDATION_PIPEHEAD_ID = "schema-validation";

/**
 * Human-readable self-label attached to every validation result. DR-001 is
 * resolved: this is the canonical ajv-based USS v1.1 validation, no longer the
 * structural stand-in.
 */
export const CANONICAL_VALIDATOR_NOTE =
  "Canonical USS v1.1 validation (DR-001 resolved): ajv-based validateUsignalV11 " +
  "compiled over the canonical afi-config schemas (usignal/v1_1 core+index) with " +
  "ajv-formats. Errors are normalized to { field, message } with required-property " +
  "errors mapped to the missing key; `errors` is always an array.";

/** Matches ajv's required-keyword message, capturing the missing property key. */
const REQUIRED_PROPERTY_RE = /must have required property '([^']+)'/;

/** `/provenance/signalId` -> `provenance.signalId`; `/` or `` -> ``. */
function dottedPath(instancePath: string): string {
  return instancePath.split("/").filter(Boolean).join(".");
}

/**
 * Normalize one canonical-validator error into the pipehead contract.
 *
 * `validateUsignalV11` maps each ajv error to
 * `{ field: instancePath || schemaPath || "unknown", message }`. An empty
 * instancePath therefore surfaces as a schemaPath (starts with `#`) or
 * `"unknown"` — both meaning the error is about the document root.
 */
function normalizeCanonicalError(error: { field: string; message: string }): UssValidationError {
  const { field, message } = error;
  const hasInstancePath = field.startsWith("/");

  const required = REQUIRED_PROPERTY_RE.exec(message);
  if (required) {
    const parent = hasInstancePath ? dottedPath(field) : "";
    return { field: parent ? `${parent}.${required[1]}` : required[1], message };
  }

  if (hasInstancePath) {
    const dotted = dottedPath(field);
    return { field: dotted === "" ? "(root)" : dotted, message };
  }

  // Initialization sentinel from ussValidator (afi-config/ajv unavailable).
  if (field === "validator") {
    return { field, message };
  }

  return { field: "(root)", message };
}

/**
 * Canonical USS v1.1 validation behind the DR-001 seam. Calls
 * `validateUsignalV11` and normalizes its result into the stable
 * `{ ok, errors: UssValidationError[] }` contract (errors always an array,
 * non-empty whenever `ok === false`).
 *
 * Pure & deterministic: identical input always yields a deeply-equal result.
 */
export function validateUssV11Canonical(payload: unknown): UssValidationResult {
  const result = validateUsignalV11(payload);
  if (result.ok) {
    return { ok: true, errors: [] };
  }
  const errors = (result.errors ?? []).map(normalizeCanonicalError);
  return {
    ok: false,
    errors:
      errors.length > 0
        ? errors
        : [{ field: "(root)", message: "USS v1.1 payload failed canonical validation" }],
  };
}

/**
 * The validation pipehead. `provisional: false` — validation is canonical now
 * (DR-001 resolved); the note carries the canonical self-label. Returns
 * `status: 'ok'` for a well-formed signal and `status: 'failed'` carrying the
 * structured errors for malformed input — never an uncaught throw.
 */
export const schemaValidationPipehead: Pipehead<unknown, UssValidationResult> = {
  id: SCHEMA_VALIDATION_PIPEHEAD_ID,
  kind: "validation",
  async execute(
    input: unknown,
    ctx: PipeheadContext
  ): Promise<PipeheadExecutionResult<UssValidationResult>> {
    const startedAt = ctx.clock();
    let result: UssValidationResult;
    try {
      result = validateUssV11Canonical(input);
    } catch (err: unknown) {
      // Defensive: canonical validation should never throw; keep the
      // structured-failure contract regardless.
      result = {
        ok: false,
        errors: [
          {
            field: "(root)",
            message: `canonical validation threw unexpectedly: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      };
    }
    const finishedAt = ctx.clock();
    return {
      pipeheadId: this.id,
      kind: this.kind,
      status: result.ok ? "ok" : "failed",
      provisional: false,
      output: result,
      notes: [CANONICAL_VALIDATOR_NOTE],
      startedAt,
      finishedAt,
    };
  },
};
