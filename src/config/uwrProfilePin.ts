/**
 * UWR profile pin — PR-UWR-STAMP (afi-governance/decisions/uwr-profile-pin-v0.1.md §7).
 *
 * HARDCODED pinned constants, deliberately. This module does NOT read the
 * afi-config profile registry at runtime: runtime registry consumption
 * requires its own separate authorization (UP-12) and has not happened. The stamp records which governed
 * profile the pipeline's pinned configuration is value-identical to — the
 * registered profile is "value-identical to `defaultUwrConfig` by
 * construction" (UP-2/UP-5) — it does NOT assert that the registry was
 * consumed, and runtime scoring still executes afi-core's `defaultUwrConfig`.
 *
 * Status: testnet-provisional. Stamping is traceability metadata only —
 * it does not wire the qualification gate (UP-9), does not create reward
 * eligibility or mint wiring (§6), and does not promote production scoring
 * law. A test-only cross-check against the sibling afi-config registry lives
 * in test/guardrails/uwrProfileStamp.test.ts.
 */

import type { UwrProfileStamp } from "../types/ReactorScoredSignalV1.js";

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
 * UP-10: the profile is recognized ONLY for this scorer identity
 * (registry `scorerIdentity`). Documents produced by any other identity
 * must not be stamped — that would assert recognition governance never
 * granted.
 */
export const UWR_PROFILE_SCORER_IDENTITY = Object.freeze({
  analystId: "froggy",
  strategyId: "trend_pullback_v1",
});

/**
 * Build the UWR profile stamp for a scored signal, or return undefined when
 * the scorer identity is not the one the profile is recognized for (UP-10).
 * Callers must OMIT the field entirely when undefined (do not persist null).
 */
export function uwrProfileStampFor(
  analystScore:
    | { analystId?: string; strategyId?: string }
    | null
    | undefined
): UwrProfileStamp | undefined {
  if (!analystScore) return undefined;
  if (analystScore.analystId !== UWR_PROFILE_SCORER_IDENTITY.analystId) {
    return undefined;
  }
  if (analystScore.strategyId !== UWR_PROFILE_SCORER_IDENTITY.strategyId) {
    return undefined;
  }
  return {
    profileId: UWR_PROFILE_ID,
    status: UWR_PROFILE_STATUS,
    decisionRef: UWR_PROFILE_DECISION_REF,
  };
}
