import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import {
  schemaValidationPipehead,
  validateUssV11Canonical,
  SCHEMA_VALIDATION_PIPEHEAD_ID,
  CANONICAL_VALIDATOR_NOTE,
  USS_V11_SCHEMA_CONST,
} from "../../src/pipeheads/schemaValidationPipehead.js";
import type { PipeheadContext } from "../../src/pipeheads/types.js";
import { createFrozenClock } from "../../src/pipeheads/clock.js";

function loadValidFixture(): Record<string, unknown> {
  const fixturePath = join(
    process.cwd(),
    "test/pipeheads/fixtures/signal.uss.json"
  );
  return JSON.parse(readFileSync(fixturePath, "utf-8"));
}

function ctxFor(rawUss: unknown, iso?: string): PipeheadContext {
  return {
    signalId: "btc-usdt-perp-4h-0001",
    rawUss,
    clock: createFrozenClock(iso),
  };
}

/**
 * Replica of the REPLACED self-contained structural validator's acceptance
 * rules (pre-DR-001): top-level object, `schema` const, and `provenance` with
 * string `source`/`providerId`/`signalId`. Used by the distinguishing tests
 * below to prove a payload the OLD validator would have ACCEPTED is now
 * REJECTED by canonical validation — i.e. DR-001 canonical validation is live.
 */
function passesOldStructuralRules(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  if (record.schema !== USS_V11_SCHEMA_CONST) {
    return false;
  }
  const provenance = record.provenance;
  if (provenance === null || typeof provenance !== "object" || Array.isArray(provenance)) {
    return false;
  }
  const p = provenance as Record<string, unknown>;
  return (
    typeof p.source === "string" &&
    typeof p.providerId === "string" &&
    typeof p.signalId === "string"
  );
}

describe("canonical fixture", () => {
  it("is a well-formed USS v1.1 signal with the pinned facts", () => {
    const fixture = loadValidFixture();
    expect(fixture.schema).toBe("afi.usignal.v1.1");
    const provenance = fixture.provenance as Record<string, unknown>;
    expect(typeof provenance.source).toBe("string");
    expect(typeof provenance.providerId).toBe("string");
    expect(typeof provenance.signalId).toBe("string");
    const facts = fixture.facts as Record<string, unknown>;
    expect(facts.symbol).toBe("BTC/USDT");
    expect(facts.market).toBe("perp");
    expect(facts.timeframe).toBe("4h");
  });
});

describe("validateUssV11Canonical", () => {
  it("accepts the canonical valid fixture with no errors (errors is an EMPTY ARRAY, not undefined)", () => {
    const result = validateUssV11Canonical(loadValidFixture());
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a missing required provenance field, mapping field to the MISSING KEY (provenance.signalId)", () => {
    const fixture = loadValidFixture();
    delete (fixture.provenance as Record<string, unknown>).signalId;
    const result = validateUssV11Canonical(fixture);
    expect(result.ok).toBe(false);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    const fields = result.errors.map((e) => e.field);
    expect(fields).toContain("provenance.signalId");
    for (const err of result.errors) {
      expect(typeof err.field).toBe("string");
      expect(err.field.length).toBeGreaterThan(0);
      expect(typeof err.message).toBe("string");
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it("rejects a missing required top-level block, mapping field to the missing key (provenance)", () => {
    const fixture = loadValidFixture();
    delete (fixture as Record<string, unknown>).provenance;
    const result = validateUssV11Canonical(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.field)).toContain("provenance");
  });

  it("rejects a missing required top-level block, mapping field to the missing key (schema)", () => {
    const fixture = loadValidFixture();
    delete (fixture as Record<string, unknown>).schema;
    const result = validateUssV11Canonical(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.field)).toContain("schema");
  });

  it("rejects a wrong schema id via the canonical const constraint", () => {
    const fixture = loadValidFixture();
    (fixture as Record<string, unknown>).schema = "afi.usignal.v1.0";
    const result = validateUssV11Canonical(fixture);
    expect(result.ok).toBe(false);
    const schemaErr = result.errors.find((e) => e.field === "schema");
    expect(schemaErr).toBeDefined();
    expect(schemaErr!.message.toLowerCase()).toMatch(/constant|equal/);
  });

  it("rejects a wrong-typed required field (provenance.signalId as a number)", () => {
    const fixture = loadValidFixture();
    (fixture.provenance as Record<string, unknown>).signalId = 12345;
    const result = validateUssV11Canonical(fixture);
    expect(result.ok).toBe(false);
    const err = result.errors.find((e) => e.field === "provenance.signalId");
    expect(err).toBeDefined();
    expect(err!.message.toLowerCase()).toContain("string");
  });

  it("rejects a non-object top-level input with errors ALWAYS a non-empty array", () => {
    for (const input of [null, "not-an-object", []]) {
      const result = validateUssV11Canonical(input);
      expect(result.ok).toBe(false);
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.map((e) => e.field)).toContain("(root)");
    }
  });

  it("rejects a non-object provenance block", () => {
    const fixture = loadValidFixture();
    (fixture as Record<string, unknown>).provenance = "nope";
    const result = validateUssV11Canonical(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.field)).toContain("provenance");
  });

  it("is deterministic: identical input yields a deeply-equal result", () => {
    const a = validateUssV11Canonical(loadValidFixture());
    const b = validateUssV11Canonical(loadValidFixture());
    expect(a).toEqual(b);
  });
});

describe("DR-001 canonical validation is LIVE (structural validator would have accepted these)", () => {
  it("rejects a malformed provenance.ingestedAt date-time the old structural validator would have accepted", () => {
    const fixture = loadValidFixture();
    (fixture.provenance as Record<string, unknown>).ingestedAt = "not-a-date-time";
    // The replaced structural validator only checked schema const + provenance
    // string fields — this payload sails through those rules...
    expect(passesOldStructuralRules(fixture)).toBe(true);
    // ...but the canonical afi-config schema (format: date-time via ajv-formats)
    // rejects it. This proves canonical validation is live.
    const result = validateUssV11Canonical(fixture);
    expect(result.ok).toBe(false);
    const err = result.errors.find((e) => e.field === "provenance.ingestedAt");
    expect(err).toBeDefined();
    expect(err!.message.toLowerCase()).toContain("date-time");
  });

  it("rejects an invalid facts.direction enum value the old structural validator would have accepted", () => {
    const fixture = loadValidFixture();
    (fixture.facts as Record<string, unknown>).direction = "sideways";
    expect(passesOldStructuralRules(fixture)).toBe(true);
    const result = validateUssV11Canonical(fixture);
    expect(result.ok).toBe(false);
    const err = result.errors.find((e) => e.field === "facts.direction");
    expect(err).toBeDefined();
  });

  it("rejects an invalid provenance.providerType enum value the old structural validator would have accepted", () => {
    const fixture = loadValidFixture();
    (fixture.provenance as Record<string, unknown>).providerType = "carrier-pigeon";
    expect(passesOldStructuralRules(fixture)).toBe(true);
    const result = validateUssV11Canonical(fixture);
    expect(result.ok).toBe(false);
    const err = result.errors.find((e) => e.field === "provenance.providerType");
    expect(err).toBeDefined();
  });
});

describe("schemaValidationPipehead", () => {
  it("conforms to the validation pipehead shape", () => {
    expect(schemaValidationPipehead.id).toBe(SCHEMA_VALIDATION_PIPEHEAD_ID);
    expect(schemaValidationPipehead.kind).toBe("validation");
  });

  it("returns status 'ok' for the canonical valid fixture", async () => {
    const fixture = loadValidFixture();
    const result = await schemaValidationPipehead.execute(fixture, ctxFor(fixture));
    expect(result.status).toBe("ok");
    expect(result.output.ok).toBe(true);
    expect(result.output.errors).toEqual([]);
  });

  it("returns status 'failed' carrying structured errors for a malformed signal", async () => {
    const fixture = loadValidFixture();
    delete (fixture.provenance as Record<string, unknown>).signalId;
    const result = await schemaValidationPipehead.execute(fixture, ctxFor(fixture));
    expect(result.status).toBe("failed");
    expect(result.output.ok).toBe(false);
    expect(result.output.errors.length).toBeGreaterThan(0);
    expect(result.output.errors.map((e) => e.field)).toContain("provenance.signalId");
  });

  it("self-labels as CANONICAL (DR-001 resolved): non-provisional + canonical note", async () => {
    const fixture = loadValidFixture();
    const result = await schemaValidationPipehead.execute(fixture, ctxFor(fixture));
    expect(result.provisional).toBe(false);
    expect(result.notes).toBeDefined();
    const notes = (result.notes ?? []).join(" ").toLowerCase();
    expect(notes).toContain("canonical");
    expect(notes).toContain("dr-001 resolved");
    expect(notes).toContain("validateusignalv11");
    expect(notes).not.toContain("non-canonical");
    expect(notes).not.toContain("structural");
    expect(CANONICAL_VALIDATOR_NOTE.toLowerCase()).toContain("canonical");
  });

  it("output is deterministic across runs and unaffected by the clock timestamp", async () => {
    const fixture = loadValidFixture();
    const r1 = await schemaValidationPipehead.execute(
      fixture,
      ctxFor(fixture, "2025-01-01T00:00:00.000Z")
    );
    const r2 = await schemaValidationPipehead.execute(
      fixture,
      ctxFor(fixture, "2099-12-31T23:59:59.000Z")
    );
    expect(r1.output).toEqual(r2.output);
    expect(r1.status).toBe(r2.status);
    expect(r1.startedAt).not.toBe(r2.startedAt);
  });

  it("does not throw on malformed input (structured failure, not an exception)", async () => {
    const result = await schemaValidationPipehead.execute(null, ctxFor(null));
    expect(result.status).toBe("failed");
    expect(result.output.ok).toBe(false);
    expect(result.output.errors.length).toBeGreaterThan(0);
  });
});
