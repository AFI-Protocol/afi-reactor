/**
 * Provider invocation proof types (EV3-GOV D-EV3-2 / D-EV3-3).
 *
 * TypeScript mirrors of the governed contracts
 * `afi.provider-invocation-proof.v1` and `afi.aiml-invocation-proof.v1`
 * (vendored under src/pipeline/governed-schema/) plus the Tiny Brains WIRE
 * invocation block (the bounded additive `/predict/froggy` response member,
 * D-EV3-3). The vendored schemas remain the single validation authority —
 * nothing here loosens them.
 *
 * Proof facts are CARRIED, NEVER CONSUMED: no category node, join, analyst,
 * scorer, UWR, or decay path may read a proof (D-EV3-2). The proofs are
 * captured inside the one live graph pass at the provider-runtime seam
 * (D-EV3-5(2)) and travel with execution state to the sole District Two
 * Evidence V3 builder.
 */

import type { CanonicalHashRef } from "../pipeline/hashing.js";
import type { AnalysisCategory } from "./types.js";

/** How an adapter reached its capability (D-EV3-2(4)). Never a URL. */
export type AdapterTransportKind = "in-process" | "http";

export const PROVIDER_INVOCATION_PROOF_SCHEMA = "afi.provider-invocation-proof.v1" as const;
export const AIML_INVOCATION_PROOF_SCHEMA = "afi.aiml-invocation-proof.v1" as const;
export const TINY_BRAINS_INVOCATION_RECORD = "tiny-brains.aiml-invocation.v1" as const;

/**
 * The governed result schema id per category (contract ids are lowercase;
 * only the runtime category marker is camelCase `aiMl`).
 */
export const RESULT_SCHEMA_BY_CATEGORY: Record<AnalysisCategory, string> = {
  technical: "afi.enrichment.technical.v1",
  pattern: "afi.enrichment.pattern.v1",
  sentiment: "afi.enrichment.sentiment.v1",
  news: "afi.enrichment.news.v1",
  aiMl: "afi.enrichment.aiml.v1",
} as const;

/**
 * The deterministic proof order on every v3 record: ascending case-sensitive
 * lexicographic category name (D-EV3-2).
 */
export const PROOF_CATEGORY_ORDER: readonly AnalysisCategory[] = [
  "aiMl",
  "news",
  "pattern",
  "sentiment",
  "technical",
] as const;

// ---------------------------------------------------------------------------
// Tiny Brains wire block (the D-EV3-3 additive response member)
// ---------------------------------------------------------------------------

/** One expert's projection on the wire block — identities and hashes only. */
export interface TinyBrainsInvocationExpert {
  expertId: string;
  expertVersion: string;
  posture: "deterministic" | "probabilistic";
  status: "succeeded";
  outputHash: string;
  artifactFingerprints?: Record<string, string>;
}

/**
 * The closed, non-secret `invocation` block on a successful /predict/froggy
 * response (tiny-brains.aiml-invocation.v1 projection): identities and
 * opaque tiny-brains.hash.v1 commitments only; volatile timing facts are
 * structurally excluded. Strict-parsed fail-closed by the aiMl service
 * client BEFORE it reaches any runtime surface.
 */
export interface TinyBrainsInvocationBlock {
  record: typeof TINY_BRAINS_INVOCATION_RECORD;
  profileId: string;
  profileVersion: string;
  resolverId: string;
  resolverVersion: string;
  codeConfigFingerprint: string;
  hashLaw: "tiny-brains.hash.v1";
  inputHash: string;
  outputHash: string;
  status: "succeeded";
  experts: TinyBrainsInvocationExpert[];
}

// ---------------------------------------------------------------------------
// afi.aiml-invocation-proof.v1 (the nested evidence proof)
// ---------------------------------------------------------------------------

export interface AimlInvocationProofV1 {
  schema: typeof AIML_INVOCATION_PROOF_SCHEMA;
  profileId: string;
  profileVersion: string;
  resolverId: string;
  resolverVersion: string;
  codeConfigFingerprint: string;
  hashLaw: "tiny-brains.hash.v1";
  inputHash: string;
  outputHash: string;
  status: "succeeded";
  experts: TinyBrainsInvocationExpert[];
}

/**
 * Project the verified wire block into the governed nested proof shape
 * (drop the service-record marker; stamp the evidence schema const).
 */
export function toAimlInvocationProof(block: TinyBrainsInvocationBlock): AimlInvocationProofV1 {
  return {
    schema: AIML_INVOCATION_PROOF_SCHEMA,
    profileId: block.profileId,
    profileVersion: block.profileVersion,
    resolverId: block.resolverId,
    resolverVersion: block.resolverVersion,
    codeConfigFingerprint: block.codeConfigFingerprint,
    hashLaw: block.hashLaw,
    inputHash: block.inputHash,
    outputHash: block.outputHash,
    status: block.status,
    experts: block.experts.map((e) => {
      const expert: TinyBrainsInvocationExpert = {
        expertId: e.expertId,
        expertVersion: e.expertVersion,
        posture: e.posture,
        status: e.status,
        outputHash: e.outputHash,
      };
      if (e.artifactFingerprints !== undefined) {
        expert.artifactFingerprints = { ...e.artifactFingerprints };
      }
      return expert;
    }),
  };
}

// ---------------------------------------------------------------------------
// afi.provider-invocation-proof.v1 (the per-lane proof)
// ---------------------------------------------------------------------------

export interface ProviderIdentityProof {
  providerId: string;
  recordVersion: string;
  /** Composition-law content commitment, domain afi.d2.provider-record. */
  recordFingerprint: CanonicalHashRef;
  executionClass: "local" | "remote";
  deterministic: boolean;
}

export interface ProviderInstanceIdentityProof {
  providerInstanceId: string;
  recordVersion: string;
  /** Composition-law content commitment, domain afi.d2.provider-instance-record. */
  recordFingerprint: CanonicalHashRef;
  /** Present exactly when the selected instance declares a governed model. */
  model?: string;
}

export interface AdapterIdentityProof {
  adapterId: string;
  adapterVersion: string;
  transportKind: AdapterTransportKind;
}

/** Credential binding: keyless posture XOR opaque CredentialRef facts (D-EV3-6). */
export type CredentialBindingProof =
  | { mode: "keyless" }
  | {
      mode: "credentialRef";
      credentialKind: "apiKeyHeader";
      credentialRef: string;
      recordVersion: string;
      status: "active" | "disabled";
    };

/**
 * One closed, credential-safe record of one SUCCESSFUL provider invocation
 * for one governed category lane. Built ONCE per lane by the ProviderRuntime
 * inside the live graph pass; validated fail-closed by the Evidence V3
 * builder against the boot-verified registry resolution and the recomputed
 * category-result hashes.
 */
export interface ProviderInvocationProofV1 {
  schema: typeof PROVIDER_INVOCATION_PROOF_SCHEMA;
  category: AnalysisCategory;
  resultSchema: string;
  provider: ProviderIdentityProof;
  providerInstance: ProviderInstanceIdentityProof;
  adapter: AdapterIdentityProof;
  credential: CredentialBindingProof;
  invocationInputHash: CanonicalHashRef;
  providerResultHash: CanonicalHashRef;
  categoryResultHash: CanonicalHashRef;
  /** Technical lane ONLY: the non-secret price-source identifier (D-EV3-2(6)). */
  priceSource?: string;
  status: "succeeded";
  /** REQUIRED exactly when category is aiMl; structurally forbidden otherwise. */
  aimlInvocation?: AimlInvocationProofV1;
}

/**
 * The runtime capture draft is the finished proof — the runtime resolves the
 * complete identity chain, so nothing remains to fill in downstream
 * (D-EV3-5(2): capture, never recall).
 */
export type InvocationProofDraft = ProviderInvocationProofV1;
