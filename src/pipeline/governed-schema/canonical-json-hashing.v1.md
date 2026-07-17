# Canonical JSON Hashing v1 (`afi.hash.v1` manifest-hashing profile)

**Status:** `governed-contract` (FACTORY-CONTRACT slot of the AFI Factory analyst-configurable pipelines V1 program).
**Authorization:** `afi-governance/decisions/factory-configurable-pipelines-v1`.
**Scope:** the canonical **manifest/config hashing** rules behind `manifestHash`, `analystConfigHash`, `pluginSetHash`, `executionSummaryHash`, and template hashing in the V1 contract family. It concretizes, for these artifact types, the serialization rules the CanonicalHash draft left OPEN (`CH-O1`) — it does **not** re-decide the CanonicalHash reference shape, on-chain domains, or per-signal evidence hashing.

## 1. The rule

> **hash = SHA-256 over the UTF-8 bytes of the canonically serialized JSON value, after removing the artifact type's excluded fields.**

The digest is rendered as 64 lowercase hex characters and carried inside a
[`CanonicalHash v1`](../provenance/v1/canonical-hash.schema.json) object
(`algorithm: "sha256"`, `canonicalizationVersion: "afi.hash.v1"`, the artifact's domain tag, `value`).

## 2. Canonical serialization

Aligned with RFC 8785 (JCS) for the JSON subset these artifacts use:

1. **Objects:** keys sorted lexicographically by **UTF-16 code units** (JavaScript default string comparison; RFC 8785 §3.2.3). Applied **recursively** at every nesting level.
2. **Arrays:** element order **preserved** exactly as authored (arrays are ordered data — never sorted).
3. **Whitespace:** none. No insignificant whitespace anywhere (`{"a":1,"b":[1,2]}`).
4. **Numbers:** shortest ECMAScript round-trip form — exactly what `JSON.stringify` emits for a JavaScript `number` (ECMA-262 `Number::toString`). Consequences the KATs pin: `1.0` → `1`, `1e21` → `1e+21`, `0.0000001` → `1e-7`, `-0` → `0`.
5. **Strings:** JSON escaping as emitted by `JSON.stringify` (minimal escaping; non-ASCII characters emitted literally in UTF-8, not `\u`-escaped).
6. **Literals:** `true` / `false` / `null` verbatim.

Reference implementation (the one the tests execute):

```ts
function canonicalize(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  return '{' + Object.keys(v).sort()
    .map(k => JSON.stringify(k) + ':' + canonicalize((v as any)[k]))
    .join(',') + '}';
}
// hash = sha256(utf8(canonicalize(stripExcluded(artifact)))) as lowercase hex
```

## 3. Excluded fields — enumerated per artifact type

Volatile/administrative fields are **removed before serialization**. Exclusion applies to the named **top-level** fields of the artifact only (a nested `config.metadata` key inside a node is semantic data and is **never** stripped).

| Artifact type | Excluded top-level fields | Domain tag |
|---|---|---|
| `afi.pipeline.v1` | `description`, `metadata` | `afi.d2.composition-manifest` |
| `afi.pipeline-template.v1` | `description`, `metadata` | `afi.factory.pipeline-template` |
| `afi.analysis-plugin.v1` | `description`, `metadata` | `afi.factory.plugin-manifest` (single manifest) |
| plugin **set** (composition) | n/a — hash material is the derived `afi.plugin-set.v1` object below, not the manifests | `afi.d2.plugin-set` |
| `afi.analyst-strategy-config.v1` | `metadata` | `afi.d2.analyst-config` |
| `afi.analyst-strategy-registration.v1` | `registeredAt` | `afi.factory.strategy-registration` |
| `afi.provider-strategy-binding.v1` | *(none)* | `afi.factory.provider-binding` |
| `afi.composition-ref.v1` | *(none)* | `afi.factory.composition-ref` |
| execution summary (`afi.execution-summary.v1` derived object) | must be authored timestamp-free (District 2 hash doctrine) — nothing to exclude | `afi.d2.execution-summary` |
| enrichment bundle (timestamp-free canonical projection, `afi.enrichment-bundle.v1`) | volatile fields (e.g. `enrichedAt`) are excluded by the projection itself | `afi.d2.enrichment-bundle` |

> **Amendment (W3a, per accepted `afi-governance/decisions/factory-configurable-pipelines-v1` D-FCP-7):** the three composition domain tags are the D-FCP-7 registered tags shipped by the accepted afi-factory implementation — `afi.d2.composition-manifest` (`manifestHash`), `afi.d2.analyst-config` (`analystConfigHash`), `afi.d2.plugin-set` (`pluginSetHash`). This table previously listed `afi.factory.pipeline-manifest` / `afi.factory.analyst-config` for those rows and an array-of-stripped-manifests plugin-set rule; the accepted decision + shipped rule supersede that text. **`pluginSetHash` rule (shipped):** the hash material is the derived object
> `{"schema":"afi.plugin-set.v1","plugins":[{"pluginId":…,"pluginVersion":…,"implementationVersion":…},…]}`
> with `plugins` sorted by `pluginId` (then `pluginVersion` for repeated ids; plain string comparison). Domain tags are **carried** in the `CanonicalHash` object, never part of the hash material, so the digest algorithm (§1–§2) and every governed KAT vector (§4) are unchanged by this amendment.

Notes:
- Excluded fields are removed **whether or not** they validate — annotations can never perturb a hash.
- The pipeline `nodes`/`edges` arrays keep authored order (array rule); two manifests differing only in node ORDER are **different manifests** with different hashes. Determinism of execution comes from the graph semantics, not from hash normalization.
- The plugin **set** hash is computed over the derived `afi.plugin-set.v1` object (pluginId/pluginVersion/implementationVersion triples sorted by `pluginId` then `pluginVersion`, plain string comparison), so set hashing is order-insensitive by construction and independent of manifest annotation fields.

## 4. Known-answer tests (KATs)

The governed vectors live in [`../../kats/hashing/v1/canonical-json-hashing.kat.json`](../../kats/hashing/v1/canonical-json-hashing.kat.json): each vector carries `input` (+ optional `excludedFields`), the `expectedCanonicalForm` string, and `expectedSha256`.

**Conformance rule:** `afi-factory` (authoring/hashing side) and `afi-reactor` (verification side) MUST both pass every vector byte-exactly. The afi-config suite (`tests/canonical-hashing-kat.test.ts`) executes the reference implementation above against every vector; a consuming repo imports the same KAT file and asserts its own implementation agrees.

## 5. Change control

Any change to the serialization rules, the exclusion table, or the domain-tag expectations requires a new governance decision and a new version of this document (`canonical-json-hashing.v2.md`) together with a bumped `canonicalizationVersion` — never a silent mutation. Hashes computed under different canonicalization versions are **never** comparable.
