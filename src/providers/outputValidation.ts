/**
 * Canonical category-output validation (PBF-GOV D-PBF-8 / §7.1, §13.3).
 *
 * A provider-produced category result MUST pass validation against its
 * canonical category-result contract (afi.enrichment.<category>.v1) BEFORE it
 * reaches the scorer-facing path. A malformed result throws
 * ProviderOutputInvalidError and never reaches scoring (fail closed). Only lanes
 * with a live adapter ship a validator (technical + news from PBF-GOV v0.1,
 * pattern from Mission 4); an unmapped category (sentiment, aiMl — contract-only)
 * fails closed rather than silently passing.
 */
import type { ValidateFunction } from "ajv";
import type { AnalysisCategory, CategoryResult } from "./types.js";
import { compileGovernedValidator } from "./schemaSupport.js";
import { ProviderOutputInvalidError } from "./errors.js";

export interface CategoryOutputValidator {
  validate(category: AnalysisCategory, result: unknown): CategoryResult;
  has(category: AnalysisCategory): boolean;
}

const SCHEMA_BY_CATEGORY: Partial<Record<AnalysisCategory, string>> = {
  technical: "enrichment-technical.schema.json",
  news: "enrichment-news.schema.json",
  // Mission 4: the 'pattern' lane now ships a live keyless local adapter
  // (afi-adapter-pattern-local) whose output is validated at the edge against
  // the vendored afi.enrichment.pattern.v1 contract. sentiment/aiMl remain
  // contract-only (no runtime adapter yet) and stay unmapped → fail closed.
  pattern: "enrichment-pattern.schema.json",
};

export function createCategoryOutputValidator(schemaDirOverride?: string): CategoryOutputValidator {
  const validators = new Map<AnalysisCategory, ValidateFunction>();
  for (const [category, basename] of Object.entries(SCHEMA_BY_CATEGORY)) {
    validators.set(category as AnalysisCategory, compileGovernedValidator(basename!, schemaDirOverride));
  }
  return {
    has: (category) => validators.has(category),
    validate(category, result) {
      const v = validators.get(category);
      if (!v) {
        // Fail closed: no canonical contract for this category in v0.1.
        throw new ProviderOutputInvalidError(
          `no canonical category-result contract registered for category '${category}'`
        );
      }
      if (!v(result)) {
        throw new ProviderOutputInvalidError(
          `provider output failed canonical '${category}' validation: ${JSON.stringify(v.errors)}`
        );
      }
      return result as CategoryResult;
    },
  };
}
