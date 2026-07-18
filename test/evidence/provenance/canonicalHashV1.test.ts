/**
 * Tests for the CanonicalHash v1 runtime utility (District 2 M2) —
 * deterministic ordering, domain separation in the preimage, domainTag
 * rejection, the D2 timestamp policy (volatile excluded/rejected; evidence
 * timestamps admissible), the strict number policy (arbitrary floats rejected
 * unconditionally — no opt-in flag), decimal-string preservation, and digest
 * stability. The emitted CanonicalHashV1 object is validated against the
 * merged afi-config canonical-hash schema.
 */

import { describe, it, expect } from "@jest/globals";
import {
  canonicalizeV1,
  canonicalPreimageV1,
  computeCanonicalHashV1,
  assertValidDomainTag,
  CanonicalHashPolicyError,
  AFI_HASH_V1,
  DOMAIN_TAG_PATTERN,
  VOLATILE_TIMESTAMP_KEYS,
  EVIDENCE_TIMESTAMP_KEYS,
  D2_DOMAIN_TAGS,
} from "../../../src/evidence/provenance/canonicalHashV1.js";
import { validateCanonicalHashV1 } from "../../../src/evidence/provenance/schemaValidation.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const TAG = "afi.d2.test-domain";

function digest(value: unknown, domainTag = TAG): string {
  return computeCanonicalHashV1(value, { domainTag }).value;
}

describe("canonicalizeV1 — deterministic ordering & stable serialization", () => {
  it("is key-order independent (top-level)", () => {
    expect(canonicalizeV1({ a: 1, b: 2, c: 3 })).toBe(canonicalizeV1({ c: 3, b: 2, a: 1 }));
  });

  it("is key-order independent (nested objects)", () => {
    const a = canonicalizeV1({ outer: { x: 1, y: { p: 1, q: 2 } }, z: [1, 2] });
    const b = canonicalizeV1({ z: [1, 2], outer: { y: { q: 2, p: 1 }, x: 1 } });
    expect(a).toBe(b);
  });

  it("preserves array order (array order is substantive)", () => {
    expect(canonicalizeV1({ list: [1, 2, 3] })).not.toBe(canonicalizeV1({ list: [3, 2, 1] }));
  });

  it("drops undefined members and produces a key-sorted JSON string", () => {
    expect(canonicalizeV1({ b: 2, a: 1, gone: undefined })).toBe('{"a":1,"b":2}');
  });

  it("rejects unsupported value kinds (bigint) with a structured error", () => {
    expect(() => canonicalizeV1({ big: 1n })).toThrow(CanonicalHashPolicyError);
  });
});

describe("CanonicalHash v1 — digest stability & domain separation", () => {
  it("produces a 64-char lowercase hex digest, stable across repeated calls", () => {
    const value = { symbol: "BTC/USDT", market: "perp", nested: { k: [1, 2] } };
    const first = digest(value);
    expect(first).toMatch(HEX_64);
    for (let i = 0; i < 5; i += 1) {
      expect(digest(value)).toBe(first);
    }
  });

  it("identical content with different key insertion order yields an identical digest", () => {
    expect(digest({ a: 1, b: { d: 4, c: 3 } })).toBe(digest({ b: { c: 3, d: 4 }, a: 1 }));
  });

  it("the domain tag participates in the preimage (visible + digest-affecting)", () => {
    const value = { a: 1 };
    const preimage = canonicalPreimageV1(value, { domainTag: TAG });
    expect(preimage).toBe(`${AFI_HASH_V1}\n${TAG}\n{"a":1}`);
    // Same canonical object, different domain tag => different digest.
    expect(digest(value, D2_DOMAIN_TAGS.signalInput)).not.toBe(
      digest(value, D2_DOMAIN_TAGS.scoredOutput)
    );
  });

  it("the reference object carries algorithm/canonicalizationVersion/domainTag", () => {
    const hash = computeCanonicalHashV1({ a: 1 }, { domainTag: TAG });
    expect(hash).toEqual({
      algorithm: "sha256",
      canonicalizationVersion: "afi.hash.v1",
      domainTag: TAG,
      value: expect.stringMatching(HEX_64),
    });
  });

  it("the emitted CanonicalHashV1 object validates against the merged afi-config schema", () => {
    const hash = computeCanonicalHashV1({ a: 1 }, { domainTag: D2_DOMAIN_TAGS.evidence });
    const result = validateCanonicalHashV1(hash);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("CanonicalHash v1 — domainTag rejection", () => {
  const badTags = ["", "afi", "AFI.D2.X", "d2.foo", "afi.", "afi..x", "afi.D2", "afi.d2.signal_input"];
  for (const tag of badTags) {
    it(`rejects malformed domain tag ${JSON.stringify(tag)}`, () => {
      expect(() => computeCanonicalHashV1({ a: 1 }, { domainTag: tag })).toThrow(
        CanonicalHashPolicyError
      );
      try {
        assertValidDomainTag(tag);
        throw new Error("expected a policy error");
      } catch (err) {
        expect(err).toBeInstanceOf(CanonicalHashPolicyError);
        expect((err as CanonicalHashPolicyError).reason).toBe("invalid-domain-tag");
      }
    });
  }

  it("accepts well-formed afi.* tags (pattern sanity)", () => {
    for (const tag of Object.values(D2_DOMAIN_TAGS)) {
      expect(tag).toMatch(DOMAIN_TAG_PATTERN);
      expect(() => assertValidDomainTag(tag)).not.toThrow();
    }
  });
});

describe("CanonicalHash v1 — timestamp policy (D2 hash doctrine)", () => {
  it("VOLATILE_TIMESTAMP_KEYS is exactly the doctrine set", () => {
    expect([...VOLATILE_TIMESTAMP_KEYS].sort()).toEqual(
      [
        "scoredAt",
        "createdAt",
        "updatedAt",
        "storedAt",
        "processedAt",
        "ingestedAt",
        "startedAt",
        "finishedAt",
      ].sort()
    );
  });

  it("excludes every volatile runtime/storage timestamp key by default", () => {
    const base = { signalId: "s1", value: 1 };
    const noisy: Record<string, unknown> = { ...base };
    for (const key of VOLATILE_TIMESTAMP_KEYS) {
      noisy[key] = "2025-01-01T00:00:00.000Z";
    }
    expect(digest(noisy)).toBe(digest(base));
  });

  it("excludes volatile keys at any nesting depth", () => {
    const a = { meta: { scoredAt: "A", value: 1 }, items: [{ ingestedAt: "X" }] };
    const b = { meta: { scoredAt: "B", value: 1 }, items: [{ ingestedAt: "Y" }] };
    expect(digest(a)).toBe(digest(b));
  });

  it('rejects volatile keys under volatileTimestampPolicy: "reject"', () => {
    for (const key of VOLATILE_TIMESTAMP_KEYS) {
      const value = { [key]: "2025-01-01T00:00:00.000Z" };
      expect(() =>
        canonicalizeV1(value, { volatileTimestampPolicy: "reject" })
      ).toThrow(CanonicalHashPolicyError);
      try {
        canonicalizeV1(value, { volatileTimestampPolicy: "reject" });
      } catch (err) {
        expect((err as CanonicalHashPolicyError).reason).toBe("volatile-timestamp");
      }
    }
  });

  it("domain-declared evidence/evaluation timestamps ARE hash material", () => {
    expect([...EVIDENCE_TIMESTAMP_KEYS].sort()).toEqual(
      ["asOf", "fetchedAt", "postedAt", "observedAt", "observationTime", "evaluatedAt"].sort()
    );
    for (const key of EVIDENCE_TIMESTAMP_KEYS) {
      const early = { [key]: "2024-01-01T00:00:00.000Z" };
      const late = { [key]: "2026-01-01T00:00:00.000Z" };
      // Changing an evidence timestamp CHANGES the digest (it is hash material)...
      expect(digest(early)).not.toBe(digest(late));
      // ...and it is not silently dropped.
      expect(canonicalizeV1(early)).toContain(key);
    }
  });

  it("changing a non-timestamp value changes the digest", () => {
    expect(digest({ value: 1, scoredAt: "x" })).not.toBe(digest({ value: 2, scoredAt: "x" }));
  });
});

describe("CanonicalHash v1 — strict number policy (no float opt-in exists)", () => {
  it("rejects arbitrary non-integer numbers unconditionally", () => {
    for (const bad of [0.5, 0.1875, -3.14, 1.0000001]) {
      expect(() => digest({ n: bad })).toThrow(CanonicalHashPolicyError);
      try {
        digest({ n: bad });
      } catch (err) {
        expect((err as CanonicalHashPolicyError).reason).toBe("non-integer-number");
      }
    }
  });

  it("rejects non-integer numbers at any nesting depth", () => {
    expect(() => digest({ deep: [{ x: { y: 0.25 } }] })).toThrow(CanonicalHashPolicyError);
  });

  it("rejects NaN and Infinity always", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      try {
        digest({ n: bad });
        throw new Error("expected a policy error");
      } catch (err) {
        expect(err).toBeInstanceOf(CanonicalHashPolicyError);
        expect((err as CanonicalHashPolicyError).reason).toBe("non-finite-number");
      }
    }
  });

  it("rejects integers outside the safe range", () => {
    expect(() => digest({ n: Number.MAX_SAFE_INTEGER + 2 })).toThrow(CanonicalHashPolicyError);
  });

  it("accepts safe integers", () => {
    expect(digest({ n: 0, m: -42, big: Number.MAX_SAFE_INTEGER })).toMatch(HEX_64);
  });

  it("the canonicalize/compute option surface exposes NO number policy flag", () => {
    // The only supported option is the volatile-timestamp policy; there is no
    // escape hatch that admits floats (owner-required tightening).
    const optionsProbe: Record<string, unknown> = {
      volatileTimestampPolicy: "exclude",
      numberPolicy: "ieee-verbatim", // must be inert / unknown
      allowFloats: true, // must be inert / unknown
    };
    expect(() =>
      canonicalizeV1({ n: 0.5 }, optionsProbe as { volatileTimestampPolicy: "exclude" })
    ).toThrow(CanonicalHashPolicyError);
  });

  it("preserves decimal strings as strings (never coerced, distinct from numbers)", () => {
    const asString = { price: "42000.50" };
    expect(canonicalizeV1(asString)).toBe('{"price":"42000.50"}');
    expect(digest(asString)).toMatch(HEX_64);
    // A trailing-zero-normalized string is DIFFERENT hash material.
    expect(digest(asString)).not.toBe(digest({ price: "42000.5" }));
    // And a numeric encoding of the same magnitude is rejected, not conflated.
    expect(() => digest({ price: 42000.5 })).toThrow(CanonicalHashPolicyError);
  });
});
