/**
 * Reference secret backend (FLPR-GOV D-FLPR-7 item 2).
 *
 * The static least-privilege allow-map feeding the env-backed development
 * SecretResolver: exactly one env-var NAME per (tenant, credentialRef) pair,
 * covering only the two committed BYOK credential-ref records. Names only —
 * no secret values live in code, and an unprovisioned env var fails closed at
 * invocation (CredentialUnavailableError → the lane's declared failure policy
 * records the degradation; nothing is fabricated).
 *
 * HONESTLY NON-PRODUCTION: deployment-grade secret backends remain a later
 * staging wave (PBF-GOV posture unchanged).
 */
import { EnvSecretResolver, type SecretResolver } from "./secretResolver.js";

/** (tenant, credentialRef) → env-var NAME. Extend only with governed records. */
export const REFERENCE_SECRET_ALLOW_MAP = [
  { tenant: "reference", credentialRef: "credential-newsdata-reference", envVar: "NEWSDATA_API_KEY" },
  { tenant: "reference", credentialRef: "credential-coinalyze-reference", envVar: "COINALYZE_API_KEY" },
] as const;

export function createReferenceSecretResolver(env: NodeJS.ProcessEnv = process.env): SecretResolver {
  return new EnvSecretResolver([...REFERENCE_SECRET_ALLOW_MAP], env);
}
