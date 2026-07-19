/**
 * EV3-GOV §15.2 MUTATION MATRIX — every load-bearing invocation-provenance
 * fact, three proofs each:
 *
 *   (a) a CONSISTENT variant of the fact moves EXACTLY the correct hashes
 *       (recordHash + replayHash always; per-lane categoryResultHash /
 *       providerResultHash only for result-content mutations;
 *       invocationInputHash only for adapter-identity/model mutations);
 *   (b) an INCONSISTENT variant trips EXACTLY the right D-EV3-5(3)
 *       builder cross-check (typed reason), where a cross-check exists —
 *       facts with no District Two recomputation source (runtime-computed
 *       carried commitments: record fingerprints, invocationInputHash,
 *       expert/resolver identities, TB profileVersion) are documented as
 *       such and covered by leg (a) plus the adapter-boundary law (D-EV3-3)
 *       and the closed vendored schema;
 *   (c) the UNRELATED projections stay byte-identical: the evidence-law
 *       inputHash and outputHash (except for the analyst-identity mutation,
 *       whose projection legitimately embeds analystId), the composition
 *       enrichmentHash, the scoredSignal projection, and every untouched
 *       lane's digests.
 *
 * Matrix rows (the full mission §15.2 list):
 *   providerId, instanceId, adapterId, provider version, adapter version,
 *   config fingerprint, input hash, output hash, category-result hash,
 *   source reference, TB profile, expert fingerprint, resolver identity,
 *   analyst identity, UWR identity, decay identity.
 */

import {
  buildReactorEvidenceRecord,
  EvidenceProofViolationError,
  ReactorEvidenceConstructionError,
  type EvidenceCompositionContext,
  type EvidenceInvocationCapture,
  type EvidenceProofViolationReason,
  type LaneBindingExpectation,
  type ReactorEvidenceRecord,
} from "../../src/evidence/reactorEvidenceRecord.js";
import { validateEvidenceRecordV3 } from "../../src/evidence/evidenceV3Schema.js";
import {
  evidenceRecordHash,
  evidenceReplayHash,
} from "../../src/evidence/provenance/invocationProofHashes.js";
import { PROOF_CATEGORY_ORDER } from "../../src/providers/invocationProof.js";
import type { AnalysisCategory } from "../../src/providers/types.js";
import type { ReactorScoredSignalV1 } from "../../src/types/ReactorScoredSignalV1.js";
import {
  DECAY,
  makeBinding,
  makeContext,
  makeLaneResults,
  makeProof,
  makeScored,
} from "./support/evidenceV3World.js";

// ---------------------------------------------------------------------------
// World construction: a consistent world derives every proof from the
// (possibly mutated) bindings + lane results, so mutations stay self-
// consistent exactly as a real re-resolved runtime would produce them.
// ---------------------------------------------------------------------------

interface WorldFacts {
  laneResults: Record<AnalysisCategory, Record<string, unknown>>;
  laneBindings: LaneBindingExpectation[];
}

function makeWorldContext(mutateFacts?: (w: WorldFacts) => void): EvidenceCompositionContext {
  const facts: WorldFacts = {
    laneResults: makeLaneResults(),
    laneBindings: PROOF_CATEGORY_ORDER.map((c) => makeBinding(c)),
  };
  mutateFacts?.(facts);
  const proofs = PROOF_CATEGORY_ORDER.map((c) =>
    makeProof(
      c,
      facts.laneBindings.find((b) => b.category === c)!,
      facts.laneResults[c] as { category: string }
    )
  );
  const invocations: EvidenceInvocationCapture = {
    proofs,
    laneResults: { ...facts.laneResults },
    laneBindings: facts.laneBindings,
    decay: { ...DECAY },
  };
  return makeContext({ invocations });
}

function build(
  context: EvidenceCompositionContext,
  scored: ReactorScoredSignalV1 = makeScored()
): ReactorEvidenceRecord {
  return buildReactorEvidenceRecord(scored, context);
}

// ---------------------------------------------------------------------------
// Hash snapshot + movement assertion.
// ---------------------------------------------------------------------------

interface Snapshot {
  recordHash: string;
  replayHash: string;
  inputHash: string;
  outputHash: string;
  enrichmentHash: string;
  scoredSignal: string;
  perLane: Record<string, { category: string; provider: string; input: string }>;
}

function snap(record: ReactorEvidenceRecord): Snapshot {
  const perLane: Snapshot["perLane"] = {};
  for (const proof of record.providerInvocations) {
    perLane[proof.category] = {
      category: proof.categoryResultHash.value,
      provider: proof.providerResultHash.value,
      input: proof.invocationInputHash.value,
    };
  }
  return {
    recordHash: record.recordHash.value,
    replayHash: record.replayHash.value,
    inputHash: record.provenanceRecord.inputHash.value,
    outputHash: record.provenanceRecord.outputHash.value,
    enrichmentHash: record.composition.enrichmentHash.value,
    scoredSignal: JSON.stringify(record.scoredSignal),
    perLane,
  };
}

interface MovementExpectation {
  /** Lanes whose categoryResultHash+providerResultHash must move (default none). */
  resultLanesMoved?: AnalysisCategory[];
  /** Lanes whose invocationInputHash must move (default none). */
  inputLanesMoved?: AnalysisCategory[];
  /** The evidence-law outputHash moves (analyst-identity mutation only). */
  outputMoved?: boolean;
  /** The record/replay commitments move (default true). */
  recordMoved?: boolean;
}

function expectMovement(base: Snapshot, variant: Snapshot, exp: MovementExpectation): void {
  const recordMoved = exp.recordMoved ?? true;
  // (a) the record-level commitments move exactly when expected
  expect(variant.recordHash !== base.recordHash).toBe(recordMoved);
  expect(variant.replayHash !== base.replayHash).toBe(recordMoved);
  // (c) the untouched projections are byte-identical
  expect(variant.inputHash).toBe(base.inputHash);
  expect(variant.enrichmentHash).toBe(base.enrichmentHash);
  expect(variant.outputHash !== base.outputHash).toBe(exp.outputMoved ?? false);
  if (!(exp.outputMoved ?? false)) expect(variant.scoredSignal).toBe(base.scoredSignal);
  // per-lane digests move ONLY where expected
  for (const category of PROOF_CATEGORY_ORDER) {
    const resultMoved = (exp.resultLanesMoved ?? []).includes(category);
    const inputMoved = (exp.inputLanesMoved ?? []).includes(category);
    expect(variant.perLane[category].category !== base.perLane[category].category).toBe(
      resultMoved
    );
    expect(variant.perLane[category].provider !== base.perLane[category].provider).toBe(
      resultMoved
    );
    expect(variant.perLane[category].input !== base.perLane[category].input).toBe(inputMoved);
  }
}

function expectTrip(
  context: EvidenceCompositionContext,
  reason: EvidenceProofViolationReason,
  scored: ReactorScoredSignalV1 = makeScored()
): void {
  let caught: unknown;
  try {
    build(context, scored);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(EvidenceProofViolationError);
  expect((caught as EvidenceProofViolationError).reason).toBe(reason);
}

const OTHER_SHA256 = "9a".repeat(32);

let base: Snapshot;
beforeAll(() => {
  base = snap(build(makeWorldContext()));
});

// ---------------------------------------------------------------------------
// Identity-chain mutations (consistent variant re-resolves the whole lane).
// ---------------------------------------------------------------------------

describe("15.2 — providerId", () => {
  it("(a)+(c) consistent change moves recordHash+replayHash ONLY", () => {
    const variant = snap(
      build(
        makeWorldContext((w) => {
          w.laneBindings.find((b) => b.category === "news")!.providerId = "provider-news-successor";
        })
      )
    );
    expectMovement(base, variant, {});
  });
  it("(b) proof-only change trips registry-identity-mismatch", () => {
    const context = makeWorldContext();
    const proof = context.invocations.proofs.find((p) => p.category === "news")!;
    proof.provider = { ...proof.provider, providerId: "provider-rogue" };
    expectTrip(context, "registry-identity-mismatch");
  });
});

describe("15.2 — providerInstanceId", () => {
  it("(a)+(c) consistent change moves recordHash+replayHash ONLY", () => {
    const variant = snap(
      build(
        makeWorldContext((w) => {
          w.laneBindings.find((b) => b.category === "sentiment")!.providerInstanceId =
            "pi-sentiment-successor";
        })
      )
    );
    expectMovement(base, variant, {});
  });
  it("(b) proof-only change trips registry-identity-mismatch", () => {
    const context = makeWorldContext();
    const proof = context.invocations.proofs.find((p) => p.category === "sentiment")!;
    proof.providerInstance = { ...proof.providerInstance, providerInstanceId: "pi-rogue" };
    expectTrip(context, "registry-identity-mismatch");
  });
});

describe("15.2 — adapterId", () => {
  it("(a)+(c) consistent change moves recordHash+replayHash AND the lane's invocationInputHash (adapter identity is invocation-input material)", () => {
    const variant = snap(
      build(
        makeWorldContext((w) => {
          w.laneBindings.find((b) => b.category === "pattern")!.adapterId =
            "adapter-pattern-successor";
        })
      )
    );
    expectMovement(base, variant, { inputLanesMoved: ["pattern"] });
  });
  it("(b) proof-only change trips registry-identity-mismatch", () => {
    const context = makeWorldContext();
    const proof = context.invocations.proofs.find((p) => p.category === "pattern")!;
    proof.adapter = { ...proof.adapter, adapterId: "adapter-rogue" };
    expectTrip(context, "registry-identity-mismatch");
  });
});

describe("15.2 — provider recordVersion", () => {
  it("(a)+(c) consistent change moves recordHash+replayHash ONLY", () => {
    const variant = snap(
      build(
        makeWorldContext((w) => {
          w.laneBindings.find((b) => b.category === "technical")!.providerRecordVersion = "1.1.0";
        })
      )
    );
    expectMovement(base, variant, {});
  });
  it("(b) proof-only change trips registry-identity-mismatch", () => {
    const context = makeWorldContext();
    const proof = context.invocations.proofs.find((p) => p.category === "technical")!;
    proof.provider = { ...proof.provider, recordVersion: "9.9.9" };
    expectTrip(context, "registry-identity-mismatch");
  });
});

describe("15.2 — adapterVersion", () => {
  it("(a)+(c) consistent change moves recordHash+replayHash AND the lane's invocationInputHash", () => {
    const variant = snap(
      build(
        makeWorldContext((w) => {
          w.laneBindings.find((b) => b.category === "aiMl")!.adapterVersion = "1.2.0";
        })
      )
    );
    expectMovement(base, variant, { inputLanesMoved: ["aiMl"] });
  });
  it("(b) proof-only change trips registry-identity-mismatch", () => {
    const context = makeWorldContext();
    const proof = context.invocations.proofs.find((p) => p.category === "aiMl")!;
    proof.adapter = { ...proof.adapter, adapterVersion: "9.9.9" };
    expectTrip(context, "registry-identity-mismatch");
  });
});

// ---------------------------------------------------------------------------
// Carried-commitment mutations (no District Two recomputation source; RC-7 —
// the registry records never travel to the evidence layer; the commitments
// are runtime-computed and schema-closed, and they MUST still move the
// record-level hashes).
// ---------------------------------------------------------------------------

describe("15.2 — config fingerprint (instance recordFingerprint, the non-secret configuration commitment)", () => {
  it("(a)+(c) a different commitment moves recordHash+replayHash ONLY — and the record stays schema-valid (carried commitment; no builder recomputation source)", () => {
    const context = makeWorldContext();
    const proof = context.invocations.proofs.find((p) => p.category === "news")!;
    proof.providerInstance = {
      ...proof.providerInstance,
      recordFingerprint: { ...proof.providerInstance.recordFingerprint, value: OTHER_SHA256 },
    };
    const record = build(context);
    expect(validateEvidenceRecordV3(record).ok).toBe(true);
    expectMovement(base, snap(record), {});
  });
});

describe("15.2 — invocation input hash", () => {
  it("(a)+(c) a different commitment moves recordHash+replayHash ONLY (carried commitment; captured at the runtime seam)", () => {
    const context = makeWorldContext();
    const proof = context.invocations.proofs.find((p) => p.category === "technical")!;
    proof.invocationInputHash = { ...proof.invocationInputHash, value: OTHER_SHA256 };
    const record = build(context);
    expect(validateEvidenceRecordV3(record).ok).toBe(true);
    const variant = snap(record);
    // the tampered lane's carried input digest is the moved value itself
    expect(variant.perLane.technical.input).toBe(OTHER_SHA256);
    expectMovement(base, variant, { inputLanesMoved: ["technical"] });
  });
});

// ---------------------------------------------------------------------------
// Result-content mutations (the recomputation law has a source: the ACTUAL
// results the join consumed travel with the run).
// ---------------------------------------------------------------------------

describe("15.2 — provider output hash (providerResultHash)", () => {
  it("(b) proof-only change trips provider-result-hash-mismatch", () => {
    const context = makeWorldContext();
    const proof = context.invocations.proofs.find((p) => p.category === "news")!;
    proof.providerResultHash = { ...proof.providerResultHash, value: OTHER_SHA256 };
    expectTrip(context, "provider-result-hash-mismatch");
  });
});

describe("15.2 — category-result hash (result content)", () => {
  it("(a)+(c) a changed lane result moves that lane's categoryResultHash+providerResultHash and recordHash+replayHash; every other lane and projection is byte-identical", () => {
    const variant = snap(
      build(
        makeWorldContext((w) => {
          (w.laneResults.news as Record<string, unknown>).news = {
            hasShockEvent: true,
            headlines: [],
          };
        })
      )
    );
    expectMovement(base, variant, { resultLanesMoved: ["news"] });
  });
  it("(b) proof-only digest change trips category-result-hash-mismatch", () => {
    const context = makeWorldContext();
    const proof = context.invocations.proofs.find((p) => p.category === "news")!;
    proof.categoryResultHash = { ...proof.categoryResultHash, value: OTHER_SHA256 };
    expectTrip(context, "category-result-hash-mismatch");
  });
});

describe("15.2 — source reference (technical priceSource)", () => {
  it("(a)+(c) a changed price source is result content: moves the technical lane digests + recordHash+replayHash", () => {
    const variant = snap(
      build(
        makeWorldContext((w) => {
          (w.laneResults.technical as Record<string, unknown>).priceSource = "coinbase";
        })
      )
    );
    expectMovement(base, variant, { resultLanesMoved: ["technical"] });
  });
  it("(b) proof-only change trips price-source-mismatch", () => {
    const context = makeWorldContext();
    context.invocations.proofs.find((p) => p.category === "technical")!.priceSource = "rogue-feed";
    expectTrip(context, "price-source-mismatch");
  });
});

// ---------------------------------------------------------------------------
// aiMl nested-proof mutations (D-EV3-3).
// ---------------------------------------------------------------------------

describe("15.2 — Tiny Brains profile identity", () => {
  it("(a)+(c) a consistent governed-model/profile change (instance model + proof model + nested profileId) moves recordHash+replayHash AND the aiMl invocationInputHash (model is input material)", () => {
    const variant = snap(
      build(
        makeWorldContext((w) => {
          w.laneBindings.find((b) => b.category === "aiMl")!.model = "froggy-reference-v2";
        })
      )
    );
    expectMovement(base, variant, { inputLanesMoved: ["aiMl"] });
  });
  it("(a) a profileVersion change is a carried nested fact: moves recordHash+replayHash ONLY (boundary-verified by the adapter, D-EV3-3)", () => {
    const context = makeWorldContext();
    context.invocations.proofs.find((p) => p.category === "aiMl")!.aimlInvocation!.profileVersion =
      "1.1.0";
    const record = build(context);
    expect(validateEvidenceRecordV3(record).ok).toBe(true);
    expectMovement(base, snap(record), {});
  });
  it("(b) nested profileId differing from the governed instance model trips aiml-invocation-mismatch", () => {
    const context = makeWorldContext();
    context.invocations.proofs.find((p) => p.category === "aiMl")!.aimlInvocation!.profileId =
      "rogue-profile-v9";
    expectTrip(context, "aiml-invocation-mismatch");
  });
});

describe("15.2 — expert fingerprint", () => {
  it("(a)+(c) a different expert output hash / artifact fingerprint moves recordHash+replayHash ONLY (carried; boundary-verified under tiny-brains.hash.v1)", () => {
    const context = makeWorldContext();
    const nested = context.invocations.proofs.find((p) => p.category === "aiMl")!.aimlInvocation!;
    nested.experts[0].outputHash = OTHER_SHA256;
    nested.experts[0].artifactFingerprints = { model: OTHER_SHA256 };
    const record = build(context);
    expect(validateEvidenceRecordV3(record).ok).toBe(true);
    expectMovement(base, snap(record), {});
  });
});

describe("15.2 — resolver identity", () => {
  it("(a)+(c) a different resolverId/resolverVersion moves recordHash+replayHash ONLY (carried; the resolver law lives in the Tiny Brains service record)", () => {
    const context = makeWorldContext();
    const nested = context.invocations.proofs.find((p) => p.category === "aiMl")!.aimlInvocation!;
    nested.resolverId = "froggy-agreement-v2";
    nested.resolverVersion = "2.0.0";
    const record = build(context);
    expect(validateEvidenceRecordV3(record).ok).toBe(true);
    expectMovement(base, snap(record), {});
  });
});

// ---------------------------------------------------------------------------
// Run-identity mutations (analyst / UWR / decay).
// ---------------------------------------------------------------------------

describe("15.2 — analyst identity", () => {
  it("(a)+(c) a consistent analyst-identity change moves outputHash (the projection embeds analystId) + recordHash+replayHash; inputHash/enrichmentHash and every lane digest are byte-identical", () => {
    const scored = makeScored({ analystScore: { analystId: "atlas-probe", strategyId: "multi_branch_v1" } });
    const context = makeContext({
      registration: {
        analystId: "atlas-probe",
        strategyId: "multi_branch_v1",
        strategyVersion: "1.0.0",
        uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
      } as EvidenceCompositionContext["registration"],
    });
    const variant = snap(build(context, scored));
    expectMovement(base, variant, { outputMoved: true });
  });
  it("(b) a registration/scored triple disagreement trips composition-identity-mismatch", () => {
    const context = makeContext({
      registration: {
        analystId: "kestrel",
        strategyId: "trend_pullback_v1",
        strategyVersion: "1.0.0",
        uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
      } as EvidenceCompositionContext["registration"],
    });
    expectTrip(context, "composition-identity-mismatch");
  });
});

describe("15.2 — UWR identity", () => {
  it("(a)+(c) the RC-6 source discriminator flip (builtin→registry) moves recordHash+replayHash ONLY (the stamp is record content, not projection content)", () => {
    const variant = snap(build(makeWorldContext(), makeScored({ uwrResolvedSource: "registry" })));
    expectMovement(base, variant, {});
  });
  it("(b) an unregistered UWR profile reference fails closed (unstampable — ReactorEvidenceConstructionError)", () => {
    const context = makeContext({
      registration: {
        analystId: "froggy",
        strategyId: "trend_pullback_v1",
        strategyVersion: "1.0.0",
        uwrProfileRef: { profileId: "uwr-unregistered-v9" },
      } as EvidenceCompositionContext["registration"],
    });
    expect(() => build(context)).toThrow(ReactorEvidenceConstructionError);
  });
});

describe("15.2 — decay identity", () => {
  it("(a)+(c) decay identity is NOT record content: a consistent change (runtime + registration-resolved agree) leaves the record BYTE-IDENTICAL — it binds via analystConfigHash (D-EV3-5(3)), which the governed re-registration mechanism moves", () => {
    const changed = { halfLifeMinutes: 720, greeksTemplateId: "decay-swing-v1" };
    const context = makeWorldContext();
    context.invocations.decay = { ...changed };
    const variant = snap(build(context, makeScored({ decayParams: { ...changed } })));
    expectMovement(base, variant, { recordMoved: false });
  });
  it("(b) a runtime/registration decay disagreement trips decay-identity-mismatch", () => {
    expectTrip(
      makeWorldContext(),
      "decay-identity-mismatch",
      makeScored({ decayParams: { halfLifeMinutes: 999, greeksTemplateId: "decay-swing-v1" } })
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism anchor: identical worlds → identical commitments (the §15.4
// unit-level replay law the oracle replay suite proves end-to-end).
// ---------------------------------------------------------------------------

describe("15.2 — determinism anchor", () => {
  it("two identical worlds produce byte-identical records, recordHash, and replayHash", () => {
    const a = build(makeWorldContext());
    const b = build(makeWorldContext());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(b.recordHash).toEqual(a.recordHash);
    expect(b.replayHash).toEqual(a.replayHash);
  });

  it("lifecycle-custody flips move recordHash but NEVER replayHash (the D-EV3-4(6) replay projection)", () => {
    const record = build(makeWorldContext());
    const progressed = {
      ...record,
      lifecycleState: "FINALIZED",
      finalized: true,
      recordVersion: 2,
      supersedesRecordHash: { ...record.recordHash },
    };
    // recompute over the progressed record with the production projections
    expect(evidenceReplayHash(progressed).value).toBe(record.replayHash.value);
    expect(evidenceRecordHash(progressed).value).not.toBe(record.recordHash.value);
  });
});
