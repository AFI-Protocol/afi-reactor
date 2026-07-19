/**
 * ORACLE-EQUIVALENCE — the ONE set of recorded remote-lane transports.
 *
 * Fixed, committed-in-code stubs for the three REMOTE reference lanes,
 * injected at the exact adapter singleton seams the provider runtime
 * registers (the five-lane provider runtime, FLPR-GOV):
 *
 *   - sentimentCftcCotAdapter → recorded CFTC COT report row (the adapter's
 *     real derivation math runs on it);
 *   - newsSecEdgarAdapter → recorded EDGAR full-text hits + a fixed clock
 *     (the adapter's real normalization runs on them);
 *   - aimlTinyBrainsAdapter → recorded Tiny Brains prediction carrying the
 *     D-EV3-3 `invocation` block, its outputHash the REAL tiny-brains.hash.v1
 *     recomputation over the recorded payload (self-verifying fixture).
 *
 * Under froggy-trend-pullback v1.3.0 every lane is CRITICAL (EV3-GOV
 * D-EV3-5(1)) — every oracle suite that drives a scored 200 through the live
 * path installs these stubs via jest.mock factories that requireActual this
 * module. The recorded BYTES live in exactly one place —
 * support/recordedLaneData.ts (also consumed by the compiled-build
 * real-MongoDB equivalence proof, which cannot use jest module mapping) — so
 * the enriched goldens, the invariance/replay proofs, the error-table
 * 200-rows, and the compiled-build proof all see the identical recorded
 * world.
 *
 * The technical lane (demo feed via the guarded seam) and the first-party
 * candlestick pattern lane run their REAL local kernels unmocked.
 */

import { jest } from "@jest/globals";
import type { ProviderAdapter } from "../../../src/providers/types.js";
import {
  RECORDED_CFTC_COT_ROW,
  RECORDED_EDGAR_CLOCK_ISO,
  RECORDED_EDGAR_FULL_TEXT_BODY,
  RECORDED_TINY_BRAINS_EXPERTS,
  RECORDED_TINY_BRAINS_HEX64,
  RECORDED_TINY_BRAINS_PREDICTION,
} from "./recordedLaneData.js";

const cftcActual = jest.requireActual(
  "../../../src/providers/adapters/sentimentCftcCotAdapter.js"
) as typeof import("../../../src/providers/adapters/sentimentCftcCotAdapter.js");
const edgarActual = jest.requireActual(
  "../../../src/providers/adapters/newsSecEdgarAdapter.js"
) as typeof import("../../../src/providers/adapters/newsSecEdgarAdapter.js");
const aimlActual = jest.requireActual(
  "../../../src/providers/adapters/aimlTinyBrainsAdapter.js"
) as typeof import("../../../src/providers/adapters/aimlTinyBrainsAdapter.js");
const tbHash = jest.requireActual(
  "../../../src/providers/clients/tinyBrainsHashV1.js"
) as typeof import("../../../src/providers/clients/tinyBrainsHashV1.js");

/** Recorded CFTC COT row (BTC listed market; the real derivation runs on it). */
export function recordedSentimentCftcCotAdapter(): ProviderAdapter {
  const fetchImpl = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [RECORDED_CFTC_COT_ROW],
    }) as Response) as typeof fetch;
  return cftcActual.createSentimentCftcCotAdapter({ fetchImpl });
}

/** Recorded EDGAR full-text hits + fixed clock (the real normalization runs). */
export function recordedNewsSecEdgarAdapter(): ProviderAdapter {
  const fetchImpl = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => RECORDED_EDGAR_FULL_TEXT_BODY,
    }) as Response) as typeof fetch;
  return edgarActual.createNewsSecEdgarAdapter({
    fetchImpl,
    now: () => new Date(RECORDED_EDGAR_CLOCK_ISO),
  });
}

/** Recorded Tiny Brains prediction with the self-verifying D-EV3-3 invocation block. */
export function recordedAimlTinyBrainsAdapter(): ProviderAdapter {
  const payload = RECORDED_TINY_BRAINS_PREDICTION;
  const invocation = {
    record: "tiny-brains.aiml-invocation.v1" as const,
    profileId: payload.profileId,
    profileVersion: payload.profileVersion,
    resolverId: "froggy-agreement",
    resolverVersion: "1.0.0",
    codeConfigFingerprint: RECORDED_TINY_BRAINS_HEX64,
    hashLaw: "tiny-brains.hash.v1" as const,
    inputHash: RECORDED_TINY_BRAINS_HEX64,
    outputHash: tbHash.tinyBrainsHashPayload(payload, {
      floatKeys: tbHash.PREDICT_FROGGY_FLOAT_KEYS,
    }),
    status: "succeeded" as const,
    experts: RECORDED_TINY_BRAINS_EXPERTS.map((e) => ({ ...e })),
  };
  return aimlActual.createAimlTinyBrainsAdapter({
    callService: (async () => ({ ...payload, invocation })) as never,
  });
}
