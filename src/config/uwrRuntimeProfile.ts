/**
 * PR-UWR-RUNTIME-READ — flag-gated runtime read of the registered UWR profile.
 *
 * Authorized by afi-governance `decisions/uwr-runtime-consumption-v0.1.md`
 * §7 row PR-UWR-RUNTIME-READ (flipped by owner merge of afi-governance
 * PR #12 per RC-12). This file is the SINGLE AUTHORIZED LOADER MODULE named
 * under RC-7 grant (1): only here may reactor source reference the
 * uwr-profiles registry path. Guardrails: the amended scan in
 * test/guardrails/uwrProfileStamp.test.ts bans the registry path everywhere
 * else under src/, and test/guardrails/uwrRuntimeProfile.test.ts
 * additionally bans any reference to this module (or its exported path
 * constant) from the D2 pipehead/CLI surfaces and bans path-constant
 * imports that would bypass the string scan.
 *
 * Behavior (RC-3/RC-4):
 * - Source selection is explicit via the AFI_UWR_PROFILE_SOURCE env flag:
 *   "builtin" (DEFAULT — today's behavior, no file read whatsoever) or
 *   "registry". Any other value refuses to score: the flag cannot be
 *   enabled by accident. The resolved source is logged in both modes at
 *   first resolution (the composition root resolves once per process).
 * - In registry mode the composition root reads the pinned registry
 *   document through the afi-config file: dependency, parses it, and
 *   validates it with afi-core's PURE `loadUwrProfile` — which enforces the
 *   RC-5 identity predicate (weights strictly equal `defaultUwrConfig`'s;
 *   axes exact; profileId pinned; supersedes = "uwr-default-stub"). That
 *   predicate IS the permanent v0.1 value-identity cross-check: a passing
 *   load is provably behavior-neutral, and the returned config's weight
 *   values are `defaultUwrConfig`'s own by construction.
 * - FAIL-CLOSED, NO SILENT FALLBACK (RC-4): a missing/unreadable file, a
 *   parse error, or any RC-5 refusal throws; registry mode never quietly
 *   degrades to the builtin config.
 *
 * Path resolution follows the repo's proven schema-load precedent
 * (src/pipeheads/provenance/schemaValidation.ts et al.):
 * join(process.cwd(), "node_modules/afi-config/…") through the file:
 * dependency. The ledger row prefers cwd-independent resolution;
 * import.meta-anchored resolution is deliberately NOT used here because its
 * behavior under this repo's ts-jest ESM transform is unproven, while the
 * cwd-anchored precedent is exercised by the existing pipehead suites. A
 * registry-mode process launched from a different cwd fails CLOSED (never
 * silently scores). The `registryPath` override exists for tests (and for a
 * future authorized cleanup to cwd-independence).
 *
 * Boundaries: the persisted stamp (src/config/uwrProfilePin.ts) is NOT
 * changed by this module — stamp semantics remain value-identity metadata
 * until PR-UWR-STAMP-SEMANTICS is separately authorized (its §7 row is
 * still "No"). Nothing here wires qualification, reward, mint, or
 * settlement; nothing changes scoring outputs (value identity is enforced,
 * not assumed); UP-8 stays open; everything is testnet-provisional.
 */

import * as fs from "node:fs";
import { join } from "node:path";
import {
  loadUwrProfile,
  UwrProfileLoadError,
} from "afi-core/validators/UwrProfileLoader.js";
import {
  defaultUwrConfig,
  type UniversalWeightingRuleConfig,
} from "afi-core/validators/UniversalWeightingRule.js";

/** The explicit source-selection flag (RC-3 proposed name, accepted). */
export const UWR_PROFILE_SOURCE_ENV = "AFI_UWR_PROFILE_SOURCE";

/** The two recognized sources. Anything else refuses to score. */
export type UwrProfileSource = "builtin" | "registry";

/**
 * Registry document location through the afi-config file: dependency —
 * the RC-9-sanctioned raw-file-read mechanism. This module is the only
 * src/ file allowed to carry this path (RC-7 grant 1), and a guardrail
 * bans other src/ files from importing this constant to do their own read.
 */
export const UWR_REGISTRY_RELATIVE_PATH =
  "node_modules/afi-config/registries/uwr-profiles/uwr-weighted-lifts-v0.1.json";

/** Machine-checkable refusal reasons for failures OUTSIDE the RC-5 predicate
 * (predicate refusals keep afi-core's UwrProfileLoadError + reason). */
export type UwrRuntimeProfileErrorReason =
  | "invalid-source-flag"
  | "registry-unreadable"
  | "registry-parse-error";

/** Fail-closed error for flag/IO/parse failures. Never swallowed here. */
export class UwrRuntimeProfileError extends Error {
  readonly reason: UwrRuntimeProfileErrorReason;

  constructor(reason: UwrRuntimeProfileErrorReason, detail: string) {
    super(
      `UWR runtime profile resolution refused (${reason}): ${detail} — ` +
        `refusing to score (fail-closed, no fallback; RC-4).`
    );
    this.name = "UwrRuntimeProfileError";
    this.reason = reason;
  }
}

/** What the composition root receives: the config plus its provenance. */
export interface ResolvedUwrRuntimeConfig {
  /** Which source produced the config. NOT persisted-stamp semantics —
   * stamp changes await PR-UWR-STAMP-SEMANTICS. */
  source: UwrProfileSource;
  /** Value-identical to defaultUwrConfig by RC-5 (registry) or identity (builtin). */
  config: Readonly<UniversalWeightingRuleConfig>;
}

/**
 * Parse the source flag. Unset/empty → "builtin" (the default stays the
 * default). Exactly "builtin" or "registry" are accepted; any other value
 * throws — an explicit misconfiguration must never silently score.
 */
export function resolveUwrProfileSource(
  env: Record<string, string | undefined> = process.env
): UwrProfileSource {
  const raw = env[UWR_PROFILE_SOURCE_ENV];
  if (raw === undefined || raw === "") return "builtin";
  if (raw === "builtin" || raw === "registry") return raw;
  throw new UwrRuntimeProfileError(
    "invalid-source-flag",
    `${UWR_PROFILE_SOURCE_ENV}="${raw}" is not a recognized source ` +
      `(expected "builtin" or "registry")`
  );
}

/**
 * Resolve the runtime UWR config from the selected source.
 *
 * builtin: returns afi-core's `defaultUwrConfig` — no file read occurs.
 * registry: reads + parses the pinned registry document and validates it
 * through afi-core `loadUwrProfile` (RC-5 predicate = permanent v0.1
 * value-identity cross-check). Every failure throws; there is no fallback.
 * The resolved source is logged in both modes (RC-3).
 */
export function resolveUwrRuntimeConfig(options?: {
  env?: Record<string, string | undefined>;
  /** Test/override hook; defaults to the file:-dependency registry path. */
  registryPath?: string;
}): ResolvedUwrRuntimeConfig {
  const source = resolveUwrProfileSource(options?.env ?? process.env);

  if (source === "builtin") {
    console.info(
      `[uwr-runtime-profile] source=builtin (default scoring config ` +
        `"${defaultUwrConfig.id}"; registry not read)`
    );
    return { source, config: defaultUwrConfig };
  }

  const registryPath =
    options?.registryPath ?? join(process.cwd(), UWR_REGISTRY_RELATIVE_PATH);

  let rawBytes: string;
  try {
    rawBytes = fs.readFileSync(registryPath, "utf8");
  } catch (error) {
    throw new UwrRuntimeProfileError(
      "registry-unreadable",
      `cannot read the UWR profile registry at "${registryPath}" ` +
        `(${error instanceof Error ? error.message : String(error)})`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBytes);
  } catch (error) {
    throw new UwrRuntimeProfileError(
      "registry-parse-error",
      `the UWR profile registry at "${registryPath}" is not valid JSON ` +
        `(${error instanceof Error ? error.message : String(error)})`
    );
  }

  // RC-5 identity predicate — afi-core's pure loader refuses anything that
  // is not the pinned, value-identical profile (UwrProfileLoadError with a
  // machine-checkable reason propagates untouched).
  const config = loadUwrProfile(parsed);

  console.info(
    `[uwr-runtime-profile] source=registry profileId=${config.id} ` +
      `path=${registryPath} (RC-5 value-identity verified; scoring values ` +
      `remain identical to the builtin config by construction)`
  );

  return { source, config };
}

let memoized: ResolvedUwrRuntimeConfig | undefined;

/**
 * Composition-root accessor: only a SUCCESSFUL resolution is cached (once
 * per process). Failures are never cached and never fall back: each call
 * re-attempts resolution and every failed attempt throws (RC-4), so no
 * score is ever produced from a bad state; scoring can begin only after a
 * fully valid resolution succeeds.
 */
export function getUwrRuntimeConfigOnce(): ResolvedUwrRuntimeConfig {
  if (!memoized) {
    memoized = resolveUwrRuntimeConfig();
  }
  return memoized;
}

/** TEST-ONLY: clear the memoized resolution (env changes between tests). */
export function __resetUwrRuntimeConfigForTests(): void {
  memoized = undefined;
}

export { UwrProfileLoadError };
