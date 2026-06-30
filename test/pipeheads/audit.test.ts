/**
 * Tests for the audit pipehead (m2-audit-pipehead-hashing), covering
 * VAL-AUDIT-001..010. The audit pipehead emits a content-hashed
 * {@link AuditRecord} (architecture.md §4) whose `inputHash`/`bundleHash`/
 * `outputHash` are canonical sha256 digests with runtime timestamps excluded,
 * and whose `outputHash` commits the deterministic scoring PROJECTION (never
 * the raw timestamped scored object).
 *
 * Determinism is anchored to the committed golden fixture
 * `test/pipeheads/fixtures/golden.json`. The canonical bundle is recomputed
 * here under Jest WITHOUT the afi-core scorer (the wired lanes + fan-out +
 * normalize are pure and offline); the scoring projection is reconstructed
 * from the golden scored fields (the real-scorer numbers are pinned by
 * VAL-SCORING-008 and exercised end-to-end by the ts-node ESM driver / CLI).
 */

import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import type { AfiCandle } from "../../src/types/AfiCandle.js";
import type {
  AnalysisBundle,
  DemoScoredSignal,
  PipeheadContext,
} from "../../src/pipeheads/types.js";
import { createFrozenClock, FROZEN_CLOCK_ISO } from "../../src/pipeheads/clock.js";
import {
  canonicalHash,
  buildScoringProjection,
} from "../../src/pipeheads/canonicalHash.js";
import { fanOut } from "../../src/pipeheads/fanOut.js";
import { normalizeToBundle } from "../../src/pipeheads/normalizePipehead.js";
import {
  buildAuditRecord,
  createAuditPipehead,
  auditPipehead,
  AUDIT_PIPEHEAD_ID,
  type AuditPipeheadInput,
} from "../../src/pipeheads/auditPipehead.js";

const HEX_64 = /^[0-9a-f]{64}$/;
const SIGNAL_ID = "btc-usdt-perp-4h-0001";

type UwrAxes = DemoScoredSignal["uwrAxes"];

interface Golden {
  analystId: string;
  strategyId: string;
  uwrScore: number;
  uwrAxes: UwrAxes;
  direction: unknown;
  riskBucket: unknown;
  conviction: unknown;
  inputHash: string;
  bundleHash: string;
  outputHash: string;
}

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), rel), "utf-8")) as T;
}

function loadGolden(): Golden {
  return loadJson<Golden>("test/pipeheads/fixtures/golden.json");
}

function loadRawUss(): Record<string, unknown> {
  return loadJson<Record<string, unknown>>("test/pipeheads/fixtures/signal.uss.json");
}

function loadOhlcv(): AfiCandle[] {
  return loadJson<AfiCandle[]>("test/pipeheads/fixtures/ohlcv.json");
}

function ctx(rawUss: unknown = loadRawUss(), iso?: string): PipeheadContext {
  return { signalId: SIGNAL_ID, rawUss, clock: createFrozenClock(iso) };
}

async function buildBundle(
  rawUss: Record<string, unknown> = loadRawUss(),
  candles: AfiCandle[] = loadOhlcv()
): Promise<AnalysisBundle> {
  const results = await fanOut({ candles }, ctx(rawUss));
  return normalizeToBundle(results, rawUss);
}

/**
 * Reconstruct a DemoScoredSignal from the committed golden scoring fields so
 * the projection (and thus `outputHash`) can be recomputed under Jest without
 * loading the afi-core value subpath. `scoredAt` is a runtime timestamp.
 */
function scoredFromGolden(g: Golden = loadGolden(), scoredAt: string = FROZEN_CLOCK_ISO): DemoScoredSignal {
  return {
    signalId: SIGNAL_ID,
    uwrScore: g.uwrScore,
    uwrAxes: g.uwrAxes,
    analystScore: {
      analystId: g.analystId,
      strategyId: g.strategyId,
      direction: g.direction,
      riskBucket: g.riskBucket,
      conviction: g.conviction,
      uwrScore: g.uwrScore,
      uwrAxes: g.uwrAxes,
      scoredAt,
    },
    provisional: true,
    demoOnly: true,
    scoredAt,
  };
}

/** Recursively rebuild an object with its keys in reverse-sorted order. */
function shuffleKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => shuffleKeys(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort().reverse()) {
      out[key] = shuffleKeys(src[key]);
    }
    return out as unknown as T;
  }
  return value;
}

describe("audit pipehead — AuditRecord shape & labels (VAL-AUDIT-001..004)", () => {
  it("VAL-AUDIT-001: algo is exactly 'sha256'", async () => {
    const audit = buildAuditRecord(loadRawUss(), await buildBundle(), scoredFromGolden());
    expect(audit.algo).toBe("sha256");
  });

  it("VAL-AUDIT-002: inputHash/bundleHash/outputHash are 64-char lowercase hex", async () => {
    const audit = buildAuditRecord(loadRawUss(), await buildBundle(), scoredFromGolden());
    expect(audit.inputHash).toMatch(HEX_64);
    expect(audit.bundleHash).toMatch(HEX_64);
    expect(audit.outputHash).toMatch(HEX_64);
  });

  it("VAL-AUDIT-003: echoes uwrScore, uwrAxes and provisionalLanes from scored/bundle", async () => {
    const bundle = await buildBundle();
    const scored = scoredFromGolden();
    const audit = buildAuditRecord(loadRawUss(), bundle, scored);
    expect(audit.uwrScore).toBe(scored.uwrScore);
    expect(audit.uwrAxes).toEqual(scored.uwrAxes);
    expect(audit.provisionalLanes).toEqual(bundle.provisionalLanes);
    expect(audit.provisionalLanes).toEqual(["news", "social", "ai-ml"]);
    expect(audit.signalId).toBe(SIGNAL_ID);
  });

  it("VAL-AUDIT-004: labeled demoOnly:true and scoredAtExcluded:true", async () => {
    const audit = buildAuditRecord(loadRawUss(), await buildBundle(), scoredFromGolden());
    expect(audit.demoOnly).toBe(true);
    expect(audit.scoredAtExcluded).toBe(true);
  });

  it("inputHash equals the bundle.provenance.inputHash (same validated input)", async () => {
    const bundle = await buildBundle();
    const audit = buildAuditRecord(loadRawUss(), bundle, scoredFromGolden());
    expect(audit.inputHash).toBe(bundle.provenance?.inputHash);
  });
});

describe("audit pipehead — replay determinism (VAL-AUDIT-005..008)", () => {
  it("VAL-AUDIT-005 (case a): same fixture twice yields byte-identical hashes", async () => {
    const a = buildAuditRecord(loadRawUss(), await buildBundle(), scoredFromGolden());
    const b = buildAuditRecord(loadRawUss(), await buildBundle(), scoredFromGolden());
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.bundleHash).toBe(b.bundleHash);
    expect(a.outputHash).toBe(b.outputHash);
  });

  it("VAL-AUDIT-006 (case b): recomputed hashes equal the committed golden fixture", async () => {
    const golden = loadGolden();
    const audit = buildAuditRecord(loadRawUss(), await buildBundle(), scoredFromGolden(golden));
    expect(audit.inputHash).toBe(golden.inputHash);
    expect(audit.bundleHash).toBe(golden.bundleHash);
    expect(audit.outputHash).toBe(golden.outputHash);
  });

  it("VAL-AUDIT-007 (case c): changing only a runtime timestamp does NOT change any hash", async () => {
    const bundle = await buildBundle();
    const frozen = buildAuditRecord(loadRawUss(), bundle, scoredFromGolden(loadGolden(), FROZEN_CLOCK_ISO));
    const future = buildAuditRecord(
      loadRawUss(),
      bundle,
      scoredFromGolden(loadGolden(), "2099-12-31T23:59:59.000Z")
    );
    // human-facing scoredAt differs ...
    expect((frozen as unknown as { scoredAt?: string }).scoredAt).toBeUndefined();
    expect(future.inputHash).toBe(frozen.inputHash);
    expect(future.bundleHash).toBe(frozen.bundleHash);
    expect(future.outputHash).toBe(frozen.outputHash);
  });

  it("VAL-AUDIT-008 (case d): canonical hashing is key-order independent", async () => {
    const golden = loadGolden();
    const rawUss = loadRawUss();
    const bundle = await buildBundle();
    const audit = buildAuditRecord(
      shuffleKeys(rawUss),
      shuffleKeys(bundle),
      shuffleKeys(scoredFromGolden(golden))
    );
    expect(audit.inputHash).toBe(golden.inputHash);
    expect(audit.bundleHash).toBe(golden.bundleHash);
    expect(audit.outputHash).toBe(golden.outputHash);
  });
});

describe("audit pipehead — outputHash projection & sensitivity (VAL-AUDIT-009/010)", () => {
  it("VAL-AUDIT-009: outputHash commits the projection, invariant to analystScore.scoredAt", async () => {
    const bundle = await buildBundle();
    const base = scoredFromGolden();
    const onlyTimestampChanged: DemoScoredSignal = {
      ...base,
      scoredAt: "2099-12-31T23:59:59.000Z",
      analystScore: {
        ...(base.analystScore as Record<string, unknown>),
        scoredAt: "2099-12-31T23:59:59.000Z",
      },
    };
    const a = buildAuditRecord(loadRawUss(), bundle, base);
    const b = buildAuditRecord(loadRawUss(), bundle, onlyTimestampChanged);
    expect(b.outputHash).toBe(a.outputHash);
  });

  it("VAL-AUDIT-009: outputHash is sensitive to a projected field (conviction)", async () => {
    const bundle = await buildBundle();
    const base = scoredFromGolden();
    const projectionChanged: DemoScoredSignal = {
      ...base,
      analystScore: {
        ...(base.analystScore as Record<string, unknown>),
        conviction: 0.123456,
      },
    };
    const a = buildAuditRecord(loadRawUss(), bundle, base);
    const b = buildAuditRecord(loadRawUss(), bundle, projectionChanged);
    expect(b.outputHash).not.toBe(a.outputHash);
  });

  it("VAL-AUDIT-010: outputHash changes when a substantive scored value changes", async () => {
    const bundle = await buildBundle();
    const base = scoredFromGolden();
    const changed: DemoScoredSignal = { ...base, uwrScore: base.uwrScore + 0.1 };
    expect(buildAuditRecord(loadRawUss(), bundle, changed).outputHash).not.toBe(
      buildAuditRecord(loadRawUss(), bundle, base).outputHash
    );
  });

  it("VAL-AUDIT-010: inputHash changes when the rawUss input changes (and bundleHash/outputHash do not leak it)", async () => {
    const bundle = await buildBundle();
    const scored = scoredFromGolden();
    const rawUss = loadRawUss();
    const mutated = { ...rawUss, facts: { ...(rawUss.facts as object), symbol: "ETH/USDT" } };
    const a = buildAuditRecord(rawUss, bundle, scored);
    const b = buildAuditRecord(mutated, bundle, scored);
    expect(b.inputHash).not.toBe(a.inputHash);
    // bundle/output domains are unaffected by the rawUss-only change
    expect(b.bundleHash).toBe(a.bundleHash);
    expect(b.outputHash).toBe(a.outputHash);
  });

  it("VAL-AUDIT-010: bundleHash changes when a bundle lane payload changes", async () => {
    const bundle = await buildBundle();
    const scored = scoredFromGolden();
    const mutatedBundle: AnalysisBundle = {
      ...bundle,
      lanes: {
        ...bundle.lanes,
        social: {
          ...bundle.lanes.social,
          payload: { score: 0.999, tags: ["mutated"] },
        },
      },
    };
    const a = buildAuditRecord(loadRawUss(), bundle, scored);
    const b = buildAuditRecord(loadRawUss(), mutatedBundle, scored);
    expect(b.bundleHash).not.toBe(a.bundleHash);
    // input/output domains unaffected by the bundle-only change
    expect(b.inputHash).toBe(a.inputHash);
    expect(b.outputHash).toBe(a.outputHash);
  });

  it("outputHash equals the canonical hash of the explicit scoring projection", async () => {
    const scored = scoredFromGolden();
    const audit = buildAuditRecord(loadRawUss(), await buildBundle(), scored);
    expect(audit.outputHash).toBe(canonicalHash(buildScoringProjection(scored)));
  });
});

describe("audit pipehead — pipehead wrapper", () => {
  it("execute() returns an ok audit result and reads rawUss from ctx", async () => {
    const bundle = await buildBundle();
    const scored = scoredFromGolden();
    const input: AuditPipeheadInput = { bundle, scored };
    const res = await createAuditPipehead().execute(input, ctx());
    expect(res.pipeheadId).toBe(AUDIT_PIPEHEAD_ID);
    expect(res.kind).toBe("audit");
    expect(res.status).toBe("ok");
    expect(res.output.algo).toBe("sha256");
    expect(res.output.inputHash).toBe(canonicalHash(loadRawUss()));
    expect(res.output.bundleHash).toBe(canonicalHash(bundle));
  });

  it("execute() is deterministic across different injected clocks", async () => {
    const bundle = await buildBundle();
    const scored = scoredFromGolden();
    const input: AuditPipeheadInput = { bundle, scored };
    const a = await createAuditPipehead().execute(input, ctx(loadRawUss(), "2025-01-01T00:00:00.000Z"));
    const b = await createAuditPipehead().execute(input, ctx(loadRawUss(), "2099-12-31T23:59:59.000Z"));
    expect(a.output).toEqual(b.output);
  });

  it("the default auditPipehead is an audit pipehead", () => {
    expect(auditPipehead.id).toBe(AUDIT_PIPEHEAD_ID);
    expect(auditPipehead.kind).toBe("audit");
  });
});
