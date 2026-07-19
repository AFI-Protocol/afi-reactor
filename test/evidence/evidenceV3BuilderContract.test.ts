/**
 * EV3-GOV §15.1 CONTRACT — the D-EV3-5(3) fail-closed mismatch law, rule by
 * rule.
 *
 * For EVERY fail-closed rule of the sole District Two Evidence V3 builder:
 * construct the fully valid five-lane world (test/evidence/support/
 * evidenceV3World.ts — every hash really computed by the production
 * projections), mutate exactly ONE aspect, and assert the builder throws
 * EvidenceProofViolationError with EXACTLY the taxonomy reason for that rule
 * (never a downgraded record, never a fabricated proof — D-EV3-5(3)).
 *
 * The non-proof construction rules (missing strategyVersion, missing/partial
 * composition, unstampable UWR profile) are covered by
 * test/evidence/submitScoredSignalEvidence.test.ts; the schema-closure
 * mutations against the VENDORED v3 contract (AJV) are at the bottom of this
 * file; the §15.2 hash-movement matrix lives in
 * test/evidence/evidenceV3MutationMatrix.test.ts.
 */

import {
  buildReactorEvidenceRecord,
  EvidenceProofViolationError,
  type EvidenceCompositionContext,
  type EvidenceProofViolationReason,
} from "../../src/evidence/reactorEvidenceRecord.js";
import { validateEvidenceRecordV3 } from "../../src/evidence/evidenceV3Schema.js";
import type { ProviderInvocationProofV1 } from "../../src/providers/invocationProof.js";
import type { AnalysisCategory } from "../../src/providers/types.js";
import { makeScored, makeContext } from "./support/evidenceV3World.js";

/** Build with the given context and capture the typed violation. */
function violation(
  context: EvidenceCompositionContext,
  scored = makeScored()
): EvidenceProofViolationError {
  let caught: unknown;
  try {
    buildReactorEvidenceRecord(scored, context);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(EvidenceProofViolationError);
  return caught as EvidenceProofViolationError;
}

function proofOf(
  context: EvidenceCompositionContext,
  category: AnalysisCategory
): ProviderInvocationProofV1 {
  return context.invocations.proofs.find((p) => p.category === category)!;
}

function expectReason(
  context: EvidenceCompositionContext,
  reason: EvidenceProofViolationReason,
  scored = makeScored()
): void {
  expect(violation(context, scored).reason).toBe(reason);
}

describe("EV3-GOV 15.1 — baseline: the valid world builds a valid record", () => {
  it("constructs a schema-valid v3 record with five ordered proofs", () => {
    const record = buildReactorEvidenceRecord(makeScored(), makeContext());
    expect(record.schema).toBe("afi.scored-signal-evidence.v3");
    expect(record.providerInvocations.map((p) => p.category)).toEqual([
      "aiMl",
      "news",
      "pattern",
      "sentiment",
      "technical",
    ]);
    const v3 = validateEvidenceRecordV3(record);
    expect(v3.errors).toEqual([]);
    expect(v3.ok).toBe(true);
  });

  it("accepts proofs in ANY input order and emits the deterministic ascending order (the proof-mis-ordered assert is unreachable from outside — D-EV3-2)", () => {
    const context = makeContext();
    context.invocations.proofs = [...context.invocations.proofs].reverse();
    const record = buildReactorEvidenceRecord(makeScored(), context);
    expect(record.providerInvocations.map((p) => p.category)).toEqual([
      "aiMl",
      "news",
      "pattern",
      "sentiment",
      "technical",
    ]);
  });
});

describe("EV3-GOV 15.1 — invocation capture and the five-proof law", () => {
  it("reason 'invocation-capture-missing': no capture propagated", () => {
    const context = makeContext();
    (context as unknown as Record<string, unknown>).invocations = undefined;
    expectReason(context, "invocation-capture-missing");
  });

  it("reason 'invocation-capture-missing': proofs is not an array", () => {
    const context = makeContext();
    (context.invocations as unknown as Record<string, unknown>).proofs = undefined;
    expectReason(context, "invocation-capture-missing");
  });

  it.each(["aiMl", "news", "pattern", "sentiment", "technical"] as const)(
    "reason 'proof-count': the '%s' lane proof is missing (all five required, D-EV3-5(1))",
    (category) => {
      const context = makeContext();
      context.invocations.proofs = context.invocations.proofs.filter(
        (p) => p.category !== category
      );
      expectReason(context, "proof-count");
    }
  );

  it("reason 'proof-unknown-category': a proof names a category outside the governed namespace", () => {
    const context = makeContext();
    (proofOf(context, "news") as unknown as Record<string, unknown>).category = "notacategory";
    expectReason(context, "proof-unknown-category");
  });

  it("reason 'proof-duplicate-category': two proofs for one category", () => {
    const context = makeContext();
    context.invocations.proofs = [...context.invocations.proofs, proofOf(context, "technical")];
    expectReason(context, "proof-duplicate-category");
  });
});

describe("EV3-GOV 15.1 — per-proof shape and result-schema law", () => {
  it("reason 'proof-malformed': wrong proof schema const", () => {
    const context = makeContext();
    (proofOf(context, "pattern") as unknown as Record<string, unknown>).schema =
      "afi.provider-invocation-proof.v2";
    expectReason(context, "proof-malformed");
  });

  it("reason 'proof-malformed': a non-'succeeded' status (a scored record admits no other)", () => {
    const context = makeContext();
    (proofOf(context, "sentiment") as unknown as Record<string, unknown>).status = "failed";
    expectReason(context, "proof-malformed");
  });

  it("reason 'result-schema-mismatch': the proof names another lane's governed result schema", () => {
    const context = makeContext();
    proofOf(context, "technical").resultSchema = "afi.enrichment.news.v1";
    expectReason(context, "result-schema-mismatch");
  });
});

describe("EV3-GOV 15.1 — registry-identity law (boot-verified resolution agreement)", () => {
  const identityMutations: Array<[string, (p: ProviderInvocationProofV1) => void]> = [
    ["providerId", (p) => (p.provider = { ...p.provider, providerId: "provider-rogue" })],
    ["provider recordVersion", (p) => (p.provider = { ...p.provider, recordVersion: "9.9.9" })],
    [
      "providerInstanceId",
      (p) => (p.providerInstance = { ...p.providerInstance, providerInstanceId: "pi-rogue" }),
    ],
    [
      "instance recordVersion",
      (p) => (p.providerInstance = { ...p.providerInstance, recordVersion: "9.9.9" }),
    ],
    ["adapterId", (p) => (p.adapter = { ...p.adapter, adapterId: "adapter-rogue" })],
    ["adapterVersion", (p) => (p.adapter = { ...p.adapter, adapterVersion: "9.9.9" })],
  ];

  it.each(identityMutations)(
    "reason 'registry-identity-mismatch': %s differs from the boot-verified resolution",
    (_name, mutate) => {
      const context = makeContext();
      mutate(proofOf(context, "news"));
      expectReason(context, "registry-identity-mismatch");
    }
  );

  it("reason 'registry-identity-mismatch': the aiMl proof claims a different governed model", () => {
    const context = makeContext();
    const aiml = proofOf(context, "aiMl");
    aiml.providerInstance = { ...aiml.providerInstance, model: "rogue-profile-v9" };
    expectReason(context, "registry-identity-mismatch");
  });

  it("reason 'registry-identity-mismatch': no lane binding exists for the category", () => {
    const context = makeContext();
    context.invocations.laneBindings = context.invocations.laneBindings.filter(
      (b) => b.category !== "pattern"
    );
    expectReason(context, "registry-identity-mismatch");
  });
});

describe("EV3-GOV 15.1 — credential-binding law (keyless iff no credentialRef; D-EV3-6)", () => {
  it("reason 'credential-binding-mismatch': proof claims a credential but the governed instance is keyless", () => {
    const context = makeContext();
    proofOf(context, "news").credential = {
      mode: "credentialRef",
      credentialKind: "apiKeyHeader",
      credentialRef: "cred-rogue",
      recordVersion: "1.0.0",
      status: "active",
    };
    expectReason(context, "credential-binding-mismatch");
  });

  it("reason 'credential-binding-mismatch': proof claims keyless posture but the instance binds a credentialRef", () => {
    const context = makeContext();
    context.invocations.laneBindings.find((b) => b.category === "news")!.credentialRef =
      "newsdata-key-tenant-a";
    expectReason(context, "credential-binding-mismatch");
  });

  it("reason 'credential-binding-mismatch': the proof names a DIFFERENT opaque credentialRef than the instance binds", () => {
    const context = makeContext();
    context.invocations.laneBindings.find((b) => b.category === "news")!.credentialRef =
      "newsdata-key-tenant-a";
    proofOf(context, "news").credential = {
      mode: "credentialRef",
      credentialKind: "apiKeyHeader",
      credentialRef: "newsdata-key-tenant-b",
      recordVersion: "1.0.0",
      status: "active",
    };
    expectReason(context, "credential-binding-mismatch");
  });
});

describe("EV3-GOV 15.1 — result recomputation law (evidence never re-calls a provider)", () => {
  it("reason 'lane-result-missing': the consumed category result was not captured", () => {
    const context = makeContext();
    delete context.invocations.laneResults.sentiment;
    expectReason(context, "lane-result-missing");
  });

  it("reason 'category-result-hash-mismatch': the consumed result differs from the committed one", () => {
    const context = makeContext();
    (context.invocations.laneResults.news as Record<string, unknown>).news = {
      hasShockEvent: true,
      headlines: ["tampered"],
    };
    expectReason(context, "category-result-hash-mismatch");
  });

  it("reason 'category-result-hash-mismatch': the proof's committed digest was tampered", () => {
    const context = makeContext();
    const proof = proofOf(context, "pattern");
    proof.categoryResultHash = { ...proof.categoryResultHash, value: "ab".repeat(32) };
    expectReason(context, "category-result-hash-mismatch");
  });

  it("reason 'provider-result-hash-mismatch': the provider payload digest was tampered (category digest intact)", () => {
    const context = makeContext();
    const proof = proofOf(context, "pattern");
    proof.providerResultHash = { ...proof.providerResultHash, value: "ab".repeat(32) };
    expectReason(context, "provider-result-hash-mismatch");
  });
});

describe("EV3-GOV 15.1 — source-reference law (technical priceSource ONLY, D-EV3-2(6))", () => {
  it("reason 'price-source-mismatch': technical proof's priceSource differs from the consumed result", () => {
    const context = makeContext();
    proofOf(context, "technical").priceSource = "rogue-feed";
    expectReason(context, "price-source-mismatch");
  });

  it("reason 'price-source-mismatch': a non-technical proof carries a priceSource", () => {
    const context = makeContext();
    proofOf(context, "sentiment").priceSource = "demo";
    expectReason(context, "price-source-mismatch");
  });
});

describe("EV3-GOV 15.1 — aiMl nested-proof law (D-EV3-3)", () => {
  it("reason 'aiml-invocation-missing': the aiMl proof carries no nested proof", () => {
    const context = makeContext();
    delete proofOf(context, "aiMl").aimlInvocation;
    expectReason(context, "aiml-invocation-missing");
  });

  const nestedMutations: Array<
    [string, (nested: NonNullable<ProviderInvocationProofV1["aimlInvocation"]>) => void]
  > = [
    ["wrong nested schema const", (n) => ((n as unknown as Record<string, unknown>).schema = "afi.aiml-invocation-proof.v2")],
    ["non-'succeeded' nested status", (n) => ((n as unknown as Record<string, unknown>).status = "failed")],
    ["wrong hash law", (n) => ((n as unknown as Record<string, unknown>).hashLaw = "tiny-brains.hash.v2")],
    ["profileId differs from the governed instance model", (n) => (n.profileId = "rogue-profile-v9")],
    ["empty expert set", (n) => (n.experts = [])],
    [
      "unsorted experts",
      (n) => (n.experts = [...n.experts].reverse()),
    ],
    [
      "duplicate expertId",
      (n) => (n.experts = [n.experts[0], { ...n.experts[0] }]),
    ],
    [
      "a non-'succeeded' expert",
      (n) => ((n.experts[0] as unknown as Record<string, unknown>).status = "failed"),
    ],
  ];

  it.each(nestedMutations)("reason 'aiml-invocation-mismatch': %s", (_name, mutate) => {
    const context = makeContext();
    mutate(proofOf(context, "aiMl").aimlInvocation!);
    expectReason(context, "aiml-invocation-mismatch");
  });

  it("reason 'aiml-invocation-mismatch': a nested aiMl proof on a NON-aiMl lane is structurally forbidden", () => {
    const context = makeContext();
    proofOf(context, "news").aimlInvocation = proofOf(context, "aiMl").aimlInvocation;
    expectReason(context, "aiml-invocation-mismatch");
  });
});

describe("EV3-GOV 15.1 — decay and composition identity law", () => {
  it("reason 'decay-identity-mismatch': runtime halfLifeMinutes differs from the registration-resolved value", () => {
    expectReason(
      makeContext(),
      "decay-identity-mismatch",
      makeScored({ decayParams: { halfLifeMinutes: 999, greeksTemplateId: "decay-swing-v1" } })
    );
  });

  it("reason 'decay-identity-mismatch': runtime greeksTemplateId differs", () => {
    expectReason(
      makeContext(),
      "decay-identity-mismatch",
      makeScored({ decayParams: { halfLifeMinutes: 240, greeksTemplateId: "decay-rogue-v9" } })
    );
  });

  it("reason 'decay-identity-mismatch': the capture carries no registration-resolved decay identity", () => {
    const context = makeContext();
    (context.invocations as unknown as Record<string, unknown>).decay = undefined;
    expectReason(context, "decay-identity-mismatch");
  });

  it("reason 'composition-identity-mismatch': the registration triple differs from the scored triple (analystId)", () => {
    const context = makeContext({
      registration: {
        analystId: "kestrel",
        strategyId: "trend_pullback_v1",
        strategyVersion: "1.0.0",
        uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
      } as EvidenceCompositionContext["registration"],
    });
    expectReason(context, "composition-identity-mismatch");
  });

  it("reason 'composition-identity-mismatch': the registration triple differs from the scored triple (strategyVersion)", () => {
    const context = makeContext({
      registration: {
        analystId: "froggy",
        strategyId: "trend_pullback_v1",
        strategyVersion: "2.0.0",
        uwrProfileRef: { profileId: "uwr-weighted-lifts-v0.1" },
      } as EvidenceCompositionContext["registration"],
    });
    expectReason(context, "composition-identity-mismatch");
  });
});

describe("EV3-GOV 15.1 — vendored v3 closure rejections (AJV over the governed contract)", () => {
  function validRecord() {
    return JSON.parse(
      JSON.stringify(buildReactorEvidenceRecord(makeScored(), makeContext()))
    ) as Record<string, unknown>;
  }

  it("rejects a record missing any of the three v3 additions", () => {
    for (const field of ["providerInvocations", "recordHash", "replayHash"]) {
      const record = validRecord();
      delete record[field];
      expect(validateEvidenceRecordV3(record).ok).toBe(false);
    }
  });

  it("rejects fewer than five proofs (minItems 5)", () => {
    const record = validRecord();
    (record.providerInvocations as unknown[]).pop();
    expect(validateEvidenceRecordV3(record).ok).toBe(false);
  });

  it("rejects mis-ordered proofs (the positional five-tuple enforces the ascending category order)", () => {
    const record = validRecord();
    (record.providerInvocations as unknown[]).reverse();
    expect(validateEvidenceRecordV3(record).ok).toBe(false);
  });

  it("rejects a nested aiMl invocation off position 0 (structurally forbidden off the aiMl lane)", () => {
    const record = validRecord();
    const proofs = record.providerInvocations as Array<Record<string, unknown>>;
    proofs[1].aimlInvocation = proofs[0].aimlInvocation;
    expect(validateEvidenceRecordV3(record).ok).toBe(false);
  });

  it("rejects an undeclared top-level property (additionalProperties:false)", () => {
    const record = validRecord();
    record.operationalDiagnostics = { durationMs: 12 };
    expect(validateEvidenceRecordV3(record).ok).toBe(false);
  });

  it("rejects an undeclared proof property (closed proof contract)", () => {
    const record = validRecord();
    (record.providerInvocations as Array<Record<string, unknown>>)[4].startedAt =
      "2026-01-15T12:00:00Z";
    expect(validateEvidenceRecordV3(record).ok).toBe(false);
  });

  it("rejects a malformed CanonicalHash value (the $ref'd canonical-hash contract)", () => {
    const record = validRecord();
    (record.recordHash as Record<string, unknown>).value = "not-a-sha256";
    expect(validateEvidenceRecordV3(record).ok).toBe(false);
  });

  it("rejects a wrong lifecycle/finality binder for the carried-forward v2 core", () => {
    const record = validRecord();
    record.lifecycleState = "PROPOSED";
    expect(validateEvidenceRecordV3(record).ok).toBe(false);
  });
});
