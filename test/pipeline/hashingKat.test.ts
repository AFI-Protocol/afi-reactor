/**
 * Canonical-json-hashing.v1 conformance: the reactor implementation MUST pass
 * every governed KAT vector byte-exactly (afi-config kats/hashing/v1,
 * vendored at src/pipeline/governed-schema/canonical-json-hashing.kat.json).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANONICALIZATION_VERSION,
  DOMAIN_TAGS,
  EXCLUDED_FIELDS,
  canonicalHashOf,
  canonicalize,
  computePluginSetHash,
  sha256Hex,
  stripExcluded,
} from "../../src/pipeline/hashing.js";

interface KatVector {
  name: string;
  input: unknown;
  excludedFields?: string[];
  expectedCanonicalForm: string;
  expectedSha256: string;
}

const kat = JSON.parse(
  readFileSync(
    join(process.cwd(), "src/pipeline/governed-schema/canonical-json-hashing.kat.json"),
    "utf-8"
  )
) as { schema: string; canonicalizationVersion: string; vectors: KatVector[] };

describe("canonical-json-hashing.v1 KATs (governed vectors, byte-exact)", () => {
  it("is the governed KAT file for the pinned canonicalization version", () => {
    expect(kat.schema).toBe("afi.canonical-json-hashing-kat.v1");
    expect(kat.canonicalizationVersion).toBe(CANONICALIZATION_VERSION);
    expect(kat.vectors).toHaveLength(6);
  });

  for (const vector of kat.vectors) {
    it(`vector '${vector.name}': canonical form and sha256 match byte-exactly`, () => {
      const material = vector.excludedFields
        ? stripExcluded(vector.input as object, vector.excludedFields)
        : vector.input;
      const canonical = canonicalize(material);
      expect(canonical).toBe(vector.expectedCanonicalForm);
      expect(sha256Hex(canonical)).toBe(vector.expectedSha256);
    });
  }
});

describe("canonicalHashOf reference construction", () => {
  it("emits a CanonicalHash v1 reference with the registered domain tag", () => {
    const ref = canonicalHashOf({ a: 1 }, DOMAIN_TAGS.executionSummary);
    expect(ref).toEqual({
      algorithm: "sha256",
      canonicalizationVersion: "afi.hash.v1",
      domainTag: "afi.d2.execution-summary",
      value: sha256Hex('{"a":1}'),
    });
  });

  it("strips only the artifact's TOP-LEVEL excluded fields", () => {
    const withMeta = canonicalHashOf(
      { schema: "afi.pipeline.v1", metadata: { x: 1 }, nodes: [{ config: { metadata: "keep" } }] },
      DOMAIN_TAGS.compositionManifest,
      EXCLUDED_FIELDS["afi.pipeline.v1"]
    );
    const withoutMeta = canonicalHashOf(
      { schema: "afi.pipeline.v1", nodes: [{ config: { metadata: "keep" } }] },
      DOMAIN_TAGS.compositionManifest,
      EXCLUDED_FIELDS["afi.pipeline.v1"]
    );
    expect(withMeta.value).toBe(withoutMeta.value);
  });

  it("plugin-set hashing is order-insensitive by construction", () => {
    const a = { pluginId: "b-plugin", pluginVersion: "1.0.0", implementationVersion: "1.0.0" };
    const b = { pluginId: "a-plugin", pluginVersion: "1.0.0", implementationVersion: "1.0.0" };
    expect(computePluginSetHash([a, b]).value).toBe(computePluginSetHash([b, a]).value);
    expect(computePluginSetHash([a, b]).domainTag).toBe("afi.d2.plugin-set");
  });
});
