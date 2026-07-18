/**
 * Trusted client for the self-hosted Tiny Brains aiMl inference endpoint
 * (POST /predict/froggy). Service address comes from the deployment's
 * TINY_BRAINS_URL (never an analyst-supplied URL), with an X-AFI-Client
 * header and a bounded timeout. FAIL-CLOSED: configuration absence, non-2xx
 * responses, transport errors, and malformed response shapes all throw — the
 * invoking lane's declared failure policy records the degradation honestly
 * (no fabricated enrichment, FLPR-GOV D-FLPR-2 scope-guard).
 */

export interface AimlServiceInput {
  signalId: string;
  symbol: string;
  timeframe: string;
  traceId?: string;
  technical?: unknown;
  pattern?: unknown;
  sentiment?: unknown;
  newsFeatures?: unknown;
}

export interface AimlServicePrediction {
  convictionScore: number;
  direction: "long" | "short" | "neutral";
  regime?: string;
  riskFlag?: boolean;
  notes?: string | null;
}

export interface AimlServiceClientOptions {
  timeoutMs?: number;
  abort?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Base URL override (tests only); production reads TINY_BRAINS_URL. */
  baseUrl?: string;
}

function effectiveSignal(abort?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  const timeout = typeof timeoutMs === "number" ? AbortSignal.timeout(timeoutMs) : undefined;
  if (abort && timeout) return AbortSignal.any([abort, timeout]);
  return timeout ?? abort;
}

export async function callAimlService(
  input: AimlServiceInput,
  options: AimlServiceClientOptions = {}
): Promise<AimlServicePrediction> {
  const baseUrl = (options.baseUrl ?? process.env.TINY_BRAINS_URL?.trim()) || null;
  if (!baseUrl) {
    throw new Error("aiMl service unavailable: TINY_BRAINS_URL is not configured");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${baseUrl}/predict/froggy`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AFI-Client": "afi-reactor-aiml-v1",
    },
    body: JSON.stringify(input),
    signal: effectiveSignal(options.abort, options.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`aiMl service error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as Partial<AimlServicePrediction>;
  if (
    typeof data?.convictionScore !== "number" ||
    !Number.isFinite(data.convictionScore) ||
    data.convictionScore < 0 ||
    data.convictionScore > 1 ||
    !["long", "short", "neutral"].includes(data.direction as string)
  ) {
    throw new Error("aiMl service returned a malformed prediction");
  }
  return data as AimlServicePrediction;
}
