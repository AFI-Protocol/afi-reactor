/**
 * SecretResolver boundary (PBF-GOV D-PBF-7 / §7.4-7.5).
 *
 * A narrow, injectable abstraction that resolves EXACTLY the credential
 * authorized for the active provider instance — and nothing else. It has NO
 * method to list secrets, resolve arbitrary references, read another tenant's
 * credential, discover backend paths, or write/delete/rotate secrets. The
 * adapter never receives the resolver; the Reactor resolves the exact bundle
 * and hands the adapter only that.
 *
 * This mission provisions NO GCP Secret Manager. Two minimal backends prove the
 * architecture safely:
 *   - InMemorySecretResolver: the test/reference backend (tenant-scoped map).
 *   - EnvSecretResolver: a bounded, EXPLICITLY NON-PRODUCTION dev backend that
 *     can read ONLY the one env var pre-authorized for a given (tenant,
 *     credentialRef) — never arbitrary env. A real GCP backend belongs to the
 *     later staging/deployment wave.
 */
import type { ProviderCredentialBundle } from "./types.js";
import { CredentialUnavailableError } from "./errors.js";

/** The exact, already-authorized credential to resolve. Nothing broader is expressible. */
export interface SecretResolveRequest {
  tenant: string;
  providerInstanceId: string;
  credentialRef: string;
  credentialKind: "apiKeyHeader";
  /** The header name the provider requires (non-secret). */
  headerName: string;
}

/**
 * Resolves ONLY the exact authorized credential for the active provider
 * instance. There is deliberately no list/enumerate/write/delete/rotate.
 */
export interface SecretResolver {
  resolve(request: SecretResolveRequest): Promise<ProviderCredentialBundle>;
}

function key(tenant: string, credentialRef: string): string {
  return `${tenant}::${credentialRef}`;
}

/**
 * In-memory resolver keyed by (tenant, credentialRef). A request for tenant A's
 * instance can only ever resolve a secret stored under tenant A — cross-tenant
 * and within-tenant cross-node isolation is structural (a node passes only its
 * own instance's ref). Unknown refs fail closed with a non-revealing error.
 */
export class InMemorySecretResolver implements SecretResolver {
  private readonly store = new Map<string, string>();

  constructor(entries: ReadonlyArray<{ tenant: string; credentialRef: string; value: string }> = []) {
    for (const e of entries) this.store.set(key(e.tenant, e.credentialRef), e.value);
  }

  async resolve(request: SecretResolveRequest): Promise<ProviderCredentialBundle> {
    const value = this.store.get(key(request.tenant, request.credentialRef));
    if (value === undefined) {
      // NON-REVEALING: names the provider instance, never the value/path/tenant secret.
      throw new CredentialUnavailableError(
        `credential unavailable for provider instance '${request.providerInstanceId}'`
      );
    }
    return { kind: "apiKeyHeader", headerName: request.headerName, headerValue: value };
  }
}

/**
 * EXPLICITLY NON-PRODUCTION dev backend. It resolves a (tenant, credentialRef)
 * ONLY via a pre-authorized allow-map to a single env var name — it can never
 * read an arbitrary env var and never lists anything. A real secret manager
 * (GCP Secret Manager) is deferred to the staging/deployment wave.
 */
export class EnvSecretResolver implements SecretResolver {
  /** (tenant, credentialRef) -> the ONE authorized env var name. */
  private readonly allow = new Map<string, string>();

  constructor(
    authorized: ReadonlyArray<{ tenant: string; credentialRef: string; envVar: string }> = [],
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {
    for (const a of authorized) this.allow.set(key(a.tenant, a.credentialRef), a.envVar);
  }

  async resolve(request: SecretResolveRequest): Promise<ProviderCredentialBundle> {
    const envVar = this.allow.get(key(request.tenant, request.credentialRef));
    if (envVar === undefined) {
      throw new CredentialUnavailableError(
        `credential unavailable for provider instance '${request.providerInstanceId}' (unauthorized reference)`
      );
    }
    const value = this.env[envVar];
    if (!value) {
      throw new CredentialUnavailableError(
        `credential unavailable for provider instance '${request.providerInstanceId}'`
      );
    }
    return { kind: "apiKeyHeader", headerName: request.headerName, headerValue: value };
  }
}

/** A resolver that always fails closed — the safe default when none is configured. */
export class NoCredentialsResolver implements SecretResolver {
  async resolve(request: SecretResolveRequest): Promise<ProviderCredentialBundle> {
    throw new CredentialUnavailableError(
      `no secret resolver configured for provider instance '${request.providerInstanceId}'`
    );
  }
}
