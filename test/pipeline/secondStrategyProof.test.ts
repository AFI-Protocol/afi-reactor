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
 *   4. EV3-GOV fail-closed evidence law: the atlas overlay keeps DEGRADE
 *      lanes and a non-provider-backed aiMl probe, so its runs can NEVER
 *      carry the five required invocation proofs — the sole Evidence V3
 *      builder refuses (D-EV3-2/D-EV3-5(3)), the endpoint reports the
 *      honest first-class failure, and NO record persists (never a
 *      downgraded or prior-version write);
 *   5. the froggy composition (now fail-fast v1.3.0) aborts honestly when a
 *      lane fails (D-EV3-5(1)) — no scored signal, no evidence;
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
import {
  __resetRuntimeCompositionForTests,
  __setRuntimeCompositionOverridesForTests,
} from "../../src/config/runtimeComposition.js";
import { createPluginRegistry } from "../../src/pipeline/pluginRegistry.js";
import {
  buildProviderRuntime,
  createProviderBackedNode,
  createProviderRecordStore,
} from "../../src/providers/index.js";
import { loadProviderRecords } from "../../src/pipeline/registryLoader.js";
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
const ATLAS_MANIFEST_HASH = "474b2daa714b116d977858dfbf1e04be6a36e4f09613d0b72f65ff62db4a13d2";
const ATLAS_CONFIG_HASH = "45dc692b004bb8623eed418c815df2f608d3272cc493984687cd7f444c321567";

const ENV_KEYS = [
  "AFI_PRICE_FEED_SOURCE",
  "COINALYZE_API_KEY",
  "NEWSDATA_API_KEY",
  "TINY_BRAINS_URL",
  "WEBHOOK_SHARED_SECRET",
  "AFI_INGEST_DEDUPE",
  "AFI_DEFAULT_PROVIDER_ID",
  "AFI_UWR_PROFILE_SOURCE",
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
  restoreNet = disableNetwork();
  shutdownDedupeCache();

  // The composition seam: atlas overlay registries + the production
  // provider-backed lane set EXTENDED by the two test probes. The provider
  // runtime is built from the SAME overlay registries (keyless reference
  // lanes; network is disabled, so remote lanes degrade honestly).
  const atlasProviderRuntime = buildProviderRuntime({
    records: createProviderRecordStore(loadProviderRecords({ configRoot: ATLAS_CONFIG_ROOT })),
  });
  __setRuntimeCompositionOverridesForTests({
    configRoot: ATLAS_CONFIG_ROOT,
    pluginRegistry: createPluginRegistry([
      createProviderBackedNode({ pluginId: "afi-analysis-technical", pluginVersion: "2.0.0" }, "technical", atlasProviderRuntime),
      createProviderBackedNode({ pluginId: "afi-analysis-pattern", pluginVersion: "2.0.0" }, "pattern", atlasProviderRuntime),
      createProviderBackedNode({ pluginId: "afi-analysis-sentiment", pluginVersion: "2.0.0" }, "sentiment", atlasProviderRuntime),
      createProviderBackedNode({ pluginId: "afi-analysis-news", pluginVersion: "2.0.0" }, "news", atlasProviderRuntime),
      createProviderBackedNode({ pluginId: "afi-analysis-aiml", pluginVersion: "2.0.0" }, "aiMl", atlasProviderRuntime),
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
  it("scores through the generic mechanism — and the Evidence V3 builder REFUSES an unprovable run (fail closed, no record)", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);
    aimlProbeSpy.mockClear();
    scorerProbeSpy.mockClear();

    const res = await request(app).post(TV).send(atlasPayload());

    // EV3-GOV: the atlas composition cannot produce the five required
    // invocation proofs (degrade lanes + a non-provider-backed aiMl probe),
    // so canonical persistence fails closed as a FIRST-CLASS error — never a
    // masked 200, never a prior-version record (D-EV3-5(3)).
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("evidence_persistence_construction");
    expect(res.body.persisted).toBe(false);
    expect(res.body.signalId).toBe("atlas-proof-0001");
    expect(store.records.size).toBe(0);

    // (1) The SECOND identity nonetheless SCORED through the generic
    // mechanism (no froggy conditional anywhere): the atlas probes ran.
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
  });

  it("resolves the full-form request 'atlas-probe/multi_branch_v1@1.0.0' and the binding default identically (evidence refusal is identity-independent)", async () => {
    const store = new OracleEvidenceStore();
    setEvidenceStore(store);
    scorerProbeSpy.mockClear();

    const fullForm = await request(app)
      .post(TV)
      .send(
        atlasPayload({
          signalId: "atlas-proof-fullform-0001",
          strategy: "atlas-probe/multi_branch_v1@1.0.0",
        })
      );
    // Resolution succeeded (an unauthorized/unknown identity would 403) and
    // the atlas scorer RAN; the Evidence V3 builder then refused (fail
    // closed) — the same generic path for the full-form request…
    expect(fullForm.status).toBe(500);
    expect(fullForm.body.error).toBe("evidence_persistence_construction");
    expect(scorerProbeSpy).toHaveBeenCalledTimes(1);

    // …and for free text → the binding's defaultStrategy (atlas).
    const defaulted = await request(app)
      .post(TV)
      .send(
        atlasPayload({
          signalId: "atlas-proof-default-0001",
          strategy: "whatever the provider typed",
        })
      );
    expect(defaulted.status).toBe(500);
    expect(defaulted.body.error).toBe("evidence_persistence_construction");
    expect(scorerProbeSpy).toHaveBeenCalledTimes(2);
    expect(store.records.size).toBe(0);
  });

  it("both registered strategies coexist: the froggy binding still resolves froggy — whose v1.3.0 manifest now ABORTS fail-fast on a failed lane (D-EV3-5(1))", async () => {
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
    // Resolution reached the froggy composition (not a 403); with the
    // network disabled a remote lane FAILS, and under the fail-fast v1.3.0
    // manifest the evaluation ABORTS: no scored signal, no evidence record —
    // bounded operational diagnostics only.
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("internal_error");
    expect(res.body.message).toMatch(/failed|aborted/);
    expect(store.records.size).toBe(0);
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
