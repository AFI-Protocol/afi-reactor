/**
 * Provider runtime — provider-instance resolution + adapter dispatch
 * (PBF-GOV D-PBF-4/D-PBF-5/D-PBF-7/D-PBF-8 / §7.3).
 *
 * The bounded flow, fail-closed at every boundary:
 *   1. resolve the node's ProviderInstance reference (non-secret record)
 *   2-4. validate instance/provider are active
 *   5-6. validate category + provider/adapter compatibility
 *   7-8. resolve the exact registered adapter; validate its category
 *   9. resolve ONLY the authorized credential (least-privilege) when required;
 *      a keyless provider NEVER invokes the resolver
 *   10. invoke the adapter with a bounded credential bundle + scrubbing logger,
 *       validate the returned category result, and return exactly ONE result.
 *
 * This is NOT a second executor: it is invoked BELOW the node by a provider-
 * backed plugin; the GraphExecutor and the scorer-facing join are unchanged.
 */
import type { NodeLogger } from "../pipeline/nodeSdk.js";
import type { CanonicalUss } from "../types/canonicalUss.js";
import { isAdapterRunEnvelope, type CategoryResult, type ProviderInstanceRef } from "./types.js";
import type { AdapterRegistry } from "./adapterRegistry.js";
import type { ProviderRecordStore } from "./records.js";
import type { SecretResolver } from "./secretResolver.js";
import type { CategoryOutputValidator } from "./outputValidation.js";
import { scrubbingLogger } from "./redaction.js";
import {
  ProviderResolutionError,
  CredentialUnavailableError,
  CredentialScopeError,
  ProviderOutputInvalidError,
} from "./errors.js";
import {
  RESULT_SCHEMA_BY_CATEGORY,
  toAimlInvocationProof,
  type CredentialBindingProof,
  type ProviderInvocationProofV1,
  type TinyBrainsInvocationBlock,
} from "./invocationProof.js";
import {
  buildInvocationInputProjection,
  categoryResultHash,
  invocationInputHash,
  providerInstanceRecordFingerprint,
  providerRecordFingerprint,
  providerResultHash,
} from "../evidence/provenance/invocationProofHashes.js";
import type { CanonicalHashRef } from "../pipeline/hashing.js";

export interface ProviderInvokeContext {
  signal: CanonicalUss;
  /** Executor node input (parent outputs / port selection), passed through verbatim. */
  input?: unknown;
  /** Non-secret node config, merged under the instance's invocation settings. */
  config?: Record<string, unknown>;
  logger: NodeLogger;
  abort: AbortSignal;
  /**
   * Invocation-proof capture sink (EV3-GOV D-EV3-5(2)): when present, the
   * runtime builds the per-lane afi.provider-invocation-proof.v1 from the
   * identity chain it JUST resolved (capture inside the one live graph pass —
   * never a re-call) and deposits it here after output validation succeeds.
   */
  onInvocationProof?: (proof: ProviderInvocationProofV1) => void;
}

export interface ProviderRuntimeDeps {
  adapters: AdapterRegistry;
  records: ProviderRecordStore;
  resolver: SecretResolver;
  outputValidator: CategoryOutputValidator;
}

export class ProviderRuntime {
  /**
   * Record fingerprints are content commitments over IMMUTABLE loaded records
   * — computed once per record object and cached for the runtime's lifetime
   * (D-EV3-5(2): no per-invocation recompute cost, no drift window).
   */
  private readonly fingerprints = new WeakMap<object, CanonicalHashRef>();

  constructor(private readonly deps: ProviderRuntimeDeps) {}

  private fingerprintOf(
    record: object,
    compute: (record: object) => CanonicalHashRef
  ): CanonicalHashRef {
    let cached = this.fingerprints.get(record);
    if (!cached) {
      cached = compute(record);
      this.fingerprints.set(record, cached);
    }
    return cached;
  }

  /** Resolve one provider-backed category node into exactly one validated result. */
  async invoke(ref: ProviderInstanceRef, ctx: ProviderInvokeContext): Promise<CategoryResult> {
    const { adapters, records, resolver, outputValidator } = this.deps;

    // 1. resolve the non-secret provider-instance record
    const instance = records.getProviderInstance(ref.providerInstanceId, ref.recordVersion);
    if (!instance) {
      throw new ProviderResolutionError(
        "provider-instance-unresolved",
        `no provider instance '${ref.providerInstanceId}@${ref.recordVersion}'`
      );
    }
    // 2. instance must be active
    if (instance.status !== "active") {
      throw new ProviderResolutionError(
        "provider-instance-unresolved",
        `provider instance '${instance.providerInstanceId}' is not active`
      );
    }
    // 3. resolve the provider
    const provider = records.getProvider(instance.providerId);
    if (!provider) {
      throw new ProviderResolutionError(
        "provider-unresolved",
        `provider instance '${instance.providerInstanceId}' references unknown provider '${instance.providerId}'`
      );
    }
    // 4. provider must be active
    if (provider.status !== "active") {
      throw new ProviderResolutionError("provider-unresolved", `provider '${provider.providerId}' is not active`);
    }
    // 5. category compatibility (instance category ∈ provider supportedCategories)
    if (!provider.supportedCategories.includes(instance.category)) {
      throw new ProviderResolutionError(
        "category-incompatible",
        `provider '${provider.providerId}' does not support category '${instance.category}'`
      );
    }
    // 6. provider/adapter agreement
    if (provider.adapterId !== instance.adapterId) {
      throw new ProviderResolutionError(
        "provider-adapter-mismatch",
        `provider instance adapter '${instance.adapterId}' != provider adapter '${provider.adapterId}'`
      );
    }
    // model authority (optional)
    if (instance.model !== undefined) {
      if (!provider.supportedModels || !provider.supportedModels.includes(instance.model)) {
        throw new ProviderResolutionError(
          "category-incompatible",
          `provider '${provider.providerId}' does not support model '${instance.model}'`
        );
      }
    }
    // 7. resolve the exact registered adapter (fail closed on unknown)
    const adapter = adapters.require(instance.adapterId, instance.adapterVersion);
    // 8. adapter category must agree
    if (adapter.category !== instance.category) {
      throw new ProviderResolutionError(
        "category-incompatible",
        `adapter '${instance.adapterId}' category '${adapter.category}' != instance category '${instance.category}'`
      );
    }
    if (!adapter.providerCompatibility.includes(provider.providerId)) {
      throw new ProviderResolutionError(
        "provider-adapter-mismatch",
        `adapter '${instance.adapterId}' is not compatible with provider '${provider.providerId}'`
      );
    }

    // 9. least-privilege credential resolution
    let credential = undefined as Awaited<ReturnType<SecretResolver["resolve"]>> | undefined;
    let credRecord = undefined as ReturnType<ProviderRecordStore["getCredentialRef"]>;
    const secretsToScrub: string[] = [];
    if (provider.requiresCredential) {
      if (!instance.credentialRef) {
        throw new CredentialUnavailableError(
          `credential required but no credential reference on provider instance '${instance.providerInstanceId}'`
        );
      }
      credRecord = records.getCredentialRef(instance.credentialRef);
      if (!credRecord) {
        throw new CredentialUnavailableError(
          `credential reference for provider instance '${instance.providerInstanceId}' does not resolve`
        );
      }
      if (credRecord.status !== "active") {
        throw new CredentialUnavailableError(
          `credential reference for provider instance '${instance.providerInstanceId}' is disabled`
        );
      }
      // tenant + provider + kind scope (defense in depth over the resolver key)
      if (credRecord.tenant !== instance.tenant) {
        throw new CredentialScopeError(
          "tenant-scope-mismatch",
          `credential scope mismatch for provider instance '${instance.providerInstanceId}'`
        );
      }
      if (credRecord.providerId !== provider.providerId) {
        throw new CredentialScopeError(
          "credential-scope-mismatch",
          `credential provider mismatch for provider instance '${instance.providerInstanceId}'`
        );
      }
      if (!provider.credentialKind || credRecord.credentialKind !== provider.credentialKind) {
        throw new CredentialScopeError(
          "credential-scope-mismatch",
          `credential kind mismatch for provider instance '${instance.providerInstanceId}'`
        );
      }
      const headerName = credentialHeaderName(provider.credentialKind);
      credential = await resolver.resolve({
        tenant: instance.tenant,
        providerInstanceId: instance.providerInstanceId,
        credentialRef: instance.credentialRef,
        credentialKind: provider.credentialKind,
        headerName,
      });
      secretsToScrub.push(credential.headerValue);
    } else if (instance.credentialRef) {
      // keyless provider MUST NOT carry a credential (unauthorized)
      throw new CredentialScopeError(
        "unauthorized-credential",
        `keyless provider '${provider.providerId}' must not carry a credential reference`
      );
    }

    // 10. invoke the adapter with a bounded bundle + scrubbing logger; validate output
    const config = { ...(instance.invocation ?? {}), ...(ctx.config ?? {}) };
    const runResult = await adapter.run({
      signal: ctx.signal,
      input: ctx.input,
      config,
      model: instance.model,
      logger: scrubbingLogger(ctx.logger, secretsToScrub),
      abort: ctx.abort,
      credential,
    });

    // Unwrap the optional adapter envelope (EV3-GOV D-EV3-3): the verified
    // service-invocation side-channel travels ONLY to the proof capture —
    // never into the CategoryResult, never to the join.
    let serviceInvocation: TinyBrainsInvocationBlock | undefined;
    let result: unknown = runResult;
    if (runResult && typeof runResult === "object" && isAdapterRunEnvelope(runResult)) {
      serviceInvocation = runResult.serviceInvocation;
      result = runResult.result;
    }

    if (!result || typeof result !== "object" || (result as CategoryResult).category !== instance.category) {
      throw new ProviderOutputInvalidError(
        `adapter for '${instance.providerInstanceId}' returned a result whose category marker is not '${instance.category}'`
      );
    }
    // canonical category validation BEFORE scoring — malformed output never passes
    const validated = outputValidator.validate(instance.category, result);

    // 11. invocation-proof capture (EV3-GOV D-EV3-2/D-EV3-5(2)): describe the
    // invocation that JUST occurred from the resolved identity chain — no
    // re-call, no re-fetch. Built only when the caller captures proofs.
    if (ctx.onInvocationProof) {
      const credentialBinding: CredentialBindingProof = provider.requiresCredential
        ? {
            mode: "credentialRef",
            credentialKind: provider.credentialKind!,
            credentialRef: credRecord!.credentialRef,
            recordVersion: credRecord!.recordVersion,
            status: credRecord!.status,
          }
        : { mode: "keyless" };

      const proof: ProviderInvocationProofV1 = {
        schema: "afi.provider-invocation-proof.v1",
        category: instance.category,
        resultSchema: RESULT_SCHEMA_BY_CATEGORY[instance.category],
        provider: {
          providerId: provider.providerId,
          recordVersion: provider.recordVersion,
          recordFingerprint: this.fingerprintOf(provider, providerRecordFingerprint),
          executionClass: provider.executionClass,
          deterministic: provider.deterministic,
        },
        providerInstance: {
          providerInstanceId: instance.providerInstanceId,
          recordVersion: instance.recordVersion,
          recordFingerprint: this.fingerprintOf(instance, providerInstanceRecordFingerprint),
          ...(instance.model !== undefined ? { model: instance.model } : {}),
        },
        adapter: {
          adapterId: adapter.adapterId,
          adapterVersion: adapter.adapterVersion,
          transportKind: adapter.transportKind,
        },
        credential: credentialBinding,
        invocationInputHash: invocationInputHash(
          buildInvocationInputProjection({
            category: instance.category,
            adapterId: adapter.adapterId,
            adapterVersion: adapter.adapterVersion,
            model: instance.model,
            params: config,
            signal: ctx.signal,
            graphInput: ctx.input,
          })
        ),
        providerResultHash: providerResultHash(validated),
        categoryResultHash: categoryResultHash(validated),
        status: "succeeded",
      };
      if (instance.category === "technical" && typeof validated.priceSource === "string") {
        proof.priceSource = validated.priceSource;
      }
      if (instance.category === "aiMl") {
        // The aiMl proof REQUIRES the nested Tiny Brains projection
        // (D-EV3-3): a lane that produced no verified side-channel cannot be
        // proven and must not look successful.
        if (!serviceInvocation) {
          throw new ProviderOutputInvalidError(
            `aiMl adapter for '${instance.providerInstanceId}' surfaced no verified service invocation block (EV3-GOV D-EV3-3)`
          );
        }
        proof.aimlInvocation = toAimlInvocationProof(serviceInvocation);
      }
      ctx.onInvocationProof(proof);
    }

    return validated;
  }
}

function credentialHeaderName(kind: "apiKeyHeader"): string {
  switch (kind) {
    case "apiKeyHeader":
      return "X-ACCESS-KEY";
  }
}
