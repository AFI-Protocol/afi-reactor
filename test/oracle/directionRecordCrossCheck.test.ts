/**
 * DIR-GOV D-DIR-2(2) — the missing direction cross-check.
 *
 * Asserts, for every committed oracle golden, that the persisted record's
 * `scoredSignal.direction` equals the canonical USS `facts.direction` (the
 * governed contract: "aligned with USS v1.1 facts.direction",
 * afi-config scored-signal.schema.json) and that the HTTP response and the
 * evidence record agree about the same signal. The absence of exactly this
 * assertion is how the original defect shipped: the API said "short" while
 * the record said "neutral" in the same golden file.
 *
 * The check runs over the COMMITTED goldens rather than a live server spin-up
 * because the byte-equality suite (oracleGoldensEnriched.test.ts,
 * expectGolden) already pins the live oracle path byte-exactly to these
 * files; live path ≡ golden bytes, and golden bytes must satisfy this
 * invariant — so the live path does too. Within a single `oracle:regen`
 * invocation jest's parallel workers give no read-after-write ordering, so
 * this suite may fail spuriously mid-regen; the binding guard is the plain
 * re-run on committed bytes (`npm test` / CI), where a bad regeneration
 * cannot pass.
 *
 * Deliberately NOT anchored on test/evidence/provenance/fixtures/ — that
 * fixture pair predates the fix and is byte-frozen as a disclosed fossil
 * (DIR-GOV §1.6): its golden.json carries the defect-era neutral projection.
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const GOLDENS_DIR = join(__dirname, "goldens", "enriched");
const DIRECTIONS = ["long", "short", "neutral"] as const;

interface GoldenShape {
  canonicalUss: { facts: { direction: string } };
  evidenceRecord: { scoredSignal: { direction: string } };
  httpResponse: {
    meta?: { direction: string };
    pipelineResult?: { meta?: { direction: string } };
  };
}

const goldenFiles = readdirSync(GOLDENS_DIR).filter((f) => f.endsWith(".json"));

describe("direction cross-check (DIR-GOV D-DIR-2(2))", () => {
  it("finds the committed golden corpus", () => {
    // Guard against a vacuous pass if the goldens move or the dir empties.
    expect(goldenFiles.length).toBeGreaterThanOrEqual(12);
  });

  it.each(goldenFiles)("%s: record direction === USS facts.direction", (file) => {
    const golden = JSON.parse(
      readFileSync(join(GOLDENS_DIR, file), "utf8")
    ) as GoldenShape;

    const factsDirection = golden.canonicalUss.facts.direction;
    const recordDirection = golden.evidenceRecord.scoredSignal.direction;

    expect(DIRECTIONS).toContain(factsDirection);
    expect(recordDirection).toBe(factsDirection);

    // The HTTP response and the persisted record must agree about the same
    // signal (TV responses carry meta at top level; CPJ responses under
    // pipelineResult).
    const responseMeta =
      golden.httpResponse.meta ?? golden.httpResponse.pipelineResult?.meta;
    expect(responseMeta).toBeDefined();
    expect(responseMeta?.direction).toBe(recordDirection);
  });
});
