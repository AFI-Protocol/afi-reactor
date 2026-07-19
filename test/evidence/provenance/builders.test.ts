/**
 * District-2 builder invariants (relocated law — DSC-GOV D-DSC-3/D-DSC-4).
 *
 * Transfers the unique invariants of the retired D1-era d2Builders/crossArea
 * suites that apply to the retained live builder surface:
 *  - VAL-D2B-001 golden input-hash anchor: the relocated canonical-hash +
 *    decimal-projection law reproduces the committed golden `inputHash` for
 *    the committed USS fixture BYTE-IDENTICALLY (proves the relocation
 *    changed no hash byte).
 *  - VAL-D2B-002 verbatim projection: every scoring value is read verbatim
 *    from the carrier/analystScore — never recomputed.
 *  - VAL-D2B-003 no hash cycle: the ScoredSignal carries only the id-derived
 *    provenance-record ref, never a digest of the record.
 *  - VAL-D2B-004 forbidden-artifact-key law: money-plane/runtime keys are
 *    detected recursively and never appear in a built projection.
 *  - VAL-D2B-005 determinism + volatile exclusion: identical inputs hash
 *    identically; the volatile `scoredAt` never influences the projection or
 *    its hash; domain tags are the governed D2 tags.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildScoredSignalProjection,
  computeInputHash,
  computeScoredOutputHash,
  findForbiddenArtifactKeys,
  provenanceRecordRefFor,
  FORBIDDEN_ARTIFACT_KEYS,
  type ScoredSignalProjectionOptions,
} from "../../../src/evidence/provenance/builders.js";
import {
  AFI_HASH_V1,
  D2_DOMAIN_TAGS,
} from "../../../src/evidence/provenance/canonicalHashV1.js";
import type { InternalScoringResult } from "../../../src/evidence/analysis/internalScoringResult.js";

const GOLDEN_PATH = join(process.cwd(), "test/evidence/provenance/fixtures/golden.json");
const USS_FIXTURE_PATH = join(
  process.cwd(),
  "test/evidence/provenance/fixtures/signal.uss.json"
);

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as {
  inputHash: string;
  uwrScore: number;
  uwrAxes: { structure: number; execution: number; risk: number; insight: number };
  analystId: string;
  strategyId: string;
  direction: "long" | "short" | "neutral";
  riskBucket: string;
  conviction: number;
};
const uss = JSON.parse(readFileSync(USS_FIXTURE_PATH, "utf8")) as {
  provenance: { signalId: string; providerId: string };
};

function carrier(overrides: Partial<InternalScoringResult> = {}): InternalScoringResult {
  return {
    signalId: uss.provenance.signalId,
    uwrScore: golden.uwrScore,
    uwrAxes: { ...golden.uwrAxes },
    analystScore: {
      analystId: golden.analystId,
      strategyId: golden.strategyId,
      direction: golden.direction,
      riskBucket: golden.riskBucket,
      conviction: golden.conviction,
    },
    scoredAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function options(): ScoredSignalProjectionOptions {
  return {
    provenanceRecordRef: provenanceRecordRefFor(uss.provenance.signalId),
    providerId: uss.provenance.providerId,
  };
}

describe("VAL-D2B-001 golden input-hash anchor (relocation byte-stability)", () => {
  it("reproduces the committed golden inputHash for the committed USS fixture", () => {
    const hash = computeInputHash(uss);
    expect(hash.value).toBe(golden.inputHash);
    expect(hash.domainTag).toBe(D2_DOMAIN_TAGS.signalInput);
    expect(hash.canonicalizationVersion).toBe(AFI_HASH_V1);
  });
});

describe("VAL-D2B-002 verbatim projection", () => {
  it("reads every scoring value verbatim from the carrier — nothing recomputed", () => {
    const projection = buildScoredSignalProjection(carrier(), options());
    expect(projection.uwrScore).toBe(golden.uwrScore);
    expect(projection.uwrAxes).toEqual(golden.uwrAxes);
    expect(projection.analystId).toBe(golden.analystId);
    expect(projection.strategyId).toBe(golden.strategyId);
    expect(projection.direction).toBe(golden.direction);
    expect(projection.riskBucket).toBe(golden.riskBucket);
    expect(projection.conviction).toBe(golden.conviction);
    expect(projection.signalId).toBe(uss.provenance.signalId);
  });

  it("rejects an unsupported direction with a structured throw", () => {
    const bad = carrier({
      analystScore: { direction: "sideways" },
    });
    expect(() => buildScoredSignalProjection(bad, options())).toThrow(
      /unsupported direction/
    );
  });
});

describe("VAL-D2B-003 no ScoredSignal <-> ProvenanceRecord hash cycle", () => {
  it("the provenance-record ref is derived ONLY from the signalId", () => {
    expect(provenanceRecordRefFor("sig-1")).toBe("provenance-record:sig-1");
    expect(provenanceRecordRefFor("sig-1")).toBe(provenanceRecordRefFor("sig-1"));
  });

  it("the projection carries the string ref and no digest of the record", () => {
    const projection = buildScoredSignalProjection(carrier(), options());
    expect(projection.provenanceRecordRef).toBe(
      provenanceRecordRefFor(uss.provenance.signalId)
    );
    expect(JSON.stringify(projection)).not.toMatch(/provenanceRecordHash/);
  });
});

describe("VAL-D2B-004 forbidden-artifact-key law", () => {
  it("a built projection carries no forbidden key", () => {
    const projection = buildScoredSignalProjection(carrier(), options());
    expect(findForbiddenArtifactKeys(projection)).toEqual([]);
  });

  it("detects every forbidden key, including nested and array-nested", () => {
    for (const key of FORBIDDEN_ARTIFACT_KEYS) {
      expect(findForbiddenArtifactKeys({ nested: [{ [key]: 1 }] })).toEqual([
        `$.nested[0].${key}`,
      ]);
    }
  });
});

describe("VAL-D2B-005 determinism + volatile exclusion", () => {
  it("identical projections hash identically with the governed domain tag", () => {
    const a = buildScoredSignalProjection(carrier(), options());
    const b = buildScoredSignalProjection(carrier(), options());
    const ha = computeScoredOutputHash(a);
    const hb = computeScoredOutputHash(b);
    expect(ha.value).toBe(hb.value);
    expect(ha.domainTag).toBe(D2_DOMAIN_TAGS.scoredOutput);
    expect(ha.canonicalizationVersion).toBe(AFI_HASH_V1);
  });

  it("the volatile scoredAt never reaches the projection or its hash", () => {
    const a = buildScoredSignalProjection(
      carrier({ scoredAt: "2020-01-01T00:00:00.000Z" }),
      options()
    );
    const b = buildScoredSignalProjection(
      carrier({ scoredAt: "2031-12-31T23:59:59.999Z" }),
      options()
    );
    expect(a).toEqual(b);
    expect(computeScoredOutputHash(a).value).toBe(computeScoredOutputHash(b).value);
    expect(JSON.stringify(a)).not.toMatch(/scoredAt/);
  });

  it("a changed scoring value changes the output hash", () => {
    const a = buildScoredSignalProjection(carrier(), options());
    const b = buildScoredSignalProjection(
      carrier({ uwrScore: golden.uwrScore + 0.0625 }),
      options()
    );
    expect(computeScoredOutputHash(a).value).not.toBe(
      computeScoredOutputHash(b).value
    );
  });
});
