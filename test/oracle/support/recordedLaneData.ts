/**
 * ORACLE-EQUIVALENCE — the ONE copy of the recorded remote-lane bytes.
 *
 * Plain data only (no jest, no adapter imports): the fixed, committed-in-code
 * recorded transports' response bytes + declared evaluation clock shared by
 *
 *   - test/oracle/support/recordedLaneStubs.ts (the jest singleton-seam
 *     stubs every oracle suite installs via jest.mock factories), and
 *   - the COMPILED-build real-MongoDB equivalence proof
 *     (test/oracle/oracleMongoEquivalence.mjs) plus its Tiny Brains HTTP stub
 *     (test/integration-mongo/support/tinyBrainsStub.mjs), which cannot use
 *     jest module mapping and load this module via Node's native type
 *     stripping instead.
 *
 * Keeping the bytes here — and ONLY here — means the committed enriched
 * goldens, the jest oracle suites, and the compiled-build byte-equivalence
 * proof all see the identical recorded world. This module must stay
 * dependency-free and erasable-syntax-only (Node type stripping).
 */

/** Recorded CFTC COT row (BTC listed market; the real derivation runs on it). */
export const RECORDED_CFTC_COT_ROW = {
  market_and_exchange_names: "BITCOIN - CHICAGO MERCANTILE EXCHANGE",
  report_date_as_yyyy_mm_dd: "2026-01-13T00:00:00.000",
  lev_money_positions_long: "60000",
  lev_money_positions_short: "40000",
  open_interest_all: "100000",
  change_in_open_interest_all: "5000",
} as const;

/** Recorded EDGAR full-text search hits (the real normalization runs on them). */
export const RECORDED_EDGAR_FULL_TEXT_BODY = {
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
} as const;

/** The declared evaluation clock the recorded EDGAR window/age math ran under. */
export const RECORDED_EDGAR_CLOCK_ISO = "2026-01-15T12:00:00.000Z";

/** The recorded opaque hex-64 boundary commitments (fixed fixture digests). */
export const RECORDED_TINY_BRAINS_HEX64 = "ab".repeat(32);

/**
 * Recorded Tiny Brains prediction payload (EXCLUSIVE of the invocation block;
 * its tiny-brains.hash.v1 recomputation is the block's outputHash). The
 * profileId mirrors the governed reference instance's `model` field — the
 * profile every oracle scored run requests.
 */
export const RECORDED_TINY_BRAINS_PREDICTION = {
  convictionScore: 0.85,
  direction: "long",
  regime: "bull",
  riskFlag: false,
  profileId: "froggy-reference-v1",
  profileVersion: "1.0.0",
} as const;

/** Recorded expert roster (sorted ascending by expertId; no artifact pins). */
export const RECORDED_TINY_BRAINS_EXPERTS = [
  {
    expertId: "chronos-bolt-forecaster",
    expertVersion: "1.0.0",
    posture: "probabilistic",
    status: "succeeded",
    outputHash: RECORDED_TINY_BRAINS_HEX64,
  },
  {
    expertId: "trend-baseline",
    expertVersion: "1.0.0",
    posture: "deterministic",
    status: "succeeded",
    outputHash: RECORDED_TINY_BRAINS_HEX64,
  },
] as const;
