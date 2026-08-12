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
 * constant) from the D2 evidence/provenance surfaces and bans path-constant
 * imports that would bypass the string scan.
 *
 * Behavior (RC-3/RC-4):
 * - Source selection is explicit via the AFI_UWR_PROFILE_SOURCE env flag:
 *   "builtin" (DEFAULT — today's behavior, no file read whatsoever) or
 *   "registry". Unset or empty resolves to "registry" (CFG-GOV D-CFG-4(2)
 *   flips RC-3's default). Any other value refuses to score: the flag cannot
 *   be enabled by accident. The resolved source is logged in both modes.
 * - In registry mode the caller reads the registry document that the strategy
 *   registration's uwrProfileRef names, parses it, and validates it with
 *   afi-core's PURE `loadUwrProfile` — which under D-CFG-4(1) checks schema
 *   id, axis registry content and order, exact weight keying and finiteness,
 *   and that the document declares the profileId the registration named.
 *   RC-5's identity predicate is RETIRED: the returned config carries the
 *   DOCUMENT's own weight values, so a registry load is no longer
 *   behaviour-neutral by construction.
 * - Resolution is PER STRATEGY, not per process (D-CFG-4(4)). There is no
 *   singleton; successful resolutions are cached per (source, profileId).
 * - FAIL-CLOSED, NO SILENT FALLBACK (RC-4, retained in full by D-CFG-4(1)):
 *   a missing/unreadable file, a parse error, an unsafe profile id, or any
 *   loader refusal throws; registry mode never quietly degrades to builtin.
 *
 * Path resolution follows the repo's proven schema-load precedent
 * (src/evidence/provenance/schemaValidation.ts et al.):
 * join(process.cwd(), "node_modules/afi-config/…") through the file:
 * dependency. The ledger row prefers cwd-independent resolution;
 * import.meta-anchored resolution is deliberately NOT used here because its
 * behavior under this repo's ts-jest ESM transform is unproven, while the
 * cwd-anchored precedent is exercised by the existing D2 suites. A
 * registry-mode process launched from a different cwd fails CLOSED (never
 * silently scores). The `registryPath` override exists for tests (and for a
 * future authorized cleanup to cwd-independence).
 *
 * Boundaries: this module resolves { source, config } and nothing else.
 * The persisted stamp (src/config/uwrProfilePin.ts) consumes the resolved
 * source by EXPLICIT propagation through the composition path
 * (PR-UWR-STAMP-SEMANTICS, §7 row flipped via afi-governance PR #13,
 * merge 6b3638b; RC-6) — the stamp site never calls back into this module
 * or re-reads the flag. Nothing here wires qualification, reward, mint, or
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
 * Registry DIRECTORY through the afi-config file: dependency — the
 * RC-9-sanctioned raw-file-read mechanism. This module is the only src/ file
 * allowed to carry this path (RC-7 grant 1), and a guardrail bans other src/
 * files from importing it to do their own read.
 *
 * D-CFG-4(4): resolution is per strategy, so the location is a directory and
 * the document is selected by the profile id the registration names.
 */
export const UWR_REGISTRY_RELATIVE_DIR =
  "node_modules/afi-config/registries/uwr-profiles";

/**
 * Registry document path for a profile id. Refuses separators and traversal:
 * the id comes from a registration and must never be able to address a file
 * outside the registry directory.
 */
export function uwrRegistryPathFor(profileId: string, dir: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(profileId)) {
    throw new UwrRuntimeProfileError(
      "invalid-profile-id",
      `profileId "${profileId}" is not a safe registry document name`
    );
  }
  return join(dir, `${profileId}.json`);
}

/** Machine-checkable refusal reasons for failures OUTSIDE afi-core's loader
 * (loader refusals keep afi-core's UwrProfileLoadError + reason). */
export type UwrRuntimeProfileErrorReason =
  | "invalid-source-flag"
  | "invalid-profile-id"
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
  /** The resolved configuration. Under D-CFG-4(1) a registry document's OWN
   * weight values flow into this config — it is no longer value-identical to
   * defaultUwrConfig by construction. */
  config: Readonly<UniversalWeightingRuleConfig>;
}

/**
 * Parse the source flag. Unset/empty → "registry" (D-CFG-4(2) flips RC-3's
 * default; RC-3 had reserved the flip to "a separate future decision" and
 * CFG-GOV is that decision). Exactly "builtin" or "registry" are accepted;
 * any other value throws — an explicit misconfiguration must never silently
 * score. The explicit "builtin" branch keeps its RC-3 semantics unchanged.
 */
export function resolveUwrProfileSource(
  env: Record<string, string | undefined> = process.env
): UwrProfileSource {
  const raw = env[UWR_PROFILE_SOURCE_ENV];
  // D-CFG-4(2): RC-3's default flips to "registry".
  if (raw === undefined || raw === "") return "registry";
  if (raw === "builtin" || raw === "registry") return raw;
  throw new UwrRuntimeProfileError(
    "invalid-source-flag",
    `${UWR_PROFILE_SOURCE_ENV}="${raw}" is not a recognized source ` +
      `(expected "builtin" or "registry")`
  );
}

/**
 * Resolve the runtime UWR config for ONE profile id (D-CFG-4(4)).
 *
 * builtin: returns afi-core's `defaultUwrConfig` — no file read occurs. This
 * branch is RC-3's explicit operator surface and keeps its semantics; it is
 * distinct from D-CFG-4(2)'s last-resort clause (owner ruling, 2026-08-12).
 * registry: reads + parses the registry document the profile id names and
 * validates it through afi-core `loadUwrProfile`, which under D-CFG-4(1)
 * returns the DOCUMENT's own weights. Every failure throws; there is no
 * fallback (RC-4). The resolved source is logged in both modes (RC-3).
 */
export function resolveUwrRuntimeConfigForProfile(
  profileId: string,
  options?: {
    env?: Record<string, string | undefined>;
    /** Test/override hook: directory holding `<profileId>.json`. */
    registryDir?: string;
    /** Test/override hook: exact document path, used verbatim. */
    registryPath?: string;
  }
): ResolvedUwrRuntimeConfig {
  const source = resolveUwrProfileSource(options?.env ?? process.env);

  if (source === "builtin") {
    console.info(
      `[uwr-runtime-profile] source=builtin (default scoring config ` +
        `"${defaultUwrConfig.id}"; registry not read)`
    );
    return { source, config: defaultUwrConfig };
  }

  const registryPath =
    options?.registryPath ??
    uwrRegistryPathFor(
      profileId,
      options?.registryDir ?? join(process.cwd(), UWR_REGISTRY_RELATIVE_DIR)
    );

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

  // D-CFG-4(1)/(3): the loader validates the document against the profile id
  // the registration named and returns the document's OWN weights.
  // UwrProfileLoadError with a machine-checkable reason propagates untouched.
  const config = loadUwrProfile(parsed, profileId);

  console.info(
    `[uwr-runtime-profile] source=registry profileId=${config.id} ` +
      `path=${registryPath} (registry weights applied per D-CFG-4(1))`
  );

  return { source, config };
}

/** Per-profile success cache. Failures are NEVER cached (RC-4 preserved). */
const resolvedByProfile = new Map<string, ResolvedUwrRuntimeConfig>();

/**
 * D-CFG-4(4): resolution is per determination, keyed by the profile the
 * strategy registration in scope names. There is no process-wide config and
 * no singleton. Only a SUCCESSFUL resolution is cached; failures are never
 * cached and never fall back, so each call re-attempts and every failed
 * attempt throws (RC-4). Any options argument bypasses the cache entirely,
 * so an overridden run can never poison the production entry.
 */
export function getUwrRuntimeConfigForProfile(
  profileId: string,
  options?: {
    env?: Record<string, string | undefined>;
    registryDir?: string;
    registryPath?: string;
  }
): ResolvedUwrRuntimeConfig {
  if (options) return resolveUwrRuntimeConfigForProfile(profileId, options);
  // Throws on a bad flag on EVERY call, cached or not.
  const source = resolveUwrProfileSource(process.env);
  const key = `${source}:${profileId}`;
  const hit = resolvedByProfile.get(key);
  if (hit) return hit;
  const resolved = resolveUwrRuntimeConfigForProfile(profileId);
  resolvedByProfile.set(key, resolved);
  return resolved;
}

/** TEST-ONLY: clear the per-profile cache (env changes between tests). */
export function __resetUwrRuntimeConfigForTests(): void {
  resolvedByProfile.clear();
}

export { UwrProfileLoadError };
