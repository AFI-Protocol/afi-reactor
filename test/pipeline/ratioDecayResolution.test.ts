/**
 * TDR-GOV D-TDR-1/D-TDR-3: the per-signal ratio decay-resolution law.
 *
 *  - the D-TDR-1(2) parsing law (normalize, then `^([1-9][0-9]*)(m|h|d|w|M)$`
 *    with minute multipliers) — acceptance and rejection vectors;
 *  - resolveDecayParamsForSignal arms: parsed ratio, declared-assumption,
 *    declared-nothing backstop, and the untouched template/inline passthrough;
 *  - the D-TDR-1(4) backstop VALUE pin: the code constant must equal the
 *    registered profile document's decaySurface.horizonSelection
 *    unknownOrMissing selection and its template's half-life (the profile is
 *    consumed at test time only — the live path never reads it).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTimeframeMinutes,
  resolveDecayParams,
  resolveDecayParamsForSignal,
  RATIO_DECAY_TEMPLATE_ID,
  UNKNOWN_TIMEFRAME_BACKSTOP,
  RuntimeConfigValidationError,
  type ResolvedStrategy,
} from "../../src/pipeline/registryLoader.js";

const RATIO_DECAY: ResolvedStrategy["decay"] = {
  kind: "ratio",
  barsPerHalfLife: 12,
  unknownTimeframeMinutes: 5,
};
const RATIO_DECAY_NO_UNKNOWN: ResolvedStrategy["decay"] = {
  kind: "ratio",
  barsPerHalfLife: 12,
};

describe("parseTimeframeMinutes (TDR-GOV D-TDR-1(2))", () => {
  it.each([
    ["5m", 5],
    ["15m", 15],
    ["45m", 45],
    ["90m", 90],
    ["1h", 60],
    ["4h", 240],
    ["1d", 1440],
    ["1w", 10080],
    ["1M", 43200],
    // Raw TradingView tokens resolve through normalization identically.
    ["5", 5],
    ["15", 15],
    ["60", 60],
    ["240", 240],
    ["D", 1440],
    ["W", 10080],
    ["M", 43200],
  ])("parses %s -> %d minutes", (tf, minutes) => {
    expect(parseTimeframeMinutes(tf)).toBe(minutes);
  });

  it.each([
    ["unknown"],
    [""],
    ["banana"],
    ["1D"], // mixed-case passthrough is NOT in the grammar's vocabulary
    ["0m"],
    ["07m"],
    ["-5m"],
    ["5 m"],
  ])("rejects %j (null -> assumption/backstop arm)", (tf) => {
    expect(parseTimeframeMinutes(tf)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(parseTimeframeMinutes(undefined)).toBeNull();
    expect(parseTimeframeMinutes(null)).toBeNull();
    expect(parseTimeframeMinutes(5)).toBeNull();
  });
});

describe("resolveDecayParamsForSignal (TDR-GOV D-TDR-3(2))", () => {
  it("derives the ratio surface from a parseable timeframe (timeframeAssumed false)", () => {
    expect(resolveDecayParamsForSignal(RATIO_DECAY, "5m")).toEqual({
      halfLifeMinutes: 60,
      greeksTemplateId: RATIO_DECAY_TEMPLATE_ID,
      barsPerHalfLife: 12,
      timeframeMinutes: 5,
      timeframeAssumed: false,
    });
    expect(resolveDecayParamsForSignal(RATIO_DECAY, "15m")).toEqual({
      halfLifeMinutes: 180,
      greeksTemplateId: RATIO_DECAY_TEMPLATE_ID,
      barsPerHalfLife: 12,
      timeframeMinutes: 15,
      timeframeAssumed: false,
    });
    expect(resolveDecayParamsForSignal(RATIO_DECAY, "4h")).toEqual({
      halfLifeMinutes: 2880,
      greeksTemplateId: RATIO_DECAY_TEMPLATE_ID,
      barsPerHalfLife: 12,
      timeframeMinutes: 240,
      timeframeAssumed: false,
    });
  });

  it("resolves unparseable timeframes through the declared assumption (timeframeAssumed true)", () => {
    for (const tf of ["unknown", "", undefined]) {
      expect(resolveDecayParamsForSignal(RATIO_DECAY, tf)).toEqual({
        halfLifeMinutes: 60,
        greeksTemplateId: RATIO_DECAY_TEMPLATE_ID,
        barsPerHalfLife: 12,
        timeframeMinutes: 5,
        timeframeAssumed: true,
      });
    }
  });

  it("falls to the profile's pinned unknownOrMissing value when nothing is declared (D-TDR-1(4))", () => {
    expect(resolveDecayParamsForSignal(RATIO_DECAY_NO_UNKNOWN, "unknown")).toEqual({
      greeksTemplateId: "decay-swing-v1",
      halfLifeMinutes: 720,
      timeframeAssumed: true,
    });
  });

  it("keeps the template arm boot-frozen and timeframe-blind (two-field stamp)", () => {
    const stamp = resolveDecayParamsForSignal(
      { kind: "template", templateId: "decay-intraday-v1" },
      "4h"
    );
    expect(stamp).toEqual({ halfLifeMinutes: 60, greeksTemplateId: "decay-intraday-v1" });
  });

  it("keeps the inline arm boot-frozen and timeframe-blind (two-field stamp)", () => {
    const stamp = resolveDecayParamsForSignal(
      { kind: "inline", config: { inline: { halfLifeMinutes: 240, greeksTemplateId: "decay-swing-v1" } } },
      "5m"
    );
    expect(stamp).toEqual({ halfLifeMinutes: 240, greeksTemplateId: "decay-swing-v1" });
  });

  it("resolveDecayParams refuses a ratio kind (per-signal only)", () => {
    expect(() => resolveDecayParams(RATIO_DECAY)).toThrow(RuntimeConfigValidationError);
  });
});

describe("UNKNOWN_TIMEFRAME_BACKSTOP value pin (TDR-GOV D-TDR-1(4))", () => {
  it("mirrors the registered profile's unknownOrMissing selection and its template half-life", () => {
    const profile = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "node_modules/afi-config/registries/uwr-profiles/uwr-weighted-lifts-v0.1.json"
        ),
        "utf-8"
      )
    ) as {
      decaySurface: {
        templates: Array<{ templateId: string; halfLifeMinutes: number }>;
        horizonSelection: Record<string, string>;
      };
    };
    const selected = profile.decaySurface.horizonSelection.unknownOrMissing;
    expect(UNKNOWN_TIMEFRAME_BACKSTOP.greeksTemplateId).toBe(selected);
    const template = profile.decaySurface.templates.find((t) => t.templateId === selected);
    expect(template).toBeDefined();
    expect(UNKNOWN_TIMEFRAME_BACKSTOP.halfLifeMinutes).toBe(template!.halfLifeMinutes);
  });
});
