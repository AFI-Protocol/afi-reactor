/**
 * UWR profile pin — PR-UWR-STAMP (afi-governance/decisions/uwr-profile-pin-v0.1.md §7),
 * amended by PR-UWR-STAMP-SEMANTICS (uwr-runtime-consumption-v0.1.md §7 row
 * flipped by owner merge of afi-governance PR #13, merge commit 6b3638b) and
 * generalized to REGISTRY-BACKED recognition by FCP-GOV
 * (decisions/factory-configurable-pipelines-v1.md §14 / D-FCP-9 item 5): the
 * former froggy-only pinned scorer-identity gate is replaced by recognition
 * through the resolved analyst-strategy REGISTRATION — a stamp is issued iff
 * the registration's `uwrProfileRef` names a registered profile AND the
 * scorer identity triple matches the registration. Recognition stays "always
 * registered and pinned, never silent" (UP-10 generalized into D-FCP-5).
 *
 * HARDCODED pinned profile metadata, deliberately (values UNCHANGED from
 * PR-UWR-STAMP). This module does NOT read the afi-config uwr-profiles
 * registry at runtime — the single authorized reader is
 * src/config/uwrRuntimeProfile.ts (RC-7 grant 1). The registration handed in
 * comes from the boot-validated strategy registries (validateRuntimeConfig
 * verifies every active registration's uwrProfileRef against the pinned
 * recognized profile), so recognition is registry-backed without a second
 * registry read path. The stamp records which governed profile the scoring
 * configuration corresponds to, and (RC-6) HOW that configuration was
 * sourced:
 *
 * - resolved source "builtin"  → stamp source "builtin-value-identity":
 *   scoring ran afi-core's `defaultUwrConfig`, value-identical to the
 *   registered profile by construction (UP-2/UP-5); the registry was not read.
 * - resolved source "registry" → stamp source "registry-consumed": scoring
 *   ran the profile actually read from the afi-config registry and validated
 *   under the RC-5 identity predicate. Because resolution is fail-closed
 *   (RC-4), a "registry" source can only ever reach this module after a
 *   successful read + validation — a failed resolution throws before any
 *   scoring, so no record (and no stamp) exists to mislead.
 *
 * The resolved source MUST be propagated here explicitly from the
 * composition path (ResolvedUwrRuntimeConfig.source). This module never
 * reads process.env and never infers the source independently: an
 * unrecognized/unpropagated source with a stampable identity throws rather
 * than stamping, because omitting the field would masquerade as a
 * pre-program record (RC-6: absence identifies the pre-program era).
 *
 * Status: testnet-provisional. Stamping is traceability metadata only —
 * it does not wire the qualification gate (UP-9), does not create reward
 * eligibility or mint wiring (§6), and does not promote production scoring
 * law. A test-only cross-check against the sibling afi-config registry lives
 * in test/guardrails/uwrProfileStamp.test.ts.
 */

import type {
  UwrProfileStamp,
  UwrProfileStampSource,
} from "../types/ReactorScoredSignalV1.js";
import type { UwrProfileSource } from "./uwrRuntimeProfile.js";

/** Profile id pinned by uwr-profile-pin-v0.1.md (UP-2). */
export const UWR_PROFILE_ID = "uwr-weighted-lifts-v0.1";

/** The profile's governance status. Stamped so persisted records self-describe. */
export const UWR_PROFILE_STATUS = "testnet-provisional" as const;

/**
 * Decision that pinned the profile. Its §7 row defines PR-UWR-STAMP's scope
 * but marks it "No — separate authorization" (UP-12): stamping itself was
 * separately owner-authorized, not authorized by the decision.
 */
export const UWR_PROFILE_DECISION_REF =
  "afi-governance/decisions/uwr-profile-pin-v0.1.md";

/**
 * The REGISTERED profiles this Reactor can stamp. Exactly one is registered
 * (UP-2); registering another profile is a registry + governance act, never a
 * code default. Recognition of a SCORER identity is no longer pinned here —
 * it flows from the resolved analyst-strategy registration (D-FCP-5).
 */
export const REGISTERED_UWR_PROFILE_IDS: readonly string[] = Object.freeze([
  UWR_PROFILE_ID,
]);

/** RC-6 discriminator value stamped when scoring ran the builtin config. */
export const UWR_STAMP_SOURCE_BUILTIN = "builtin-value-identity" as const;

/** RC-6 discriminator value stamped only after a successful, RC-5-validated
 * registry read actually supplied the scoring config. */
export const UWR_STAMP_SOURCE_REGISTRY = "registry-consumed" as const;

/**
 * The registration identity recognition is checked against — the resolved,
 * boot-validated analyst-strategy registration's triple + uwrProfileRef.
 */
export interface RecognizedStrategyRegistration {
  analystId: string;
  strategyId: string;
  strategyVersion: string;
  uwrProfileRef: { profileId: string };
}

/**
 * Map the composition path's resolved source onto the persisted RC-6
 * discriminator. Exhaustive: anything other than the two recognized sources
 * throws — a stamp must never be written with unknown provenance, and
 * omitting it would masquerade as a pre-program record.
 */
function stampSourceFor(resolvedSource: UwrProfileSource): UwrProfileStampSource {
  switch (resolvedSource) {
    case "builtin":
      return UWR_STAMP_SOURCE_BUILTIN;
    case "registry":
      return UWR_STAMP_SOURCE_REGISTRY;
    default:
      throw new Error(
        `uwrProfileStampFor: resolved UWR source ${JSON.stringify(
          resolvedSource
        )} was not propagated from the composition path (expected "builtin" ` +
          `or "registry") — refusing to stamp (RC-6: a persisted stamp must ` +
          `carry honest source provenance).`
      );
  }
}

/**
 * Build the UWR profile stamp for a scored signal, or return undefined when
 * recognition fails — i.e. when no resolved registration is supplied, the
 * registration's uwrProfileRef does not name a REGISTERED profile, or the
 * scorer identity triple does not match the registration (registry-backed
 * recognition, D-FCP-5; the identity gate PRECEDES the source discriminator
 * exactly as before). Callers must OMIT the field entirely when undefined
 * (do not persist null) — the evidence constructor fails closed on it.
 *
 * `resolvedSource` is the source the composition path actually scored with
 * (ResolvedUwrRuntimeConfig.source), propagated explicitly — never re-read
 * from the environment here (RC-6/PR-UWR-STAMP-SEMANTICS).
 */
export function uwrProfileStampFor(
  analystScore:
    | { analystId?: string; strategyId?: string; strategyVersion?: string }
    | null
    | undefined,
  resolvedSource: UwrProfileSource,
  registration: RecognizedStrategyRegistration | null | undefined
): UwrProfileStamp | undefined {
  if (!analystScore || !registration) return undefined;
  // Registry-backed recognition gate 1: the registration must reference a
  // REGISTERED profile (never a silent/unregistered recognition).
  if (!REGISTERED_UWR_PROFILE_IDS.includes(registration.uwrProfileRef?.profileId as string)) {
    return undefined;
  }
  // Gate 2: the scorer identity triple must MATCH the resolved registration —
  // a score produced under any other identity must not be stamped (that would
  // assert recognition governance never granted).
  if (analystScore.analystId !== registration.analystId) return undefined;
  if (analystScore.strategyId !== registration.strategyId) return undefined;
  if (
    analystScore.strategyVersion !== undefined &&
    analystScore.strategyVersion !== registration.strategyVersion
  ) {
    return undefined;
  }
  return {
    profileId: UWR_PROFILE_ID,
    status: UWR_PROFILE_STATUS,
    decisionRef: UWR_PROFILE_DECISION_REF,
    source: stampSourceFor(resolvedSource),
  };
}
