/**
 * SECOND REGISTERED STRATEGY PROOF (W3 spec section 8.2; program §9.5).
 *
 * A test-fixture registry OVERLAY (test/pipeline/fixtures/afi-config-atlas)
 * registers analyst 'atlas-probe' / strategy 'multi_branch_v1' / '1.0.0' with
 * a MATERIALLY different graph — news-early entry, parallel news+sentiment
 * wave, CONDITIONAL aiMl probe BEFORE the merge, three-parent namespace
 * merge, atlas TEST scorer sink — plus its own provider binding
 * (atlas-probe-provider). The test plugins live under test/ only; they are
 * injected through the composition test seam (data injection — production
 * source contains no mocks).
 *
 * Proves end-to-end over the LIVE HTTP endpoints:
 *   1. NO froggy conditional anywhere: the second identity scores through the
 *      SAME generic resolution / execution / stamp / evidence mechanism;
 *   2. registry resolution (default, bare-strategyId and full-form requests);
 *   3. the alternate topology actually executes (conditional aiMl probe ran
 *      on the news branch before the merge);
 *   4. the alternate decay resolves from the registration (decay-scalp-v1);
 *   5. a VALID afi.scored-signal-evidence.v2 record persists (in-memory
 *      store) carrying the atlas composition pins + the registry-backed
 *      UWR stamp;
 *   6. unknown / unauthorized identities fail CLOSED (403 discriminators).
 */
import { jest } from "@jest/globals";

// ccxt's compiled dist pulls ESM-only crypto deps jest cannot parse (repo
// idiom — see test/oracle/*.test.ts). No ccxt request is ever issued.
jest.mock("ccxt", () => {
  class UnusedExchange {}
  return {
    __esModule: true,
    default: { blofin: UnusedExchange, coinbase: UnusedExchange },
  };
});

import path from "node:path";
import request from "supertest";
import app from "../../src/server.js";
import { setEvidenceStore, resetEvidenceStore } from "../../src/evidence/index.js";
import { validateEvidenceRecordV2 } from "../../src/evidence/evidenceV2Schema.js";
import {
  __resetRuntimeCompositionForTests,
  __setRuntimeCompositionOverridesForTests,
} from "../../src/config/runtimeComposition.js";
import { createPluginRegistry } from "../../src/pipeline/pluginRegistry.js";
import { technicalNode } from "../../src/pipeline/nodes/technical.js";
import { patternNode } from "../../src/pipeline/nodes/pattern.js";
import { sentimentNode } from "../../src/pipeline/nodes/sentiment.js";
import { newsNode } from "../../src/pipeline/nodes/news.js";
import { aimlNode } from "../../src/pipeline/nodes/aiml.js";
import { mergeEnrichedViewNode } from "../../src/pipeline/nodes/mergeEnrichedView.js";
import { scorerFroggyTrendPullbackNode } from "../../src/pipeline/nodes/scorerFroggyTrendPullback.js";
import { shutdownDedupeCache } from "../../src/services/ingestDedupeService.js";
import {
  OracleEvidenceStore,
  disableNetwork,
} from "../oracle/support/oracleHarness.js";
import { aimlAtlasProbeNode, scorerAtlasProbeNode } from "./support/atlasProbePlugins.js";
import { registerPriceFeedAdapterForTests } from "../../src/adapters/exchanges/priceFeedRegistry.js";
import { demoPriceFeedAdapter } from "../support/deterministicPriceFeedAdapter.js";

const ATLAS_CONFIG_ROOT = path.resolve(process.cwd(), "test/pipeline/fixtures/afi-config-atlas");
const TV = "/api/webhooks/tradingview";

// The atlas fixture pins (computed by the fixture generator, verified against
// the same canonical-json-hashing.v1 rules the boot loader recomputes with —
// a divergence refuses boot, so these assertions double as hash-rule pins).
const ATLAS_MANIFEST_HASH = "8cb66b4e8eff3ec5f6d80ae2b6c549722600b4b4f77b666fa6c074a2547855bc";
const ATLAS_CONFIG_HASH = "2c515ce272528ec6c2fc20cde2b1a988de1eeb7abbf782a91811c1127a626db3";

const ENV_KEYS = [
  "AFI_PRICE_FEED_SOURCE",
  "COINALYZE_API_KEY",
  "NEWS_PROVIDER",
  "NEWSDATA_API_KEY",
  "TINY_BRAINS_URL",
  "WEBHOOK_SHARED_SECRET",
  "AFI_INGEST_DEDUPE",
  "AFI_DEFAULT_PROVIDER_ID",
  "AFI_UWR_PROFILE_SOURCE",
  "PATTERN_REGIME_PROVIDER",
] as const;
const savedEnv = new Map<string, string | undefined>();
let restoreNet: () => void;
let unregisterDemoFeed: () => void;

const aimlProbeSpy = jest.spyOn(aimlAtlasProbeNode, "run");
const scorerProbeSpy = jest.spyOn(scorerAtlasProbeNode, "run");

beforeAll(() => {
  for (const k of ENV_KEYS) {
    savedEnv.set(k, process.env[k]);
    delete process.env[k];
  }
  // Inject the deterministic feed through the guarded test seam and select
  // it explicitly (production source registers no synthetic feed).
  unregisterDemoFeed = registerPriceFeedAdapterForTests(demoPriceFeedAdapter);
  process.env.AFI_PRICE_FEED_SOURCE = "demo";
  process.env.PATTERN_REGIME_PROVIDER = "off";
  restoreNet = disableNetwork();
  shutdownDedupeCache();

  // The composition seam: atlas overlay registries + the production plugin
  // set EXTENDED by the two test probes (test-registry overlay).
  __setRuntimeCompositionOverridesForTests({
    configRoot: ATLAS_CONFIG_ROOT,
    pluginRegistry: createPluginRegistry([
      technicalNode,
      patternNode,
      sentimentNode,
      newsNode,
      aimlNode,
      mergeEnrichedViewNode,
      scorerFroggyTrendPullbackNode,
      aimlAtlasProbeNode,
      scorerAtlasProbeNode,
    ]),
  });
});

afterAll(() => {
  aimlProbeSpy.mockRestore();
  scorerProbeSpy.mockRestore();
  resetEvidenceStore();
  shutdownDedupeCache();
  restoreNet();
  unregisterDemoFeed();
  __resetRuntimeCompositionForTests();
  for (const [k, v] of savedEnv) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function atlasPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signalId: "atlas-proof-0001",
    providerId: "atlas-probe-provider",
    symbol: "BTCUSDT",
    market: "perp",
    timeframe: "15m",
    strategy: "multi_branch_v1",
    direction: "long",
    ...overrides,
  };
}

describe("second registered strategy (atlas-probe/multi_branch_v1@1.0.0) — program §9.5", () => {
  it("scores through the generic mechanism: alternate topology + conditional aiMl + atlas decay + valid v2 evidence", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);
    aimlProbeSpy.mockClear();
    scorerProbeSpy.mockClear();

    const res = await request(app).post(TV).send(atlasPayload());
    expect(res.status).toBe(200);
    expect(res.body.persistence.outcome).toBe("inserted");

    // (1) The SECOND identity scored — no froggy anywhere on this run.
    expect(res.body.analystScore.analystId).toBe("atlas-probe");
    expect(res.body.analystScore.strategyId).toBe("multi_branch_v1");
    expect(res.body.analystScore.strategyVersion).toBe("1.0.0");
    expect(res.body.rawUss.facts.strategy).toBe("multi_branch_v1");
    expect(res.body.meta.strategy).toBe("multi_branch_v1");

    // (3) Alternate topology executed: the conditional aiMl probe ran ON THE
    // NEWS BRANCH (its input was the news node's category-marked output —
    // the conditional edge fired BEFORE the merge), and the atlas scorer sank
    // the merged view.
    expect(aimlProbeSpy).toHaveBeenCalledTimes(1);
    const aimlInput = aimlProbeSpy.mock.calls[0][0] as { category?: string };
    expect(aimlInput.category).toBe("news");
    expect(scorerProbeSpy).toHaveBeenCalledTimes(1);
    const mergedView = scorerProbeSpy.mock.calls[0][0] as {
      signalId?: string;
      enrichmentMeta?: { categories?: string[] };
    };
    expect(mergedView.signalId).toBe("atlas-proof-0001");
    // fail-soft env: the news category contributed (DEFAULT summary), the
    // aiMl probe's namespace was delivered but is not a merged category.
    expect(mergedView.enrichmentMeta?.categories).toContain("news");

    // (4) Alternate decay resolved from the REGISTRATION (decay-scalp-v1) —
    // not from any horizon inference.
    expect(res.body.decayParams).toEqual({
      halfLifeMinutes: 8,
      greeksTemplateId: "decay-scalp-v1",
    });

    // (5) Valid v2 evidence persisted with the atlas composition pins + the
    // registry-backed UWR stamp (generic mechanism — same pinned profile).
    expect(store.records.size).toBe(1);
    const record = store.records.get("atlas-proof-0001");
    expect(record.schema).toBe("afi.scored-signal-evidence.v2");
    expect(record.analystId).toBe("atlas-probe");
    const v2 = validateEvidenceRecordV2(record);
    expect(v2.errors).toEqual([]);
    expect(v2.ok).toBe(true);
    expect(record.composition).toMatchObject({
      schema: "afi.composition-ref.v1",
      pipelineId: "atlas-multi-branch",
      pipelineVersion: "v1.0.0",
      scorerPluginId: "afi-scorer-atlas-probe",
      scorerPluginVersion: "1.0.0",
    });
    expect(record.composition.manifestHash.value).toBe(ATLAS_MANIFEST_HASH);
    expect(record.composition.analystConfigHash.value).toBe(ATLAS_CONFIG_HASH);
    expect(record.composition.executionSummaryHash.domainTag).toBe("afi.d2.execution-summary");
    expect(record.composition.enrichmentHash.domainTag).toBe("afi.d2.enrichment-bundle");
    expect(record.uwrProfile).toEqual({
      profileId: "uwr-weighted-lifts-v0.1",
      status: "testnet-provisional",
      decisionRef: "afi-governance/decisions/uwr-profile-pin-v0.1.md",
      source: "builtin-value-identity",
    });
    // the composition pins differ from froggy's (a REAL second composition)
    expect(record.composition.manifestHash.value).not.toBe(
      "b8d9b73410ce8ec0d1827d75ee2a2e750aa85553fb2fc985a7a52fdb75080d49"
    );
  });

  it("resolves the full-form request 'atlas-probe/multi_branch_v1@1.0.0' and the binding default identically", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);

    const fullForm = await request(app)
      .post(TV)
      .send(
        atlasPayload({
          signalId: "atlas-proof-fullform-0001",
          strategy: "atlas-probe/multi_branch_v1@1.0.0",
        })
      );
    expect(fullForm.status).toBe(200);
    expect(fullForm.body.analystScore.analystId).toBe("atlas-probe");
    expect(fullForm.body.rawUss.facts.strategy).toBe("multi_branch_v1");

    // free text → the binding's defaultStrategy (atlas) — same composition
    const defaulted = await request(app)
      .post(TV)
      .send(
        atlasPayload({
          signalId: "atlas-proof-default-0001",
          strategy: "whatever the provider typed",
        })
      );
    expect(defaulted.status).toBe(200);
    expect(defaulted.body.analystScore.analystId).toBe("atlas-probe");
  });

  it("both registered strategies coexist: the froggy binding still resolves froggy through the SAME mechanism", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);
    const res = await request(app)
      .post(TV)
      .send(
        atlasPayload({
          signalId: "atlas-proof-froggy-0001",
          providerId: "tradingview-default",
          strategy: "trend_pullback_v1",
        })
      );
    expect(res.status).toBe(200);
    expect(res.body.analystScore.analystId).toBe("froggy");
    const record = store.records.get("atlas-proof-froggy-0001");
    expect(record.composition.pipelineId).toBe("froggy-trend-pullback");
    expect(record.composition.manifestHash.value).toBe(
      "b8d9b73410ce8ec0d1827d75ee2a2e750aa85553fb2fc985a7a52fdb75080d49"
    );
  });

  it("UNKNOWN identity fails closed: unregistered provider → 403 unknown_provider_binding", async () => {
    const res = await request(app)
      .post(TV)
      .send(atlasPayload({ providerId: "atlas-unknown-provider" }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("unknown_provider_binding");
  });

  it("UNAUTHORIZED identity fails closed: a binding must not reach a registered strategy outside its allowedStrategies", async () => {
    // tradingview-default's binding allows ONLY froggy; multi_branch_v1 IS
    // registered — naming it through this binding is an authorization
    // failure, never a fallback to the default.
    const bare = await request(app)
      .post(TV)
      .send(
        atlasPayload({ providerId: "tradingview-default", strategy: "multi_branch_v1" })
      );
    expect(bare.status).toBe(403);
    expect(bare.body.error).toBe("unauthorized_strategy");

    const fullForm = await request(app)
      .post(TV)
      .send(
        atlasPayload({
          providerId: "tradingview-default",
          strategy: "atlas-probe/multi_branch_v1@1.0.0",
        })
      );
    expect(fullForm.status).toBe(403);
    expect(fullForm.body.error).toBe("unauthorized_strategy");

    // and the atlas binding cannot reach froggy either (symmetric)
    const cross = await request(app)
      .post(TV)
      .send(atlasPayload({ strategy: "trend_pullback_v1" }));
    expect(cross.status).toBe(403);
    expect(cross.body.error).toBe("unauthorized_strategy");
  });
});
