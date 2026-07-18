/**
 * Governed afi.scored-signal-evidence.v2 validation (W3 spec section 7) —
 * the Reactor's OWN proof that a record is v2-valid BEFORE it is submitted
 * through the afi-infra store (which re-validates authoritatively).
 *
 * The v2 record schema and its composition-ref dependency are compiled from
 * the VENDORED byte-pinned closure (src/pipeline/governed-schema/ — drift-
 * guarded by test/pipeline/vendoredSchemaProvenance.test.ts). Their $refs
 * into the D2 provenance family (scored-signal / provenance-record /
 * canonical-hash, …) resolve against the merged afi-config provenance
 * schemas loaded exactly like src/evidence/provenance/schemaValidation.ts
 * loads them (node_modules/afi-config, the ussValidator convention) — the
 * vendored canonical-hash.schema.json is the byte-pinned copy of the same
 * governed document, so both sources describe identical bytes.
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

export interface EvidenceV2ValidationResult {
  ok: boolean;
  errors: Array<{ field: string; message: string }>;
}

export const EVIDENCE_V2_SCHEMA_ID =
  "https://afi-protocol.org/schemas/scored-signal-evidence/v2/scored-signal-evidence.schema.json";

const X_AFI_VOCABULARY = [
  "x-afiStatus",
  "x-afiPartOf",
  "x-afiDoctrineRefs",
  "x-afiOpenItems",
  "x-afiProposedNotAccepted",
  "x-afiConstraints",
];

/** The nine merged D2 provenance schema files (ref-resolution closure). */
const PROVENANCE_SCHEMA_FILES = [
  "canonical-hash.schema.json",
  "evidence-ref.schema.json",
  "source-disclosure-profile.schema.json",
  "enrichment-provenance.schema.json",
  "analyst-input-envelope.schema.json",
  "scored-signal.schema.json",
  "provenance-record.schema.json",
  "replay-profile.schema.json",
  "trade-plan.schema.json",
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
  // Vendored FACTORY-CONTRACT members of the v2 closure (byte-pinned copies).
  ajv.addSchema(
    JSON.parse(readFileSync(join(vendoredRoot, "composition-ref.schema.json"), "utf-8"))
  );
  ajv.addSchema(
    JSON.parse(
      readFileSync(join(vendoredRoot, "scored-signal-evidence.v2.schema.json"), "utf-8")
    )
  );

  validator = ajv.compile({ $ref: EVIDENCE_V2_SCHEMA_ID });
} catch (error) {
  initializationError = error instanceof Error ? error.message : String(error);
  console.error(
    "❌ Failed to initialize the afi.scored-signal-evidence.v2 validator:",
    initializationError
  );
}

/** Validate a candidate evidence record against the vendored v2 schema. */
export function validateEvidenceRecordV2(value: unknown): EvidenceV2ValidationResult {
  if (!validator) {
    return {
      ok: false,
      errors: [
        {
          field: "validator",
          message:
            "afi.scored-signal-evidence.v2 validator not initialized" +
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
