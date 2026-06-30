import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import type { PipeheadContext } from "../../src/pipeheads/types.js";
import { createFrozenClock } from "../../src/pipeheads/clock.js";
import {
  newsLane,
  runNewsLane,
  NEWS_LANE_ID,
  NEWS_LANE_PIPEHEAD_ID,
  NEWS_LANE_NOTE,
  DEFAULT_NEWS_FIXTURE,
} from "../../src/pipeheads/lanes/newsLane.js";
import {
  socialLane,
  runSocialLane,
  SOCIAL_LANE_ID,
  SOCIAL_LANE_PIPEHEAD_ID,
  SOCIAL_LANE_NOTE,
  DEFAULT_SOCIAL_FIXTURE,
} from "../../src/pipeheads/lanes/socialLane.js";
import {
  aimlLane,
  runAimlLane,
  AIML_LANE_ID,
  AIML_LANE_PIPEHEAD_ID,
  AIML_LANE_NOTE,
  DEFAULT_AIML_FIXTURE,
} from "../../src/pipeheads/lanes/aimlLane.js";

function ctx(iso?: string): PipeheadContext {
  return {
    signalId: "btc-usdt-perp-4h-0001",
    rawUss: {},
    clock: createFrozenClock(iso),
  };
}

function loadFixture(name: string): unknown {
  const p = join(process.cwd(), "test/pipeheads/fixtures/lanes", name);
  return JSON.parse(readFileSync(p, "utf-8"));
}

describe("news lane (PROVISIONAL fixture)", () => {
  it("VAL-LANES-005: lane 'news', provisional:true, defined payload", () => {
    const result = runNewsLane();
    expect(result.lane).toBe(NEWS_LANE_ID);
    expect(NEWS_LANE_ID).toBe("news");
    expect(result.provisional).toBe(true);
    expect(result.payload).toBeDefined();
  });

  it("VAL-LANES-012: result is self-labeled provisional independent of bundle list", () => {
    const result = runNewsLane();
    // in-payload provisional flag + human-readable note
    expect(result.payload.provisional).toBe(true);
    expect(typeof result.payload.note).toBe("string");
    expect(result.payload.note.length).toBeGreaterThan(0);
    const blob = JSON.stringify(result).toLowerCase();
    expect(blob).toContain("provisional");
    expect(blob).toContain("fixture");
  });

  it("payload matches the committed fixture JSON (no drift)", () => {
    expect(runNewsLane().payload).toEqual(loadFixture("news.json"));
    expect(DEFAULT_NEWS_FIXTURE).toEqual(loadFixture("news.json"));
  });

  it("payload is shaped to map onto enriched.news (headlines/shock fields)", () => {
    const p = runNewsLane().payload;
    expect(Array.isArray(p.headlines)).toBe(true);
    expect(typeof p.hasShockEvent).toBe("boolean");
  });

  it("is deterministic: two runs are deeply-equal and byte-identical", () => {
    const a = runNewsLane();
    const b = runNewsLane();
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not return a shared mutable reference to the default fixture", () => {
    const a = runNewsLane();
    (a.payload.headlines as string[]).push("MUTATION");
    expect(runNewsLane().payload).toEqual(loadFixture("news.json"));
  });

  it("is a well-formed AnalysisLaneResult", () => {
    const result = runNewsLane();
    expect(typeof result.lane).toBe("string");
    expect(typeof result.provisional).toBe("boolean");
    expect(result.payload).toBeDefined();
  });

  it("pipehead execute returns ok+provisional; clock does not affect payload", async () => {
    expect(newsLane.id).toBe(NEWS_LANE_PIPEHEAD_ID);
    expect(newsLane.kind).toBe("analysis-lane");
    expect(newsLane.lane).toBe(NEWS_LANE_ID);
    const r1 = await newsLane.execute(undefined, ctx("2025-01-01T00:00:00.000Z"));
    const r2 = await newsLane.execute(undefined, ctx("2099-12-31T23:59:59.000Z"));
    expect(r1.status).toBe("ok");
    expect(r1.provisional).toBe(true);
    expect(r1.output.lane).toBe(NEWS_LANE_ID);
    expect(r1.output).toEqual(r2.output);
    expect(r1.startedAt).not.toBe(r2.startedAt);
  });

  it("exposes a NOTE constant carried on the result notes", () => {
    expect(typeof NEWS_LANE_NOTE).toBe("string");
    expect((runNewsLane().notes ?? []).join(" ")).toBe(NEWS_LANE_NOTE);
  });
});

describe("social lane (PROVISIONAL fixture -> enriched.sentiment)", () => {
  it("VAL-LANES-006: lane 'social', provisional:true, defined payload", () => {
    const result = runSocialLane();
    expect(result.lane).toBe(SOCIAL_LANE_ID);
    expect(SOCIAL_LANE_ID).toBe("social");
    expect(result.provisional).toBe(true);
    expect(result.payload).toBeDefined();
  });

  it("VAL-LANES-012: result is self-labeled provisional independent of bundle list", () => {
    const result = runSocialLane();
    expect(result.payload.provisional).toBe(true);
    expect(typeof result.payload.note).toBe("string");
    expect(result.payload.note.length).toBeGreaterThan(0);
  });

  it("VAL-BUNDLE-004 support: payload carries sentiment-shaped score+tags", () => {
    const p = runSocialLane().payload;
    expect(typeof p.score).toBe("number");
    expect(Number.isFinite(p.score)).toBe(true);
    expect(Array.isArray(p.tags)).toBe(true);
    for (const t of p.tags) expect(typeof t).toBe("string");
  });

  it("payload matches the committed fixture JSON (no drift)", () => {
    expect(runSocialLane().payload).toEqual(loadFixture("social.json"));
    expect(DEFAULT_SOCIAL_FIXTURE).toEqual(loadFixture("social.json"));
  });

  it("is deterministic: two runs are deeply-equal and byte-identical", () => {
    const a = runSocialLane();
    const b = runSocialLane();
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not return a shared mutable reference to the default fixture", () => {
    const a = runSocialLane();
    (a.payload.tags as string[]).push("MUTATION");
    expect(runSocialLane().payload).toEqual(loadFixture("social.json"));
  });

  it("pipehead execute returns ok+provisional; clock does not affect payload", async () => {
    expect(socialLane.id).toBe(SOCIAL_LANE_PIPEHEAD_ID);
    expect(socialLane.lane).toBe(SOCIAL_LANE_ID);
    const r1 = await socialLane.execute(undefined, ctx("2025-01-01T00:00:00.000Z"));
    const r2 = await socialLane.execute(undefined, ctx("2099-12-31T23:59:59.000Z"));
    expect(r1.status).toBe("ok");
    expect(r1.provisional).toBe(true);
    expect(r1.output.lane).toBe(SOCIAL_LANE_ID);
    expect(r1.output).toEqual(r2.output);
    expect(r1.startedAt).not.toBe(r2.startedAt);
  });

  it("exposes a NOTE constant carried on the result notes", () => {
    expect((runSocialLane().notes ?? []).join(" ")).toBe(SOCIAL_LANE_NOTE);
  });
});

describe("ai-ml lane (PROVISIONAL fixture, no network/Tiny Brains)", () => {
  it("VAL-LANES-007: lane 'ai-ml', provisional:true, defined payload", () => {
    const result = runAimlLane();
    expect(result.lane).toBe(AIML_LANE_ID);
    expect(AIML_LANE_ID).toBe("ai-ml");
    expect(result.provisional).toBe(true);
    expect(result.payload).toBeDefined();
  });

  it("VAL-LANES-012: result is self-labeled provisional independent of bundle list", () => {
    const result = runAimlLane();
    expect(result.payload.provisional).toBe(true);
    expect(typeof result.payload.note).toBe("string");
    expect(result.payload.note.length).toBeGreaterThan(0);
    const blob = JSON.stringify(result).toLowerCase();
    expect(blob).toContain("no network");
  });

  it("payload is shaped to map onto enriched.aiMl (FroggyAiMlV1 fields)", () => {
    const p = runAimlLane().payload;
    expect(typeof p.convictionScore).toBe("number");
    expect(["long", "short", "neutral"]).toContain(p.direction);
  });

  it("payload matches the committed fixture JSON (no drift)", () => {
    expect(runAimlLane().payload).toEqual(loadFixture("aiml.json"));
    expect(DEFAULT_AIML_FIXTURE).toEqual(loadFixture("aiml.json"));
  });

  it("is deterministic: two runs are deeply-equal and byte-identical", () => {
    const a = runAimlLane();
    const b = runAimlLane();
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("pipehead execute returns ok+provisional; clock does not affect payload", async () => {
    expect(aimlLane.id).toBe(AIML_LANE_PIPEHEAD_ID);
    expect(aimlLane.lane).toBe(AIML_LANE_ID);
    const r1 = await aimlLane.execute(undefined, ctx("2025-01-01T00:00:00.000Z"));
    const r2 = await aimlLane.execute(undefined, ctx("2099-12-31T23:59:59.000Z"));
    expect(r1.status).toBe("ok");
    expect(r1.provisional).toBe(true);
    expect(r1.output.lane).toBe(AIML_LANE_ID);
    expect(r1.output).toEqual(r2.output);
    expect(r1.startedAt).not.toBe(r2.startedAt);
  });

  it("exposes a NOTE constant carried on the result notes", () => {
    expect((runAimlLane().notes ?? []).join(" ")).toBe(AIML_LANE_NOTE);
  });
});

describe("offline discipline: provisional lanes import no external dependency", () => {
  const laneFiles = [
    "src/pipeheads/lanes/newsLane.ts",
    "src/pipeheads/lanes/socialLane.ts",
    "src/pipeheads/lanes/aimlLane.ts",
  ];

  it("source scan finds no network / Tiny Brains / external adapter imports", () => {
    for (const rel of laneFiles) {
      const src = readFileSync(join(process.cwd(), rel), "utf-8");
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      // every import in these lanes must be a relative pipehead import (./ or ../)
      const importLines = code
        .split("\n")
        .filter((l) => /\bfrom\s+["']/.test(l));
      for (const line of importLines) {
        const m = line.match(/from\s+["']([^"']+)["']/);
        expect(m).not.toBeNull();
        const spec = m![1];
        expect(spec.startsWith("./") || spec.startsWith("../")).toBe(true);
      }
      // explicit forbidden tokens
      expect(code).not.toMatch(/from\s+["'][^"']*(fetch|axios|node-fetch|undici|ws|http|https)["']/);
      expect(code).not.toMatch(/TinyBrains|tiny-brains|MLProviderRegistry/);
      expect(code).not.toMatch(/from\s+["'][^"']*adapters\//);
    }
  });

  it("all three lanes load and run at runtime (offline)", () => {
    expect(() => runNewsLane()).not.toThrow();
    expect(() => runSocialLane()).not.toThrow();
    expect(() => runAimlLane()).not.toThrow();
  });
});
