/**
 * DLC-GOV DLC-APPLY: the read-side decay derivation (D-DLC-3).
 *
 * Gate clauses proven here:
 * - the production derivation reproduces the governed 32-vector
 *   apply-time-decay KAT VALUE-EXACTLY (Object.is — the KAT's
 *   exactnessRule grid is exact in IEEE-754 binary64);
 * - fail-closed: no stamped decayParams (or a malformed stamp or
 *   timestamp) yields NO derivation — no default half-life, no unit
 *   guess (D-DLC-3(2));
 * - the block is labeled derived and the sealed score is untouched.
 */
import { describe, it, expect } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildDerivedDecayBlock } from "../../src/services/decayDerivation.js";

const REPO_ROOT = process.cwd();
const GOVERNED_KAT = path.resolve(
  REPO_ROOT,
  "node_modules/afi-config/kats/uwr-profile/v0/apply-time-decay.kat.json"
);

function scoredFixture(overrides: Record<string, unknown> = {}) {
  return {
    analystScore: { uwrScore: 0.75 } as any,
    scoredAt: "2026-08-24T00:00:00.000Z",
    decayParams: {
      halfLifeMinutes: 720,
      greeksTemplateId: "decay-swing-v1",
      barsPerHalfLife: 12,
      timeframeMinutes: 60,
    },
    ...overrides,
  } as any;
}

describe("D-DLC-3: read-side derived decay", () => {
  it("derives at elapsed 0 with decayedScore equal to the sealed score, labeled derived", () => {
    const at = "2026-08-24T00:00:00.000Z";
    const block = buildDerivedDecayBlock(scoredFixture({ scoredAt: at }), at)!;
    expect(block.derived).toBe(true);
    expect(block.law).toBe("decayed = sealedScore * 0.5^(elapsedMinutes / halfLifeMinutes)");
    expect(block.sealedScore).toBe(0.75);
    expect(block.decayedScore).toBe(0.75);
    expect(block.elapsedMinutes).toBe(0);
    expect(block.halfLifeMinutes).toBe(720);
    expect(block.greeksTemplateId).toBe("decay-swing-v1");
    expect(block.scoredAt).toBe(at);
    expect(block.asOf).toBe(at);
  });

  it("halves the derived value at exactly one half-life; the sealed score never moves", () => {
    const block = buildDerivedDecayBlock(
      scoredFixture(),
      "2026-08-24T12:00:00.000Z" // 720 minutes later
    )!;
    expect(block.decayedScore).toBe(0.375);
    expect(block.sealedScore).toBe(0.75);
    expect(block.elapsedMinutes).toBe(720);
  });

  it("a future-dated scoredAt derives as elapsed 0, never a negative age", () => {
    const block = buildDerivedDecayBlock(
      scoredFixture({ scoredAt: "2026-08-24T02:00:00.000Z" }),
      "2026-08-24T01:00:00.000Z"
    )!;
    expect(block.elapsedMinutes).toBe(0);
    expect(block.decayedScore).toBe(0.75);
  });

  describe("fail-closed (D-DLC-3(2)): no stamp, no derivation — no default, no unit guess", () => {
    it("null decayParams → undefined", () => {
      expect(buildDerivedDecayBlock(scoredFixture({ decayParams: null }))).toBeUndefined();
    });
    it("missing decayParams → undefined", () => {
      expect(buildDerivedDecayBlock(scoredFixture({ decayParams: undefined }))).toBeUndefined();
    });
    it("non-positive halfLifeMinutes → undefined", () => {
      for (const halfLifeMinutes of [0, -5, NaN, Infinity]) {
        expect(
          buildDerivedDecayBlock(
            scoredFixture({
              decayParams: { halfLifeMinutes, greeksTemplateId: "decay-swing-v1" },
            })
          )
        ).toBeUndefined();
      }
    });
    it("missing greeksTemplateId → undefined (the stamp is self-describing or absent)", () => {
      expect(
        buildDerivedDecayBlock(scoredFixture({ decayParams: { halfLifeMinutes: 720 } }))
      ).toBeUndefined();
    });
    it("non-finite sealed score → undefined", () => {
      expect(
        buildDerivedDecayBlock(scoredFixture({ analystScore: { uwrScore: NaN } }))
      ).toBeUndefined();
    });
    it("unparseable scoredAt → undefined", () => {
      expect(
        buildDerivedDecayBlock(scoredFixture({ scoredAt: "not-a-timestamp" }))
      ).toBeUndefined();
    });
  });

  const skipIfNoKat = existsSync(GOVERNED_KAT) ? describe : describe.skip;
  skipIfNoKat("the governed 32-vector KAT, reproduced value-exactly by the serving-path derivation", () => {
    const kat = JSON.parse(readFileSync(GOVERNED_KAT, "utf-8")) as {
      vectors: Array<{
        vectorId: string;
        templateId: string;
        halfLifeMinutes: number;
        baseScore: number;
        elapsedMinutes: number;
        expected: { decayedScore: number };
      }>;
    };

    it("carries exactly the 32 governed vectors", () => {
      expect(kat.vectors).toHaveLength(32);
    });

    it("every vector reproduces bit-exactly (Object.is) through buildDerivedDecayBlock", () => {
      const epoch = "2026-01-01T00:00:00.000Z";
      const epochMs = Date.parse(epoch);
      for (const v of kat.vectors) {
        const nowIso = new Date(epochMs + v.elapsedMinutes * 60_000).toISOString();
        const block = buildDerivedDecayBlock(
          {
            analystScore: { uwrScore: v.baseScore } as any,
            scoredAt: epoch,
            decayParams: {
              halfLifeMinutes: v.halfLifeMinutes,
              greeksTemplateId: v.templateId,
            },
          } as any,
          nowIso
        );
        if (!block) {
          throw new Error(`${v.vectorId}: derivation refused a governed vector`);
        }
        if (!Object.is(block.decayedScore, v.expected.decayedScore)) {
          throw new Error(
            `${v.vectorId}: ${block.decayedScore} !== ${v.expected.decayedScore} (bit-exact)`
          );
        }
        expect(block.elapsedMinutes).toBe(v.elapsedMinutes);
      }
    });
  });
});
