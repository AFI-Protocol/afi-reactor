/**
 * Provider / CredentialRef / ProviderInstance record types + a fail-closed,
 * schema-validated in-memory record store (PBF-GOV D-PBF-4).
 *
 * Every record is AJV-validated against its byte-pinned vendored schema at
 * construction — an invalid record is a boot error (fail closed). The store
 * only INDEXES non-secret records; it never holds a credential value. Credential
 * values live behind the SecretResolver, never here.
 */
import type { ValidateFunction } from "ajv";
import type { AnalysisCategory } from "./types.js";
import { compileGovernedValidator } from "./schemaSupport.js";

export interface ProviderRecord {
  schema: "afi.provider.v1";
  providerId: string;
  recordVersion: string;
  displayName: string;
  supportedCategories: AnalysisCategory[];
  executionClass: "local" | "remote";
  deterministic: boolean;
  adapterId: string;
  requiresCredential: boolean;
  credentialKind?: "apiKeyHeader";
  supportedModels?: string[];
  status: "active" | "inactive";
}

export interface CredentialRefRecord {
  schema: "afi.credential-ref.v1";
  credentialRef: string;
  recordVersion: string;
  tenant: string;
  providerId: string;
  credentialKind: "apiKeyHeader";
  status: "active" | "disabled";
}

export interface ProviderInstanceRecord {
  schema: "afi.provider-instance.v1";
  providerInstanceId: string;
  recordVersion: string;
  tenant: string;
  category: AnalysisCategory;
  providerId: string;
  adapterId: string;
  adapterVersion: string;
  model?: string;
  credentialRef?: string;
  invocation?: { windowHours?: number; timeoutMs?: number; endpointProfile?: "default" };
  status: "active" | "inactive";
}

export interface ProviderRecordStore {
  getProvider(providerId: string): ProviderRecord | undefined;
  getProviderInstance(providerInstanceId: string, recordVersion: string): ProviderInstanceRecord | undefined;
  getCredentialRef(credentialRef: string): CredentialRefRecord | undefined;
}

export interface ProviderRecordStoreInput {
  providers?: ReadonlyArray<ProviderRecord>;
  credentialRefs?: ReadonlyArray<CredentialRefRecord>;
  providerInstances?: ReadonlyArray<ProviderInstanceRecord>;
}

function instanceKey(id: string, version: string): string {
  return `${id}@${version}`;
}

/**
 * Build a record store, validating every record against its vendored schema.
 * Throws on the FIRST invalid record (fail closed) — an unschematized provider
 * record must never reach the resolution path.
 */
export function createProviderRecordStore(
  input: ProviderRecordStoreInput,
  schemaDirOverride?: string
): ProviderRecordStore {
  const providerV: ValidateFunction = compileGovernedValidator("provider.schema.json", schemaDirOverride);
  const credV: ValidateFunction = compileGovernedValidator("credential-ref.schema.json", schemaDirOverride);
  const instV: ValidateFunction = compileGovernedValidator("provider-instance.schema.json", schemaDirOverride);

  const validate = (v: ValidateFunction, record: unknown, label: string) => {
    if (!v(record)) {
      throw new Error(`invalid ${label} record: ${JSON.stringify(v.errors)}`);
    }
  };

  const providers = new Map<string, ProviderRecord>();
  for (const p of input.providers ?? []) {
    validate(providerV, p, "provider");
    providers.set(p.providerId, p);
  }
  const credRefs = new Map<string, CredentialRefRecord>();
  for (const c of input.credentialRefs ?? []) {
    validate(credV, c, "credential-ref");
    credRefs.set(c.credentialRef, c);
  }
  const instances = new Map<string, ProviderInstanceRecord>();
  for (const i of input.providerInstances ?? []) {
    validate(instV, i, "provider-instance");
    instances.set(instanceKey(i.providerInstanceId, i.recordVersion), i);
  }

  return {
    getProvider: (providerId) => providers.get(providerId),
    getProviderInstance: (id, version) => instances.get(instanceKey(id, version)),
    getCredentialRef: (credentialRef) => credRefs.get(credentialRef),
  };
}
