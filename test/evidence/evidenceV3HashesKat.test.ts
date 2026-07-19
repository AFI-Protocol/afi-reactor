/**
 * EV3-GOV governed known-answer vectors (D-EV3-4(8)) — the reactor's OWN
 * composition-law implementation (src/pipeline/hashing.ts +
 * src/evidence/provenance/invocationProofHashes.ts) reproduces the governed
 * afi-config Evidence V3 hash KATs BYTE-EXACTLY:
 *
 *   afi-config/kats/evidence/v3/evidence-v3-hashes.kat.json
 *   (loaded through the file:-linked node_modules/afi-config — the same
 *   governed source the registry loader boot-verifies against)
 *
 * Vectors: recordHash (afi.d2.evidence-record), replayHash
 * (afi.d2.evidence-replay) over the governed v3 canonical example, plus the
 * five per-lane vectors (categoryResultHash afi.d2.lane-output over the FULL
 * category result; providerResultHash afi.d2.provider-result over the result
 * minus `category`) over the governed enrichment-contract valid vectors.
 *
 * Every digest is sha256 over UTF-8 of the canonically serialized JSON per
 * canonical-json-hashing.v1, domain tag CARRIED and never hashed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalHashOf } from "../../src/pipeline/hashing.js";
import {
  categoryResultHash,
  providerResultHash,
  EVIDENCE_RECORD_EXCLUDED_FIELDS,
  EVIDENCE_REPLAY_EXCLUDED_FIELDS,
  evidenceRecordHash,
  evidenceReplayHash,
  PROVIDER_PROOF_DOMAIN_TAGS,
} from "../../src/evidence/provenance/invocationProofHashes.js";

interface RecordVector {
  name: string;
  domainTag: string;
  excludedFields: string[];
  input: Record<string, unknown>;
  expectedSha256: string;
}

interface LaneVector {
  name: string;
  category: string;
  categoryResultDomainTag: string;
  expectedCategoryResultSha256: string;
  providerResultDomainTag: string;
  providerResultExcludedFields: string[];
  expectedProviderResultSha256: string;
  input: { category: string } & Record<string, unknown>;
}

const KAT_PATH = join(
  process.cwd(),
  "node_modules/afi-config/kats/evidence/v3/evidence-v3-hashes.kat.json"
);

const kat = JSON.parse(readFileSync(KAT_PATH, "utf8")) as {
  schema: string;
  canonicalizationVersion: string;
  vectors: Array<RecordVector | LaneVector>;
};

const recordVectors = kat.vectors.filter((v) => "expectedSha256" in v) as RecordVector[];
const laneVectors = kat.vectors.filter(
  (v) => "expectedCategoryResultSha256" in v
) as LaneVector[];

describe("EV3-GOV — governed evidence-v3 hash KATs reproduced by the reactor's own law", () => {
  it("is the governed KAT suite (schema + law + full vector coverage)", () => {
    expect(kat.schema).toBe("afi.evidence-v3-hash-kat.v1");
    expect(kat.canonicalizationVersion).toBe("afi.hash.v1");
    expect(recordVectors.map((v) => v.name).sort()).toEqual([
      "record-hash-full-record",
      "replay-hash-projection",
    ]);
    expect(laneVectors.map((v) => v.category).sort()).toEqual([
      "aiMl",
      "news",
      "pattern",
      "sentiment",
      "technical",
    ]);
  });

  it.each(recordVectors.map((v) => [v.name, v] as const))(
    "reproduces '%s' byte-exactly with canonicalHashOf (governed tag + exclusions)",
    (_name, vector) => {
      const ref = canonicalHashOf(vector.input, vector.domainTag, vector.excludedFields);
      expect(ref.value).toBe(vector.expectedSha256);
      expect(ref.domainTag).toBe(vector.domainTag);
      expect(ref.canonicalizationVersion).toBe("afi.hash.v1");
      expect(ref.algorithm).toBe("sha256");
    }
  );

  it("the record/replay vectors pin EXACTLY the reactor's own projection exclusions (D-EV3-4(6))", () => {
    const record = recordVectors.find((v) => v.name === "record-hash-full-record")!;
    const replay = recordVectors.find((v) => v.name === "replay-hash-projection")!;
    expect([...record.excludedFields].sort()).toEqual([...EVIDENCE_RECORD_EXCLUDED_FIELDS].sort());
    expect([...replay.excludedFields].sort()).toEqual([...EVIDENCE_REPLAY_EXCLUDED_FIELDS].sort());
    expect(record.domainTag).toBe(PROVIDER_PROOF_DOMAIN_TAGS.evidenceRecord);
    expect(replay.domainTag).toBe(PROVIDER_PROOF_DOMAIN_TAGS.evidenceReplay);
    // and the reactor's own record-level projection functions agree byte-exactly
    expect(evidenceRecordHash(record.input).value).toBe(record.expectedSha256);
    expect(evidenceReplayHash(replay.input).value).toBe(replay.expectedSha256);
  });

  it.each(laneVectors.map((v) => [v.name, v] as const))(
    "reproduces '%s' byte-exactly with categoryResultHash + providerResultHash",
    (_name, vector) => {
      const full = categoryResultHash(vector.input);
      expect(full.value).toBe(vector.expectedCategoryResultSha256);
      expect(full.domainTag).toBe(vector.categoryResultDomainTag);
      expect(full.domainTag).toBe(PROVIDER_PROOF_DOMAIN_TAGS.laneOutput);

      const payload = providerResultHash(vector.input);
      expect(payload.value).toBe(vector.expectedProviderResultSha256);
      expect(payload.domainTag).toBe(vector.providerResultDomainTag);
      expect(payload.domainTag).toBe(PROVIDER_PROOF_DOMAIN_TAGS.providerResult);
      expect(vector.providerResultExcludedFields).toEqual(["category"]);
    }
  );
});
