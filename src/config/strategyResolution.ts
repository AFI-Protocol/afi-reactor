/**
 * Provider-binding strategy resolution (W3 spec section 4; D-FCP-5) — the
 * composition root that turns an authenticated inbound request into the ONE
 * registered analyst-strategy the run will execute. Replaces the static
 * froggy wiring and the CPJ cpj-ingested constant.
 *
 * Rules (fixed):
 *  - Bindings come from the boot-validated provider-strategy-binding registry
 *    (validateRuntimeConfig — no lazy discovery, no request-time file reads).
 *  - The provider identity is resolved by the ROUTE (webhook:
 *    payload.providerId || AFI_DEFAULT_PROVIDER_ID || 'tradingview-default';
 *    CPJ: provenance.providerId) and authenticated by the existing route
 *    secret when set — this module receives the already-resolved providerId.
 *  - No binding for (providerId, providerType) → 403 unknown_provider_binding.
 *    Binding present but inactive → 403 inactive_provider_binding.
 *  - A payload that NAMES a strategy (a registered strategyId, or the full
 *    'analystId/strategyId@version' form) must name one of the binding's
 *    allowedStrategies → otherwise 403 unauthorized_strategy.
 *  - A payload that omits the strategy or carries free text (not a registered
 *    strategy name) resolves to the binding's defaultStrategy; a binding
 *    with no defaultStrategy rejects → 403 unauthorized_strategy.
 *  - NO silent froggy fallback anywhere: absence of a binding is an honest
 *    rejection (D-FCP-8), never a default composition.
 *
 * Resolution happens BEFORE USS mapping, so `facts.strategy` is the resolved
 * strategyId on both routes (the mappers take the resolved strategy as
 * input) — the DOCUMENTED intentional oracle difference class 1
 * (test/oracle/INTENTIONAL_DIFFS.md).
 */
import type {
  ProviderStrategyBinding,
  StrategyTriple,
} from "../pipeline/manifestTypes.js";
import type {
  ResolvedStrategy,
  ValidatedRuntimeConfig,
} from "../pipeline/registryLoader.js";

export type StrategyResolutionRejection =
  | "unknown_provider_binding"
  | "inactive_provider_binding"
  | "unauthorized_strategy";

/** An honest 403 resolution rejection (never a silent fallback). */
export class StrategyResolutionError extends Error {
  readonly code: StrategyResolutionRejection;
  readonly httpStatus = 403 as const;
  readonly providerId: string;
  readonly requestedStrategy?: string;
  constructor(
    code: StrategyResolutionRejection,
    message: string,
    providerId: string,
    requestedStrategy?: string
  ) {
    super(message);
    this.name = "StrategyResolutionError";
    this.code = code;
    this.providerId = providerId;
    this.requestedStrategy = requestedStrategy;
  }
}

export interface StrategyResolutionRequest {
  /** The route-resolved provider identity. */
  providerId: string;
  providerType: ProviderStrategyBinding["providerType"];
  /** The inbound strategy field (webhook); CPJ passes undefined. */
  requestedStrategy?: string | null;
}

export interface StrategyResolutionResult {
  binding: ProviderStrategyBinding;
  triple: StrategyTriple;
  strategy: ResolvedStrategy;
}

/**
 * The webhook route's provider identity, resolved exactly as today
 * (tradingViewMapper.deriveProviderId): explicit payload providerId (when it
 * is a usable string — a non-string value is left for USS schema validation
 * to reject honestly), then AFI_DEFAULT_PROVIDER_ID, then the
 * 'tradingview-default' constant.
 */
export function resolveWebhookProviderId(payload: { providerId?: unknown }): string {
  if (typeof payload.providerId === "string" && payload.providerId.length > 0) {
    return payload.providerId;
  }
  return process.env.AFI_DEFAULT_PROVIDER_ID || "tradingview-default";
}

function tripleKey(t: StrategyTriple): string {
  return `${t.analystId}/${t.strategyId}@${t.strategyVersion}`;
}

/** Parses the 'analystId/strategyId@version' form; null for anything else. */
function parseFullForm(requested: string): StrategyTriple | null {
  const m = /^([^/@\s]+)\/([^/@\s]+)@([^/@\s]+)$/.exec(requested);
  if (!m) return null;
  return { analystId: m[1], strategyId: m[2], strategyVersion: m[3] };
}

/**
 * Resolve the registered strategy this request is authorized to execute.
 * Throws StrategyResolutionError (403) on every rejection path.
 */
export function resolveStrategyForProvider(
  request: StrategyResolutionRequest,
  runtime: ValidatedRuntimeConfig
): StrategyResolutionResult {
  const { providerId, providerType } = request;

  const candidates = [...runtime.bindings.values()]
    .filter((b) => b.providerId === providerId && b.providerType === providerType)
    .sort((a, b) => (a.bindingId < b.bindingId ? -1 : 1));
  if (candidates.length === 0) {
    throw new StrategyResolutionError(
      "unknown_provider_binding",
      `no provider-strategy binding is registered for provider '${providerId}' (${providerType}) — refusing to score (D-FCP-5: no silent default composition).`,
      providerId
    );
  }
  const binding = candidates.find((b) => b.status === "active");
  if (!binding) {
    throw new StrategyResolutionError(
      "inactive_provider_binding",
      `the provider-strategy binding for provider '${providerId}' (${providerType}) is inactive — refusing to score.`,
      providerId
    );
  }

  const requested =
    typeof request.requestedStrategy === "string" && request.requestedStrategy.trim().length > 0
      ? request.requestedStrategy.trim()
      : undefined;

  let triple: StrategyTriple | undefined;
  if (requested !== undefined) {
    const fullForm = parseFullForm(requested);
    // 1. The request NAMES one of the binding's allowed strategies.
    const allowed = [...binding.allowedStrategies].sort((a, b) =>
      tripleKey(a) < tripleKey(b) ? -1 : 1
    );
    triple = fullForm
      ? allowed.find(
          (t) =>
            t.analystId === fullForm.analystId &&
            t.strategyId === fullForm.strategyId &&
            t.strategyVersion === fullForm.strategyVersion
        )
      : allowed.find((t) => t.strategyId === requested);
    if (!triple) {
      // 2. The request names a REGISTERED strategy this binding does not
      //    allow → unauthorized (fail closed, never the default).
      const namesRegistered = fullForm
        ? runtime.strategies.has(tripleKey(fullForm))
        : [...runtime.strategies.values()].some(
            (s) => s.registration.strategyId === requested
          );
      if (namesRegistered) {
        throw new StrategyResolutionError(
          "unauthorized_strategy",
          `strategy '${requested}' is not in the allowedStrategies of the binding for provider '${providerId}' — refusing to score.`,
          providerId,
          requested
        );
      }
      // 3. Free text (not a registered strategy name) → default path below.
    }
  }

  if (!triple) {
    if (!binding.defaultStrategy) {
      throw new StrategyResolutionError(
        "unauthorized_strategy",
        `no resolvable strategy for provider '${providerId}': the request ${
          requested === undefined ? "names no strategy" : `carries unrecognized strategy text '${requested}'`
        } and the binding declares no defaultStrategy.`,
        providerId,
        requested
      );
    }
    triple = binding.defaultStrategy;
  }

  const strategy = runtime.strategies.get(tripleKey(triple));
  if (!strategy) {
    // Boot validation guarantees every allowed/default triple resolves to an
    // ACTIVE registration; reaching here is a deployment defect.
    throw new StrategyResolutionError(
      "unauthorized_strategy",
      `strategy ${tripleKey(triple)} does not resolve to an active registration (boot/runtime registry divergence).`,
      providerId,
      requested
    );
  }
  return { binding, triple, strategy };
}
