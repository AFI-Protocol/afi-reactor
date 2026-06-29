import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import {
  schemaValidationPipehead,
  validateUssV11Structural,
  SCHEMA_VALIDATION_PIPEHEAD_ID,
  STRUCTURAL_VALIDATOR_NOTE,
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

describe("validateUssV11Structural", () => {
  it("accepts the canonical valid fixture with no errors", () => {
    const result = validateUssV11Structural(loadValidFixture());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a missing required provenance field (provenance.signalId)", () => {
    const fixture = loadValidFixture();
    delete (fixture.provenance as Record<string, unknown>).signalId;
    const result = validateUssV11Structural(fixture);
    expect(result.ok).toBe(false);
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

  it("rejects a missing required top-level block (provenance)", () => {
    const fixture = loadValidFixture();
    delete (fixture as Record<string, unknown>).provenance;
    const result = validateUssV11Structural(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.field)).toContain("provenance");
  });

  it("rejects a missing required top-level block (schema)", () => {
    const fixture = loadValidFixture();
    delete (fixture as Record<string, unknown>).schema;
    const result = validateUssV11Structural(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.field)).toContain("schema");
  });

  it("rejects a wrong schema id with a const-mismatch message", () => {
    const fixture = loadValidFixture();
    (fixture as Record<string, unknown>).schema = "afi.usignal.v1.0";
    const result = validateUssV11Structural(fixture);
    expect(result.ok).toBe(false);
    const schemaErr = result.errors.find((e) => e.field === "schema");
    expect(schemaErr).toBeDefined();
    expect(schemaErr!.message).toContain("afi.usignal.v1.1");
  });

  it("rejects a wrong-typed required field (provenance.signalId as a number)", () => {
    const fixture = loadValidFixture();
    (fixture.provenance as Record<string, unknown>).signalId = 12345;
    const result = validateUssV11Structural(fixture);
    expect(result.ok).toBe(false);
    const err = result.errors.find((e) => e.field === "provenance.signalId");
    expect(err).toBeDefined();
    expect(err!.message.toLowerCase()).toContain("string");
  });

  it("rejects a non-object top-level input", () => {
    expect(validateUssV11Structural(null).ok).toBe(false);
    expect(validateUssV11Structural("not-an-object").ok).toBe(false);
    expect(validateUssV11Structural([]).ok).toBe(false);
  });

  it("rejects a non-object provenance block", () => {
    const fixture = loadValidFixture();
    (fixture as Record<string, unknown>).provenance = "nope";
    const result = validateUssV11Structural(fixture);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.field)).toContain("provenance");
  });

  it("is deterministic: identical input yields a deeply-equal result", () => {
    const a = validateUssV11Structural(loadValidFixture());
    const b = validateUssV11Structural(loadValidFixture());
    expect(a).toEqual(b);
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

  it("self-labels as structural / demo-only / non-canonical (provisional + note)", async () => {
    const fixture = loadValidFixture();
    const result = await schemaValidationPipehead.execute(fixture, ctxFor(fixture));
    expect(result.provisional).toBe(true);
    expect(result.notes).toBeDefined();
    const notes = (result.notes ?? []).join(" ").toLowerCase();
    expect(notes).toContain("structural");
    expect(notes).toMatch(/demo-only|poc/);
    expect(notes).toContain("non-canonical");
    expect(notes).toContain("canonical uss validation");
    expect(STRUCTURAL_VALIDATOR_NOTE.toLowerCase()).toContain("structural");
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
