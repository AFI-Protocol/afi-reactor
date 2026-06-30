/**
 * Tests for the reputation receipt pipehead (m2-reputation-receipt), covering
 * VAL-RECEIPT-001..006. The receipt is a demo-only, receipt-like output: it
 * ECHOES the deterministic afi-core score and the bundle's provisional lanes,
 * carries `mutatesReputationState:false` (invariant) plus a human-readable
 * non-canonical/non-mutation note, and NEVER reads or mutates reputation
 * state, a DB, or a vault.
 *
 * Determinism: the only timestamp on the output (`issuedAt`) comes from
 * `ctx.clock()` and is EXCLUDED from every content hash (see canonicalHash.ts).
 */

import { describe, it, expect } from "@jest/globals";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  AnalysisLaneId,
  DemoReputationReceipt,
  DemoScoredSignal,
  PipeheadContext,
} from "../../src/pipeheads/types.js";
import { createFrozenClock } from "../../src/pipeheads/clock.js";
import { canonicalHash } from "../../src/pipeheads/canonicalHash.js";
import {
  buildReputationReceipt,
  createReputationReceiptPipehead,
  reputationReceiptPipehead,
  REPUTATION_RECEIPT_PIPEHEAD_ID,
  REPUTATION_RECEIPT_NOTE,
  type ReputationReceiptInput,
} from "../../src/pipeheads/reputationReceipt.js";

const SIGNAL_ID = "btc-usdt-perp-4h-0001";
const PROVISIONAL_LANES: AnalysisLaneId[] = ["news", "social", "ai-ml"];

function makeScored(uwrScore = 0.1875): DemoScoredSignal {
  return {
    signalId: SIGNAL_ID,
    uwrScore,
    uwrAxes: { structure: 0.15, execution: 0, risk: 0.2, insight: 0.4 },
    analystScore: {
      analystId: "froggy",
      strategyId: "trend_pullback_v1",
      uwrScore,
      uwrAxes: { structure: 0.15, execution: 0, risk: 0.2, insight: 0.4 },
      scoredAt: "2024-06-01T12:34:56.789Z",
    },
    provisional: true,
    demoOnly: true,
    scoredAt: "2025-01-01T00:00:00.000Z",
  };
}

function makeInput(
  scored: DemoScoredSignal = makeScored(),
  provisionalLanes: AnalysisLaneId[] = PROVISIONAL_LANES
): ReputationReceiptInput {
  return { scored, provisionalLanes };
}

function ctx(iso?: string): PipeheadContext {
  return { signalId: SIGNAL_ID, rawUss: {}, clock: createFrozenClock(iso) };
}

describe("reputation receipt — DemoReputationReceipt shape (VAL-RECEIPT-001/002/006)", () => {
  it("VAL-RECEIPT-001: emits a receipt with receiptKind 'demo-only'", () => {
    const receipt = buildReputationReceipt(makeScored(), PROVISIONAL_LANES, "2025-01-01T00:00:00.000Z");
    expect(receipt.receiptKind).toBe("demo-only");
  });

  it("VAL-RECEIPT-002: carries mutatesReputationState:false and a non-empty non-mutation note", () => {
    const receipt = buildReputationReceipt(makeScored(), PROVISIONAL_LANES, "2025-01-01T00:00:00.000Z");
    expect(receipt.mutatesReputationState).toBe(false);
    expect(typeof receipt.note).toBe("string");
    expect(receipt.note.length).toBeGreaterThan(0);
    expect(receipt.note.toLowerCase()).toMatch(/mutat|state/);
  });

  it("VAL-RECEIPT-006: is never canonical — note conveys non-canonical and no truthy canonical field exists", () => {
    const receipt = buildReputationReceipt(makeScored(), PROVISIONAL_LANES, "2025-01-01T00:00:00.000Z");
    expect(receipt.receiptKind).toBe("demo-only");
    expect(receipt.note.toLowerCase()).toMatch(/non-canonical|not canonical|demo/);
    const record = receipt as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (/canonical|production|productionready/i.test(key)) {
        expect(record[key]).toBeFalsy();
      }
    }
    expect("canonical" in record).toBe(false);
  });
});

describe("reputation receipt — echoes scored output and provisional lanes (VAL-RECEIPT-004/005)", () => {
  it("VAL-RECEIPT-004: echoes the scored uwrScore exactly", () => {
    const scored = makeScored(0.4321);
    const receipt = buildReputationReceipt(scored, PROVISIONAL_LANES, "2025-01-01T00:00:00.000Z");
    expect(receipt.uwrScore).toBe(scored.uwrScore);
  });

  it("VAL-RECEIPT-005: echoes the provisionalLanes list (exactly news/social/ai-ml, order-insensitive)", () => {
    const receipt = buildReputationReceipt(makeScored(), PROVISIONAL_LANES, "2025-01-01T00:00:00.000Z");
    expect([...receipt.provisionalLanes].sort()).toEqual(["ai-ml", "news", "social"]);
    expect([...receipt.provisionalLanes].sort()).toEqual([...PROVISIONAL_LANES].sort());
  });

  it("does not alias the caller's provisionalLanes array (defensive copy)", () => {
    const lanes: AnalysisLaneId[] = ["news", "social", "ai-ml"];
    const receipt = buildReputationReceipt(makeScored(), lanes, "2025-01-01T00:00:00.000Z");
    expect(receipt.provisionalLanes).not.toBe(lanes);
    expect(receipt.provisionalLanes).toEqual(lanes);
  });

  it("carries the scored signalId through", () => {
    const receipt = buildReputationReceipt(makeScored(), PROVISIONAL_LANES, "2025-01-01T00:00:00.000Z");
    expect(receipt.signalId).toBe(SIGNAL_ID);
  });
});

describe("reputation receipt — determinism (issuedAt excluded from hashes)", () => {
  it("issuedAt comes from the injected clock and is EXCLUDED from the content hash", () => {
    const scored = makeScored();
    const a = buildReputationReceipt(scored, PROVISIONAL_LANES, "2025-01-01T00:00:00.000Z");
    const b = buildReputationReceipt(scored, PROVISIONAL_LANES, "2099-12-31T23:59:59.000Z");
    expect(a.issuedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(b.issuedAt).toBe("2099-12-31T23:59:59.000Z");
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it("emitting twice over identical inputs yields a deeply-equal receipt (no observable side effects)", () => {
    const a = buildReputationReceipt(makeScored(), PROVISIONAL_LANES, "2025-01-01T00:00:00.000Z");
    const b = buildReputationReceipt(makeScored(), PROVISIONAL_LANES, "2025-01-01T00:00:00.000Z");
    expect(a).toEqual(b);
  });
});

describe("reputation receipt — pipehead wrapper", () => {
  it("execute() returns an ok 'reputation' result wrapping the DemoReputationReceipt", async () => {
    const pipehead = createReputationReceiptPipehead();
    const res = await pipehead.execute(makeInput(), ctx());
    expect(res.pipeheadId).toBe(REPUTATION_RECEIPT_PIPEHEAD_ID);
    expect(res.kind).toBe("reputation");
    expect(res.status).toBe("ok");
    expect(res.provisional).toBe(true);
    expect(res.output.receiptKind).toBe("demo-only");
    expect(res.output.mutatesReputationState).toBe(false);
  });

  it("issuedAt on the wrapped receipt comes from ctx.clock()", async () => {
    const res = await createReputationReceiptPipehead().execute(makeInput(), ctx("2030-06-06T06:06:06.000Z"));
    expect(res.output.issuedAt).toBe("2030-06-06T06:06:06.000Z");
  });

  it("default reputationReceiptPipehead exposes the reputation kind/id", () => {
    expect(reputationReceiptPipehead.id).toBe(REPUTATION_RECEIPT_PIPEHEAD_ID);
    expect(reputationReceiptPipehead.kind).toBe("reputation");
  });

  it("invoking the pipehead twice with the same input+ctx yields deeply-equal results", async () => {
    const pipehead = createReputationReceiptPipehead();
    const a = await pipehead.execute(makeInput(), ctx("2025-01-01T00:00:00.000Z"));
    const b = await pipehead.execute(makeInput(), ctx("2025-01-01T00:00:00.000Z"));
    expect(a).toEqual(b);
  });
});

/** Strip block and line comments so the source scan only inspects executable code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("reputation receipt — no reputation-state mutation (VAL-RECEIPT-003)", () => {
  it("emitting a receipt creates no files on disk (no reputation artifact persisted)", async () => {
    const cwd = process.cwd();
    const before = readdirSync(cwd);
    const probe = mkdtempSync(join(tmpdir(), "rep-receipt-"));
    const probeBefore = readdirSync(probe);
    try {
      for (let i = 0; i < 5; i += 1) {
        buildReputationReceipt(makeScored(), PROVISIONAL_LANES, "2025-01-01T00:00:00.000Z");
        // eslint-disable-next-line no-await-in-loop
        await createReputationReceiptPipehead().execute(makeInput(), ctx());
      }
      // Neither the repo root nor a fresh probe dir gained any artifact.
      expect(readdirSync(cwd)).toEqual(before);
      expect(readdirSync(probe)).toEqual(probeBefore);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  it("the module imports nothing that reads/writes a DB, vault, network, fs, or reputation store (source scan)", () => {
    const source = stripComments(
      readFileSync(join(process.cwd(), "src/pipeheads/reputationReceipt.ts"), "utf-8")
    );
    const forbidden = [
      /\bfrom\s+["'](node:)?fs["']/,
      /\brequire\(\s*["'](node:)?fs["']/,
      /\bfrom\s+["']mongodb["']/,
      /\bMongoClient\b/,
      /tssdVault/i,
      /\bfrom\s+["']https?["']/,
      /\bfetch\s*\(/,
      /\baxios\b/,
      /writeFileSync|appendFileSync|\bwriteFile\b/,
      /\.(insertOne|insertMany|updateOne|updateMany|save)\s*\(/,
      /reputationStore|writeReputation|updateReputation|persistReputation/i,
    ];
    for (const re of forbidden) {
      expect(source).not.toMatch(re);
    }
  });

  it("emitting a receipt returns only an in-memory plain object (no store handle / connection)", async () => {
    const res = await createReputationReceiptPipehead().execute(makeInput(), ctx());
    expect(Object.keys(res.output).sort()).toEqual(
      [
        "issuedAt",
        "mutatesReputationState",
        "note",
        "provisionalLanes",
        "receiptKind",
        "signalId",
        "uwrScore",
      ].sort()
    );
  });

  it("the receipt's invariant marker is the literal false (state never mutated)", () => {
    const receipt: DemoReputationReceipt = buildReputationReceipt(
      makeScored(),
      PROVISIONAL_LANES,
      "2025-01-01T00:00:00.000Z"
    );
    expect(receipt.mutatesReputationState).toBe(false);
    // typed invariant: the field is literally typed `false`, never `true`.
    const asTrue = receipt.mutatesReputationState as boolean;
    expect(asTrue).not.toBe(true);
  });
});

describe("reputation receipt — exported note", () => {
  it("REPUTATION_RECEIPT_NOTE conveys non-mutation and non-canonical status", () => {
    expect(typeof REPUTATION_RECEIPT_NOTE).toBe("string");
    expect(REPUTATION_RECEIPT_NOTE.toLowerCase()).toMatch(/mutat/);
    expect(REPUTATION_RECEIPT_NOTE.toLowerCase()).toMatch(/canonical/);
  });
});
