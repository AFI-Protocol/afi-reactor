/**
 * Schema-validation pipehead — self-contained OFFLINE structural USS v1.1
 * validator (Decision Record DR-001).
 *
 * This is NOT the canonical validator. The canonical `validateUsignalV11`
 * (`src/uss/ussValidator.ts`) is unusable in this offline mission: its
 * module-level `import { Ajv } from "ajv"` throws because `ajv`/`ajv-formats`
 * are not installed/resolvable and the afi-config schemas are absent. So this
 * module implements a minimal STRUCTURAL validator that enforces the same
 * minimum USS v1.1 rules and returns the same `{ ok, errors:[{field,message}] }`
 * contract behind a CLEAN SEAM: a future mission can swap `validateUssV11Structural`
 * for canonical `validateUsignalV11` without changing any caller.
 *
 * The result self-labels as structural / POC / demo-only / non-canonical and is
 * explicitly NOT a replacement for canonical USS validation. Output is purely a
 * function of the input (deterministic); timestamps come from `ctx.clock()` and
 * never affect the result.
 *
 * ESM: relative imports use `.js`.
 */

import type { Pipehead, PipeheadContext, PipeheadExecutionResult } from "./types.js";

export interface StructuralValidationError {
  field: string;
  message: string;
}

/**
 * Same result contract as the canonical `validateUsignalV11` (ussValidator.ts),
 * with `errors` always present as an array (empty when `ok`) so callers never
 * branch on `undefined`. This is the clean seam for a future canonical swap.
 */
export interface StructuralUssValidationResult {
  ok: boolean;
  errors: StructuralValidationError[];
}

export const USS_V11_SCHEMA_CONST = "afi.usignal.v1.1";

/** Required provenance fields, each of which must be present AND a string. */
const REQUIRED_PROVENANCE_STRING_FIELDS = ["source", "providerId", "signalId"] as const;

export const SCHEMA_VALIDATION_PIPEHEAD_ID = "schema-validation";

/**
 * Human-readable self-label attached to every validation result. Makes the
 * structural / demo-only / non-canonical nature explicit and points at the
 * deferred canonical-validation work (DR-001).
 */
export const STRUCTURAL_VALIDATOR_NOTE =
  "Structural USS v1.1 validator (POC / demo-only / non-canonical). " +
  "It is NOT a replacement for canonical USS validation (validateUsignalV11); " +
  "canonical ajv-based USS validation is deferred to future work (DR-001).";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Structural USS v1.1 validation enforcing the minimum canonical rules:
 *  - top-level is an object with required keys `schema` and `provenance`
 *  - `schema` const === "afi.usignal.v1.1"
 *  - `provenance` is an object with required `source`, `providerId`, `signalId`,
 *    each present AND of type string
 *
 * Pure: identical input always yields a deeply-equal result.
 */
export function validateUssV11Structural(payload: unknown): StructuralUssValidationResult {
  const errors: StructuralValidationError[] = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: [
        {
          field: "(root)",
          message: "USS payload must be a JSON object",
        },
      ],
    };
  }

  if (!("schema" in payload)) {
    errors.push({
      field: "schema",
      message: 'missing required top-level property "schema"',
    });
  } else if (typeof payload.schema !== "string") {
    errors.push({
      field: "schema",
      message: `"schema" must be a string equal to "${USS_V11_SCHEMA_CONST}"`,
    });
  } else if (payload.schema !== USS_V11_SCHEMA_CONST) {
    errors.push({
      field: "schema",
      message: `"schema" must equal the const "${USS_V11_SCHEMA_CONST}" (received "${payload.schema}")`,
    });
  }

  if (!("provenance" in payload)) {
    errors.push({
      field: "provenance",
      message: 'missing required top-level property "provenance"',
    });
  } else if (!isPlainObject(payload.provenance)) {
    errors.push({
      field: "provenance",
      message: '"provenance" must be a JSON object',
    });
  } else {
    const provenance = payload.provenance;
    for (const field of REQUIRED_PROVENANCE_STRING_FIELDS) {
      const path = `provenance.${field}`;
      if (!(field in provenance)) {
        errors.push({
          field: path,
          message: `missing required property "${path}"`,
        });
      } else if (typeof provenance[field] !== "string") {
        errors.push({
          field: path,
          message: `"${path}" must be a string (received ${typeof provenance[field]})`,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * The validation pipehead. `provisional: true` + `notes` carry the structural /
 * demo-only / non-canonical self-label independently of any downstream artifact.
 * Returns `status: 'ok'` for a well-formed signal and `status: 'failed'`
 * carrying the structured errors for malformed input — never an uncaught throw.
 */
export const schemaValidationPipehead: Pipehead<unknown, StructuralUssValidationResult> = {
  id: SCHEMA_VALIDATION_PIPEHEAD_ID,
  kind: "validation",
  async execute(
    input: unknown,
    ctx: PipeheadContext
  ): Promise<PipeheadExecutionResult<StructuralUssValidationResult>> {
    const startedAt = ctx.clock();
    const result = validateUssV11Structural(input);
    const finishedAt = ctx.clock();
    return {
      pipeheadId: this.id,
      kind: this.kind,
      status: result.ok ? "ok" : "failed",
      provisional: true,
      output: result,
      notes: [STRUCTURAL_VALIDATOR_NOTE],
      startedAt,
      finishedAt,
    };
  },
};
