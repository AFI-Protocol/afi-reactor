/**
 * Governed afi.scored-signal-evidence.v3 validation (EV3-GOV D-EV3-1) — the
 * Reactor's OWN proof that a record is v3-valid BEFORE it is submitted
 * through the afi-infra store (which re-validates authoritatively).
 *
 * The v3 record schema and its proof/composition dependencies are compiled
 * from the VENDORED byte-pinned closure (src/pipeline/governed-schema/ —
 * drift-guarded by test/pipeline/vendoredSchemaProvenance.test.ts):
 * scored-signal-evidence.v3 + provider-invocation-proof.v1 +
 * aiml-invocation-proof.v1 + composition-ref + canonical-hash. Their $refs
 * into the D2 provenance family (scored-signal / provenance-record, …)
 * resolve against the merged afi-config provenance schemas loaded exactly
 * like src/evidence/provenance/schemaValidation.ts loads them
 * (node_modules/afi-config, the ussValidator convention).
 *
 * v3 is the SOLE current evidence contract: there is no v2 validator, no
 * dual mode, and no fallback alias (D-EV3-1/D-EV3-8).
 *
 * Initialization failures degrade to a structured { ok:false } result (the
 * submit path then refuses to persist) — never an uncaught module-load throw.
 */
import AjvImport from "ajv";
import * as ajvFormatsModule from "ajv-formats";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ValidateFunction } from "ajv";

interface AjvLike {
  addSchema(schema: object): unknown;
  addVocabulary(vocabulary: string[]): unknown;
  compile(schema: object): ValidateFunction;
}
type AjvCtor = new (options: Record<string, unknown>) => AjvLike;
const AjvClass = ((AjvImport as unknown as { default?: unknown }).default ??
  AjvImport) as AjvCtor;
const addFormats = ((ajvFormatsModule as { default?: unknown }).default ??
  ajvFormatsModule) as (ajv: AjvLike) => unknown;

export interface EvidenceV3ValidationResult {
  ok: boolean;
  errors: Array<{ field: string; message: string }>;
}

export const EVIDENCE_V3_SCHEMA_ID =
  "https://afi-protocol.org/schemas/scored-signal-evidence/v3/scored-signal-evidence.schema.json";

const X_AFI_VOCABULARY = [
  "x-afiStatus",
  "x-afiPartOf",
  "x-afiDoctrineRefs",
  "x-afiOpenItems",
  "x-afiProposedNotAccepted",
  "x-afiConstraints",
];

/** The eight merged D2 provenance schema files (ref-resolution closure;
 *  EV3-GOV D-EV3-8(2): the enrichment provenance draft is deleted). */
const PROVENANCE_SCHEMA_FILES = [
  "canonical-hash.schema.json",
  "evidence-ref.schema.json",
  "source-disclosure-profile.schema.json",
  "analyst-input-envelope.schema.json",
  "scored-signal.schema.json",
  "provenance-record.schema.json",
  "replay-profile.schema.json",
  "trade-plan.schema.json",
];

/** Vendored FACTORY/EV3-CONTRACT members of the v3 closure (byte-pinned copies). */
const VENDORED_SCHEMA_FILES = [
  "composition-ref.schema.json",
  "aiml-invocation-proof.schema.json",
  "provider-invocation-proof.schema.json",
  "scored-signal-evidence.v3.schema.json",
];

let validator: ValidateFunction | undefined;
let initializationError: string | null = null;

try {
  const provenanceRoot = join(
    process.cwd(),
    "node_modules/afi-config/schemas/provenance/v1"
  );
  const vendoredRoot = join(process.cwd(), "src/pipeline/governed-schema");

  const ajv = new AjvClass({
    strict: true,
    allowUnionTypes: true,
    strictRequired: false,
    allErrors: true,
  });
  addFormats(ajv);
  ajv.addVocabulary(X_AFI_VOCABULARY);

  for (const file of PROVENANCE_SCHEMA_FILES) {
    ajv.addSchema(JSON.parse(readFileSync(join(provenanceRoot, file), "utf-8")));
  }
  for (const file of VENDORED_SCHEMA_FILES) {
    ajv.addSchema(JSON.parse(readFileSync(join(vendoredRoot, file), "utf-8")));
  }

  validator = ajv.compile({ $ref: EVIDENCE_V3_SCHEMA_ID });
} catch (error) {
  initializationError = error instanceof Error ? error.message : String(error);
  console.error(
    "❌ Failed to initialize the afi.scored-signal-evidence.v3 validator:",
    initializationError
  );
}

/** Validate a candidate evidence record against the vendored v3 closure. */
export function validateEvidenceRecordV3(value: unknown): EvidenceV3ValidationResult {
  if (!validator) {
    return {
      ok: false,
      errors: [
        {
          field: "validator",
          message:
            "afi.scored-signal-evidence.v3 validator not initialized" +
            (initializationError ? ` (${initializationError})` : "") +
            " — check the afi-config dependency and the vendored schema closure",
        },
      ],
    };
  }
  const valid = validator(value);
  if (valid) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: (validator.errors ?? []).map((e) => ({
      field: e.instancePath?.split("/").filter(Boolean).join(".") || "(root)",
      message: e.message ?? "validation error",
    })),
  };
}
