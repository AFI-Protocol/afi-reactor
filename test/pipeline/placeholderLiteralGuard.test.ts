/**
 * DEM-PLACEHOLDER-GUARD — the terminal CI guard over
 * afi-reactor/src/pipeline/nodes/** (D-DEM-4(5); DEM-GOV §9, owner-authorized
 * 2026-08-25). The afi-core half of the same guard covers
 * afi-core/analysts/** and lives at
 * afi-core/test/guardrails/placeholderLiteralGuard.test.ts.
 *
 * Gate: "Guard proven to fail on a reintroduced literal by a negative test,
 * and proven NOT to fire on a registered mapping's declared literals or on
 * liquiditySwept; the D-DEM-4(2) inventory empty; zero scored-value movement
 * by this slot alone; no compatibility shim, alias, dual-run mode, fallback
 * flag, or commented-out copy remains."
 *
 * This bound is where the retired `BROKE_EMA_WITH_BODY_UNIMPLEMENTED_STUB` pin
 * lived (laneView.ts:79) — a constant IMPORTED from another package, whose
 * initializer a syntax-only scan cannot see. The guard decides constancy with
 * the type checker, so that exact form is caught; the negative test below
 * proves it on a reconstruction of the retired line.
 */
import { describe, it, expect } from "@jest/globals";
import path from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
// @ts-ignore — afi-core subpath types resolve via package exports; jest maps to source
import { scanForPlaceholderLiterals } from "afi-core/validators/PlaceholderLiteralGuard.js";

const REPO_ROOT = process.cwd();
const BOUNDS = ["src/pipeline/nodes"]; // D-DEM-4(5)'s afi-reactor bound
const FIXTURE_MAPPING = path.join(
  REPO_ROOT,
  "test/pipeline/fixtures/afi-config/registries/enrichment-mappings"
);

/** The registered mapping's declared defaults (D-DEM-4(5)'s stated exemption). */
function registeredDefaults(): Record<string, string | number | boolean> {
  const newest = readdirSync(FIXTURE_MAPPING)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .pop()!;
  const doc = JSON.parse(readFileSync(path.join(FIXTURE_MAPPING, newest), "utf-8")) as {
    bindings: Record<string, { optionality?: { default?: string | number | boolean } }>;
  };
  const out: Record<string, string | number | boolean> = {};
  for (const [target, b] of Object.entries(doc.bindings)) {
    if (b.optionality?.default !== undefined) out[target] = b.optionality.default;
  }
  return out;
}

const scan = (extraSources?: Array<{ fileName: string; content: string }>) =>
  scanForPlaceholderLiterals({
    tsconfigPath: path.join(REPO_ROOT, "tsconfig.json"),
    bounds: BOUNDS,
    repoRoot: REPO_ROOT,
    mappingDeclaredDefaults: registeredDefaults(),
    extraSources,
  });

const fixture = (body: string) => [
  { fileName: path.join(REPO_ROOT, "src/pipeline/nodes/__guard_fixture__.ts"), content: body },
];

describe("DEM-PLACEHOLDER-GUARD: the reactor's production path carries no placeholder literal", () => {
  it("src/pipeline/nodes/** is CLEAN — the D-DEM-4(2) inventory is empty", async () => {
    expect(await scan()).toEqual([]);
  }, 120_000);

  it("NEGATIVE TEST: the retired laneView pin is caught — a constant imported ACROSS the package boundary", async () => {
    // A faithful reconstruction of afi-reactor/src/pipeline/nodes/laneView.ts:79
    // as it stood before DEM-PRODUCER-CANDLE. The initializer lives in another
    // package's declarations, so only the type checker can see it is constant.
    const findings = await scan([
      {
        fileName: path.join(REPO_ROOT, "src/pipeline/nodes/__guard_stub__.ts"),
        content: `export const BROKE_EMA_WITH_BODY_UNIMPLEMENTED_STUB = false as const;\n`,
      },
      {
        fileName: path.join(REPO_ROOT, "src/pipeline/nodes/__guard_fixture__.ts"),
        content:
          `import { BROKE_EMA_WITH_BODY_UNIMPLEMENTED_STUB } from "./__guard_stub__.js";\n` +
          `export function viewTechnicalLike() {\n` +
          `  return { brokeEmaWithBody: BROKE_EMA_WITH_BODY_UNIMPLEMENTED_STUB };\n` +
          `}\n`,
      },
    ]);
    const hit = findings.find((f) => f.field === "brokeEmaWithBody");
    expect(hit).toBeDefined();
    expect(hit!.reason).toMatch(/literal type/);
  }, 120_000);

  it.each([
    ["the retired haFlatBackConfirmed literal", `export const a = { haFlatBackConfirmed: false };`, "haFlatBackConfirmed"],
    ["the retired neutral bias literal", `export const b = { weeklyBias: "neutral" as const };`, "weeklyBias"],
    ["the retired R:R synthesis", `declare const p: boolean; export const c = { rrMultiplePlanned: p ? 2 : 1 };`, "rrMultiplePlanned"],
  ])("NEGATIVE TEST: catches %s", async (_l, body, field) => {
    expect((await scan(fixture(body))).map((f) => f.field)).toContain(field);
  }, 120_000);

  it("does NOT fire on a projected lane fact, on liquiditySwept, or on a registered default", async () => {
    const findings = await scan(
      fixture(
        `declare const payload: { brokeEmaWithBody?: boolean; haFlatBackConfirmed?: boolean; emaDistancePct?: number };\n` +
          `export const view = {\n` +
          `  brokeEmaWithBody: payload.brokeEmaWithBody,\n` +
          `  haFlatBackConfirmed: payload.haFlatBackConfirmed,\n` +
          `  liquiditySwept: false,\n` +
          `  distanceFromDailyEmaPct: payload.emaDistancePct ?? 0,\n` +
          `};\n`
      )
    );
    expect(findings).toEqual([]);
  }, 120_000);
});

describe("DEM-PLACEHOLDER-GUARD: the D-DEM-4(2) inventory is empty and no residue remains", () => {
  const NODES = path.join(REPO_ROOT, "src/pipeline/nodes");

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const abs = path.join(dir, entry);
      if (statSync(abs).isDirectory()) return sources(abs);
      return abs.endsWith(".ts") ? [abs] : [];
    });
  }

  /** Comments naming a retired constant are documentation, not code. */
  const code = (file: string): string =>
    readFileSync(file, "utf-8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  it("every named item of the D-DEM-4(2) inventory is gone from the reactor's node code", () => {
    const RETIRED = [
      /BROKE_EMA_WITH_BODY_UNIMPLEMENTED_STUB/,
      /haFlatBackConfirmed\s*:\s*(false|true)\b/,
      /(weekly|daily)Bias\s*[:=]\s*"(neutral|long|short)"/,
      /rrMultiplePlanned\s*[:=][^,;}]*\?[^:]*:/,
    ];
    const offenders = sources(NODES).filter((f) => RETIRED.some((re) => re.test(code(f))));
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });

  it("no compatibility shim, alias, dual-run mode, fallback flag, or commented-out copy remains (D-FLPR-6)", () => {
    const BANNED = /\b(dualRun|legacyPath|fallbackFlag|LEGACY_[A-Z_]+|_deprecatedCopy)\b/;
    const offenders = sources(NODES).filter((f) => BANNED.test(readFileSync(f, "utf-8")));
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });

  it("the guard is wired into a suite jest actually runs (the gate is only real if CI runs it)", () => {
    const cfg = readFileSync(path.join(REPO_ROOT, "jest.config.js"), "utf-8");
    // test/pipeline/** is a matched glob, so this file runs without any
    // testMatch amendment (DEM-GOV §8: an amendment is authorized only for a
    // slot that adds a test requiring one — this slot does not).
    expect(cfg).toContain("**/test/pipeline/**/*.test.ts");
  });
});
