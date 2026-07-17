/**
 * ORACLE-EQUIVALENCE shared harness (test-only).
 *
 * Freezes the CURRENT live Reactor behavior as committed goldens so the
 * upcoming manifest-driven executor can be proven byte-equivalent. Provides:
 *
 *   - deterministic environment installation (demo price feed, external
 *     providers OFF, no dedupe, no webhook secret);
 *   - an in-memory evidence store that MIRRORS afi-infra's
 *     MongoScoredSignalEvidenceStore submit semantics (insert /
 *     idempotent-duplicate on byte-identical content / IDEMPOTENCY_CONFLICT
 *     on differing content for the same signalId) and CAPTURES the exact
 *     governed record the server seam submits;
 *   - volatile-clock normalization ('<CLOCK>') for the ONLY nondeterministic
 *     surfaces (scoredAt / ingestedAt / enrichedAt …);
 *   - golden read/compare/write. Goldens are committed files under
 *     test/oracle/goldens/ and MUST only ever be rewritten via the sanctioned
 *     regeneration path: `npm run oracle:regen` (sets UPDATE_ORACLE_GOLDENS=1).
 *     Any other write path is a process violation — a behavior change must be
 *     reviewed as a golden diff, never silently absorbed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EvidenceStorePort, EvidenceSubmitResult } from "../../../src/evidence/submitScoredSignalEvidence.js";
import { VOLATILE_TIMESTAMP_KEYS } from "../../../src/pipeheads/provenance/canonicalHashV1.js";
import {
  __resetRuntimeCompositionForTests,
  __setRuntimeCompositionOverridesForTests,
} from "../../../src/config/runtimeComposition.js";
import { registerPriceFeedAdapterForTests } from "../../../src/adapters/exchanges/priceFeedRegistry.js";
import { demoPriceFeedAdapter } from "../../support/deterministicPriceFeedAdapter.js";

/** Jest runs from the repo root (repo idiom — see test/pipeheads/*.test.ts). */
export const GOLDENS_DIR = path.resolve(process.cwd(), "test/oracle/goldens");
export const FIXTURES_DIR = path.resolve(process.cwd(), "test/oracle/fixtures");

/**
 * The oracle's registry-root OVERLAY (test-only): byte-equal copies of the
 * official froggy registries PLUS the oracle-fixture provider bindings
 * (oracle-provider-tv-webhook for the committed TV fixtures' providerId,
 * oracle-no-default-webhook for the unauthorized-strategy error row) and the
 * registration amended to admit them. Production resolution reads
 * node_modules/afi-config — the overlay exists ONLY so the committed oracle
 * fixtures resolve without registering test providers in the governed
 * registries.
 */
export const ORACLE_CONFIG_ROOT = path.resolve(
  process.cwd(),
  "test/oracle/fixtures/afi-config"
);

/** The sanctioned regeneration flag. Set ONLY by `npm run oracle:regen`. */
export const REGEN_ENV = "UPDATE_ORACLE_GOLDENS";

/**
 * Volatile wall-clock keys normalized out of goldens. Superset of the
 * canonical afi.hash.v1 volatile-key list (the hash doctrine's own list is
 * imported, not copied) plus response-surface-only clock keys.
 */
const VOLATILE_KEYS: ReadonlySet<string> = new Set([
  ...VOLATILE_TIMESTAMP_KEYS,
  "enrichedAt",
  "firstSeenAt",
]);

export const CLOCK_TOKEN = "<CLOCK>";

/**
 * Recursively replace volatile clock values with the CLOCK token (and drop
 * functions/undefined via JSON semantics). scoredAt is NOT injectable in the
 * live path — normalizing it out is the governed way to freeze everything
 * else byte-exactly.
 */
export function normalizeVolatile<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v) =>
      VOLATILE_KEYS.has(key) && typeof v === "string" ? CLOCK_TOKEN : v
    )
  );
}

/** Recursive key-sorted stringify — mirrors afi-infra's stableStringify, so the
 *  in-memory store's idempotency/conflict discrimination matches the real store. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Deterministic, human-diffable golden serialization: recursively key-sorted,
 *  2-space indented, trailing newline. Byte-stable for identical content. */
export function serializeGolden(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, sort(x)])
      );
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/**
 * Compare `value` against the committed golden at goldens/<relName>.
 * Under `npm run oracle:regen` (UPDATE_ORACLE_GOLDENS=1) the golden is
 * (re)written first — the ONLY sanctioned way goldens ever change.
 */
export function expectGolden(relName: string, value: unknown): void {
  const file = path.join(GOLDENS_DIR, relName);
  const serialized = serializeGolden(value);
  if (process.env[REGEN_ENV] === "1") {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, serialized, "utf8");
  }
  if (!existsSync(file)) {
    throw new Error(
      `Oracle golden missing: ${path.relative(process.cwd(), file)}. ` +
        `Goldens are committed behavioral baselines; generate them ONLY via 'npm run oracle:regen' ` +
        `and review the diff as a behavior change.`
    );
  }
  const golden = readFileSync(file, "utf8");
  expect(serialized).toBe(golden);
}

export function loadFixture(relName: string): any {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, relName), "utf8"));
}

/**
 * In-memory evidence store that mirrors the REAL afi-infra store's submit
 * semantics (MongoScoredSignalEvidenceStore.submit — normalize to
 * recordVersion 1, insert-once keyed on signalId, byte-identical resubmit →
 * idempotent-duplicate, differing content → code IDEMPOTENCY_CONFLICT) and
 * captures every submitted governed record for golden assertions.
 */
export class OracleEvidenceStore implements EvidenceStorePort {
  readonly records = new Map<string, any>();
  readonly submissions: any[] = [];

  async submit(record: any): Promise<EvidenceSubmitResult> {
    const canonical = { ...record, recordVersion: record.recordVersion ?? 1 };
    this.submissions.push(JSON.parse(JSON.stringify(canonical)));
    const existing = this.records.get(canonical.signalId);
    if (existing) {
      if (stableStringify(existing) === stableStringify(canonical)) {
        return {
          outcome: "idempotent-duplicate",
          signalId: canonical.signalId,
          recordVersion: existing.recordVersion ?? 1,
        } as EvidenceSubmitResult;
      }
      const err = new Error(
        `A different canonical record already exists for signalId '${canonical.signalId}' (append-once).`
      ) as Error & { code: string };
      err.code = "IDEMPOTENCY_CONFLICT";
      throw err;
    }
    this.records.set(canonical.signalId, JSON.parse(JSON.stringify(canonical)));
    return {
      outcome: "inserted",
      signalId: canonical.signalId,
      recordVersion: 1,
    } as EvidenceSubmitResult;
  }
}

/** A store whose submissions always fail like an unreachable MongoDB (the
 *  afi-infra store surfaces that as code PERSISTENCE_FAILURE → honest 503). */
export class UnavailableEvidenceStore implements EvidenceStorePort {
  async submit(): Promise<EvidenceSubmitResult> {
    const err = new Error("oracle: canonical store unavailable (simulated Mongo down)") as Error & {
      code: string;
    };
    err.code = "PERSISTENCE_FAILURE";
    throw err;
  }
}

/**
 * Install the deterministic oracle environment (call in beforeAll, AFTER the
 * server module — and its dotenv side effect — has been imported):
 *   - AFI_PRICE_FEED_SOURCE=demo (deterministic synthetic candles);
 *   - every external provider OFF (fail-soft defaults exercised);
 *   - no webhook secret, no ingest dedupe, no provider-id override.
 * Returns a restore function for afterAll.
 */
export function installOracleEnv(): () => void {
  const KEYS = [
    "AFI_PRICE_FEED_SOURCE",
    "COINALYZE_API_KEY",
    "NEWS_PROVIDER",
    "NEWSDATA_API_KEY",
    "NEWS_WINDOW_HOURS",
    "TINY_BRAINS_URL",
    "WEBHOOK_SHARED_SECRET",
    "AFI_INGEST_DEDUPE",
    "AFI_DEFAULT_PROVIDER_ID",
    "AFI_UWR_PROFILE_SOURCE",
    "PATTERN_REGIME_PROVIDER",
    "AFI_DEBUG_NEWS",
    "AFI_DEBUG_AIML",
  ] as const;
  const saved = new Map<string, string | undefined>();
  for (const k of KEYS) saved.set(k, process.env[k]);

  for (const k of KEYS) delete process.env[k];
  // The synthetic feed no longer exists in production source: inject the
  // byte-stable deterministic adapter through the guarded test seam and
  // select it explicitly (same id — goldens stay byte-identical).
  const unregisterDemoFeed = registerPriceFeedAdapterForTests(demoPriceFeedAdapter);
  process.env.AFI_PRICE_FEED_SOURCE = "demo";
  // The regime-candle provider defaults to LIVE blofin (via ccxt, not fetch) —
  // engage its explicit kill-switch so the oracle is hermetic even where the
  // runner has network access. "off" and a failed live fetch produce the same
  // deterministic "unknown" regime summary (patternRegimeProfile fail-soft).
  process.env.PATTERN_REGIME_PROVIDER = "off";

  // Point the boot-validated runtime composition at the oracle overlay root
  // (the committed fixtures' provider bindings). Same builtin plugin registry
  // as production; only the registry ROOT differs (test seam).
  __setRuntimeCompositionOverridesForTests({ configRoot: ORACLE_CONFIG_ROOT });

  return () => {
    unregisterDemoFeed();
    __resetRuntimeCompositionForTests();
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

/**
 * Disable ALL outbound HTTP for the suite (global fetch rejects). Every
 * network-reaching enrichment seam (Coinalyze, NewsData, Tiny Brains, regime
 * candles, Fear & Greed) uses global fetch, so this pins the REAL fail-soft
 * code paths deterministically — identical to running with no network.
 * supertest is unaffected (it drives the Express app directly).
 * Returns a restore function for afterAll.
 */
export function disableNetwork(): () => void {
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = () =>
    Promise.reject(new Error("oracle: external network disabled (deterministic suite)"));
  return () => {
    (globalThis as any).fetch = realFetch;
  };
}
