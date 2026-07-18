/**
 * Provider-adapter layer errors (PBF-GOV D-PBF-5/D-PBF-7 §8.4).
 *
 * Credential-related failures are USEFUL but NON-REVEALING: no secret value,
 * no secret path, no complete authorization header, no complete credentialed
 * URL, no other tenant's identity ever appears in a message. Every boundary
 * fails CLOSED.
 */

export type ProviderErrorCode =
  | "provider-instance-unresolved"
  | "provider-unresolved"
  | "adapter-not-registered"
  | "adapter-duplicate-registration"
  | "category-incompatible"
  | "provider-adapter-mismatch"
  | "tenant-scope-mismatch"
  | "credential-unavailable"
  | "credential-scope-mismatch"
  | "unauthorized-credential"
  | "provider-output-invalid";

export class ProviderLayerError extends Error {
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderLayerError";
    this.code = code;
  }
}

/** A referenced provider instance or provider record does not resolve. */
export class ProviderResolutionError extends ProviderLayerError {
  constructor(code: ProviderErrorCode, message: string) {
    super(code, message);
    this.name = "ProviderResolutionError";
  }
}

/** The adapter identity is not in the trusted registry (fail closed). */
export class AdapterNotRegisteredError extends ProviderLayerError {
  constructor(message: string) {
    super("adapter-not-registered", message);
    this.name = "AdapterNotRegisteredError";
  }
}

/**
 * A required credential could not be resolved, or a keyless provider carried a
 * credential. NON-REVEALING: names only the provider instance, never the value.
 */
export class CredentialUnavailableError extends ProviderLayerError {
  constructor(message: string) {
    super("credential-unavailable", message);
    this.name = "CredentialUnavailableError";
  }
}

/** A credential reference is out of scope for the active provider instance/tenant. */
export class CredentialScopeError extends ProviderLayerError {
  constructor(code: ProviderErrorCode, message: string) {
    super(code, message);
    this.name = "CredentialScopeError";
  }
}

/** A provider produced a category result that fails canonical category validation. */
export class ProviderOutputInvalidError extends ProviderLayerError {
  constructor(message: string) {
    super("provider-output-invalid", message);
    this.name = "ProviderOutputInvalidError";
  }
}
