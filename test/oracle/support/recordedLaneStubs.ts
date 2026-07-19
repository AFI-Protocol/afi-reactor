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
 * module, so the recorded bytes exist in exactly one place and the enriched
 * goldens, the invariance/replay proofs, and the error-table 200-rows all
 * see the identical recorded world.
 *
 * The technical lane (demo feed via the guarded seam) and the first-party
 * candlestick pattern lane run their REAL local kernels unmocked.
 */

import { jest } from "@jest/globals";
import type { ProviderAdapter } from "../../../src/providers/types.js";

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
  const row = {
    market_and_exchange_names: "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
    report_date_as_yyyy_mm_dd: "2026-01-13T00:00:00.000",
    lev_money_positions_long: "60000",
    lev_money_positions_short: "40000",
    open_interest_all: "100000",
    change_in_open_interest_all: "5000",
  };
  const fetchImpl = (async () =>
    ({ ok: true, status: 200, statusText: "OK", json: async () => [row] }) as Response) as typeof fetch;
  return cftcActual.createSentimentCftcCotAdapter({ fetchImpl });
}

/** Recorded EDGAR full-text hits + fixed clock (the real normalization runs). */
export function recordedNewsSecEdgarAdapter(): ProviderAdapter {
  const body = {
    hits: {
      hits: [
        {
          _source: {
            adsh: "0001234567-26-000123",
            ciks: ["0001234567"],
            display_names: ["Oracle Recorded Filer A (ORFA)"],
            root_forms: ["8-K"],
            file_date: "2026-01-15",
          },
        },
        {
          _source: {
            adsh: "0001234567-26-000122",
            ciks: ["0001234567"],
            display_names: ["Oracle Recorded Filer A (ORFA)"],
            root_forms: ["10-Q"],
            file_date: "2026-01-14",
          },
        },
      ],
    },
  };
  const fetchImpl = (async () =>
    ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response) as typeof fetch;
  return edgarActual.createNewsSecEdgarAdapter({
    fetchImpl,
    now: () => new Date("2026-01-15T12:00:00.000Z"),
  });
}

/** Recorded Tiny Brains prediction with the self-verifying D-EV3-3 invocation block. */
export function recordedAimlTinyBrainsAdapter(): ProviderAdapter {
  const payload = {
    convictionScore: 0.85,
    direction: "long" as const,
    regime: "bull",
    riskFlag: false,
    profileId: "froggy-reference-v1",
    profileVersion: "1.0.0",
  };
  const hex64 = "ab".repeat(32);
  const invocation = {
    record: "tiny-brains.aiml-invocation.v1" as const,
    profileId: payload.profileId,
    profileVersion: payload.profileVersion,
    resolverId: "froggy-agreement",
    resolverVersion: "1.0.0",
    codeConfigFingerprint: hex64,
    hashLaw: "tiny-brains.hash.v1" as const,
    inputHash: hex64,
    outputHash: tbHash.tinyBrainsHashPayload(payload, {
      floatKeys: tbHash.PREDICT_FROGGY_FLOAT_KEYS,
    }),
    status: "succeeded" as const,
    experts: [
      {
        expertId: "chronos-bolt-forecaster",
        expertVersion: "1.0.0",
        posture: "probabilistic" as const,
        status: "succeeded" as const,
        outputHash: hex64,
      },
      {
        expertId: "trend-baseline",
        expertVersion: "1.0.0",
        posture: "deterministic" as const,
        status: "succeeded" as const,
        outputHash: hex64,
      },
    ],
  };
  return aimlActual.createAimlTinyBrainsAdapter({
    callService: (async () => ({ ...payload, invocation })) as never,
  });
}
