/**
 * Shared AJV + vendored-schema support for the provider-adapter layer.
 *
 * Mirrors the registryLoader house setup exactly (strict draft-07 + x-afi
 * vocabulary + ajv-formats) and reads the byte-pinned vendored governed schemas
 * from src/pipeline/governed-schema/ (the same anchor registryLoader uses).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";
import * as ajvFormatsModule from "ajv-formats";

const addFormats = (ajvFormatsModule as { default?: unknown }).default ?? ajvFormatsModule;

/** The vendored governed-schema directory (overridable for tests). */
export function governedSchemaDir(override?: string): string {
  return override ?? join(process.cwd(), "src/pipeline/governed-schema");
}

export function createProviderAjv(): Ajv {
  const ajv = new Ajv({ strict: true, allowUnionTypes: true, strictRequired: false, allErrors: true });
  (addFormats as (a: Ajv) => void)(ajv);
  ajv.addVocabulary([
    "x-afiStatus",
    "x-afiPartOf",
    "x-afiDoctrineRefs",
    "x-afiOpenItems",
    "x-afiProposedNotAccepted",
    "x-afiConstraints",
  ]);
  return ajv;
}

export function loadGovernedSchema(basename: string, dirOverride?: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(governedSchemaDir(dirOverride), basename), "utf-8")) as Record<
    string,
    unknown
  >;
}

export function compileGovernedValidator(basename: string, dirOverride?: string): ValidateFunction {
  return createProviderAjv().compile(loadGovernedSchema(basename, dirOverride));
}
