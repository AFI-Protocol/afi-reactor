/**
 * Canonical JSON hashing — the afi-reactor VERIFICATION-side implementation of
 * canonical-json-hashing.v1, byte-exact against the vendored governed spec
 * (src/pipeline/governed-schema/canonical-json-hashing.v1.md, pinned from
 * afi-config@e462c4e8) and proven against every vendored KAT vector
 * (src/pipeline/governed-schema/canonical-json-hashing.kat.json) by
 * test/pipeline/hashingKat.test.ts.
 *
 *   hash = SHA-256 over the UTF-8 bytes of the canonically serialized JSON
 *   value, after removing the artifact type's excluded TOP-LEVEL fields.
 *
 * Serialization (RFC 8785-aligned for the JSON subset these artifacts use):
 * object keys sorted recursively by UTF-16 code units, arrays in authored
 * order, no insignificant whitespace, numbers in shortest ECMAScript
 * round-trip form, strings as JSON.stringify emits them, literals verbatim.
 *
 * Domain tags: the D-FCP-7 registered composition tags exactly as the
 * afi-factory authoring side emits them (templates/official hashes.json):
 * afi.d2.composition-manifest / afi.d2.analyst-config / afi.d2.plugin-set,
 * plus the reactor-registered execution-summary tag afi.d2.execution-summary
 * (W3 spec section 2). afi-factory (authoring) and afi-reactor (verification)
 * MUST agree byte-exactly — the official froggy pins are asserted in
 * test/pipeline/officialArtifactPins.test.ts.
 */
import { createHash } from "node:crypto";

export const CANONICALIZATION_VERSION = "afi.hash.v1";

/** CanonicalHash v1 reference shape (vendored canonical-hash.schema.json). */
export interface CanonicalHashRef {
  algorithm: "sha256";
  canonicalizationVersion: string;
  domainTag: string;
  value: string;
}

/**
 * Canonical-hash domain tags registered by D-FCP-7 (composition family) and
 * the W3 executor spec (execution summary).
 */
export const DOMAIN_TAGS = {
  compositionManifest: "afi.d2.composition-manifest",
  analystConfig: "afi.d2.analyst-config",
  pluginSet: "afi.d2.plugin-set",
  executionSummary: "afi.d2.execution-summary",
  /** D-FCP-7 fifth registered tag — SAME domain as the provenance-record's
   *  optional enrichmentHash, made mandatory at the composition layer. */
  enrichmentBundle: "afi.d2.enrichment-bundle",
} as const;

/** Excluded top-level fields per artifact type (canonical-json-hashing.v1 §3). */
export const EXCLUDED_FIELDS = {
  "afi.pipeline.v1": ["description", "metadata"],
  "afi.pipeline-template.v1": ["description", "metadata"],
  "afi.analysis-plugin.v1": ["description", "metadata"],
  "afi.analyst-strategy-config.v1": ["metadata"],
  "afi.analyst-strategy-registration.v1": ["registeredAt"],
} as const;

/**
 * Canonical serialization — the governed reference implementation, verbatim
 * semantics: recursively key-sorted objects (UTF-16 code-unit order — the
 * JavaScript default sort), authored-order arrays, no whitespace,
 * JSON.stringify scalar forms.
 */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v)!;
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize((v as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

export function sha256Hex(utf8: string): string {
  return createHash("sha256").update(utf8, "utf-8").digest("hex");
}

/**
 * Removes the named TOP-LEVEL fields only (a nested key with the same name is
 * semantic data and survives — canonical-json-hashing.v1 §3).
 */
export function stripExcluded<T extends object>(
  artifact: T,
  excludedFields: readonly string[]
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(artifact)) {
    if (!excludedFields.includes(k)) out[k] = val;
  }
  return out as Partial<T>;
}

/** Builds a CanonicalHash v1 reference over an arbitrary JSON value. */
export function canonicalHashOf(
  value: unknown,
  domainTag: string,
  excludedFields: readonly string[] = []
): CanonicalHashRef {
  const material =
    excludedFields.length > 0 &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? stripExcluded(value as object, excludedFields)
      : value;
  return {
    algorithm: "sha256",
    canonicalizationVersion: CANONICALIZATION_VERSION,
    domainTag,
    value: sha256Hex(canonicalize(material)),
  };
}

/**
 * manifestHash: canonical hash of an afi.pipeline.v1 manifest (top-level
 * description/metadata excluded; domain tag afi.d2.composition-manifest).
 */
export function computeManifestHash(pipelineManifest: object): CanonicalHashRef {
  return canonicalHashOf(
    pipelineManifest,
    DOMAIN_TAGS.compositionManifest,
    EXCLUDED_FIELDS["afi.pipeline.v1"]
  );
}

/**
 * analystConfigHash: canonical hash of an afi.analyst-strategy-config.v1
 * object (top-level metadata excluded; domain tag afi.d2.analyst-config).
 */
export function computeAnalystConfigHash(analystConfig: object): CanonicalHashRef {
  return canonicalHashOf(
    analystConfig,
    DOMAIN_TAGS.analystConfig,
    EXCLUDED_FIELDS["afi.analyst-strategy-config.v1"]
  );
}

/** The identity triple one bound plugin contributes to the plugin-set hash. */
export interface PluginSetMember {
  pluginId: string;
  pluginVersion: string;
  implementationVersion: string;
}

/**
 * pluginSetHash: canonical hash of
 *   { schema: 'afi.plugin-set.v1',
 *     plugins: [{ pluginId, pluginVersion, implementationVersion }, ...] }
 * with plugins sorted by pluginId (then pluginVersion, plain string
 * comparison) — order-insensitive by construction. Domain tag
 * afi.d2.plugin-set. Identical rule to the afi-factory authoring side
 * (W3 spec section 10).
 */
export function computePluginSetHash(
  plugins: ReadonlyArray<PluginSetMember>
): CanonicalHashRef {
  const entries = plugins
    .map((p) => ({
      pluginId: p.pluginId,
      pluginVersion: p.pluginVersion,
      implementationVersion: p.implementationVersion,
    }))
    .sort(
      (a, b) =>
        (a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0) ||
        (a.pluginVersion < b.pluginVersion ? -1 : a.pluginVersion > b.pluginVersion ? 1 : 0)
    );
  return canonicalHashOf({ schema: "afi.plugin-set.v1", plugins: entries }, DOMAIN_TAGS.pluginSet);
}
