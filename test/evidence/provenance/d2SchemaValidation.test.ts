/**
 * Tests for the D2 schema validation adapter (District 2 M2): the merged
 * afi-config provenance schemas compile on a dedicated strict AJV instance,
 * afi-config's committed examples validate positively, and malformed /
 * forbidden-field payloads are rejected. Forbidden runtime/storage/debug and
 * out-of-scope protocol fields are structurally rejected via
 * `additionalProperties: false`.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import {
  validateD2Artifact,
  validateCanonicalHashV1,
  validateTradePlanV1,
  validateAnalystInputEnvelopeV1,
  validateScoredSignalV1,
  validateProvenanceRecordV1,
  D2_ARTIFACT_KINDS,
  type D2ArtifactKind,
} from "../../../src/evidence/provenance/schemaValidation.js";

/** afi-config's committed valid examples (read via the installed package link). */
const EXAMPLE_FILES: Record<D2ArtifactKind, string> = {
  "canonical-hash": "canonical-hash.example.json",
  "evidence-ref": "evidence-ref.example.json",
  "source-disclosure-profile": "source-disclosure-profile.example.json",
  "enrichment-provenance": "enrichment-provenance.example.json",
  "analyst-input-envelope": "analyst-input-envelope.example.json",
  "scored-signal": "scored-signal.example.json",
  "provenance-record": "provenance-record.example.json",
  "replay-profile": "replay-profile.example.json",
  "trade-plan": "trade-plan.example.json",
};

function loadExample(kind: D2ArtifactKind): unknown {
  const path = join(
    process.cwd(),
    "node_modules/afi-config/examples/provenance/v1",
    EXAMPLE_FILES[kind]
  );
  return JSON.parse(readFileSync(path, "utf-8"));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const VALID_HASH = {
  algorithm: "sha256",
  canonicalizationVersion: "afi.hash.v1",
  domainTag: "afi.d2.signal-input",
  value: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
};

describe("D2 schema validation adapter — positive cases", () => {
  it("covers all nine merged artifact kinds", () => {
    expect([...D2_ARTIFACT_KINDS].sort()).toEqual(
      [
        "analyst-input-envelope",
        "canonical-hash",
        "enrichment-provenance",
        "evidence-ref",
        "provenance-record",
        "replay-profile",
        "scored-signal",
        "source-disclosure-profile",
        "trade-plan",
      ].sort()
    );
  });

  for (const kind of D2_ARTIFACT_KINDS) {
    it(`afi-config's committed ${kind} example validates`, () => {
      const result = validateD2Artifact(kind, loadExample(kind));
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }

  it("returns a structured result with errors always an array", () => {
    const ok = validateCanonicalHashV1(VALID_HASH);
    expect(ok).toEqual({ ok: true, errors: [] });
    const bad = validateCanonicalHashV1({});
    expect(bad.ok).toBe(false);
    expect(Array.isArray(bad.errors)).toBe(true);
    expect(bad.errors.length).toBeGreaterThan(0);
    for (const err of bad.errors) {
      expect(typeof err.field).toBe("string");
      expect(typeof err.message).toBe("string");
    }
  });
});

describe("CanonicalHash v1 schema — negative cases", () => {
  it("rejects keccak256 (on-chain domains are a separate family)", () => {
    const bad = { ...clone(VALID_HASH), algorithm: "keccak256" };
    expect(validateCanonicalHashV1(bad).ok).toBe(false);
  });

  it("rejects a malformed canonicalizationVersion", () => {
    const bad = { ...clone(VALID_HASH), canonicalizationVersion: "hash.v1" };
    expect(validateCanonicalHashV1(bad).ok).toBe(false);
  });

  it("rejects a malformed domainTag", () => {
    const bad = { ...clone(VALID_HASH), domainTag: "AFI.D2.X" };
    expect(validateCanonicalHashV1(bad).ok).toBe(false);
  });

  it("rejects a non-hex / wrong-length digest value", () => {
    expect(validateCanonicalHashV1({ ...clone(VALID_HASH), value: "abc" }).ok).toBe(false);
    expect(
      validateCanonicalHashV1({ ...clone(VALID_HASH), value: "Z".repeat(64) }).ok
    ).toBe(false);
  });

  it("rejects missing required members with dotted-field errors", () => {
    const { domainTag: _dropped, ...bad } = clone(VALID_HASH);
    const result = validateCanonicalHashV1(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /domainTag/.test(e.field))).toBe(true);
  });
});

describe("forbidden fields are structurally rejected (additionalProperties:false)", () => {
  const FORBIDDEN_PROBES: Array<[string, unknown]> = [
    ["rawUss", { any: true }],
    ["lenses", []],
    ["_priceFeedMetadata", {}],
    ["_id", "65f0"],
    ["createdAt", "2026-01-01T00:00:00Z"],
    ["updatedAt", "2026-01-01T00:00:00Z"],
    ["rawPayload", "..."],
    ["claimRoot", "0xabc"],
    ["rewardAmount", "100"],
    ["vaultAddress", "0xdef"],
    ["validatorDecision", { verdict: "approve" }],
    ["demoOnly", true],
    ["scoredAt", "2026-01-01T00:00:00Z"],
  ];

  for (const [key, value] of FORBIDDEN_PROBES) {
    it(`ScoredSignal v1 rejects "${key}"`, () => {
      const scored = { ...clone(loadExample("scored-signal") as object), [key]: value };
      const result = validateScoredSignalV1(scored);
      expect(result.ok).toBe(false);
    });

    it(`ProvenanceRecord v1 rejects "${key}"`, () => {
      const record = { ...clone(loadExample("provenance-record") as object), [key]: value };
      const result = validateProvenanceRecordV1(record);
      expect(result.ok).toBe(false);
    });
  }
});

describe("AnalystInputEnvelope v1 — opaque view must be declared", () => {
  it("rejects an undeclared strategyLocalView (no strategyViewType / enrichedViewSchemaRef)", () => {
    const envelope = clone(loadExample("analyst-input-envelope")) as Record<string, unknown>;
    delete envelope.strategyViewType;
    delete envelope.enrichedViewSchemaRef;
    expect(validateAnalystInputEnvelopeV1(envelope).ok).toBe(false);
  });

  it("accepts a declared view via strategyViewType alone", () => {
    const envelope = clone(loadExample("analyst-input-envelope")) as Record<string, unknown>;
    delete envelope.enrichedViewSchemaRef;
    const result = validateAnalystInputEnvelopeV1(envelope);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("TradePlan v1 — decimal strings only (validation helper; no generation)", () => {
  it("rejects raw float prices where decimal strings are required", () => {
    const plan = clone(loadExample("trade-plan")) as {
      levels: { entry: unknown; stopLoss?: unknown };
    };
    plan.levels.entry = 42000.5; // float, not a decimal string
    expect(validateTradePlanV1(plan).ok).toBe(false);
  });

  it("accepts decimal-string prices", () => {
    const plan = clone(loadExample("trade-plan")) as {
      levels: { entry: unknown };
    };
    plan.levels.entry = "42000.50";
    const result = validateTradePlanV1(plan);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
