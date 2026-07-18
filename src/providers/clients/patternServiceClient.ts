/**
 * Tiny Brains Pattern Service Client (Mission 4).
 *
 * A single, bounded HTTP client for the ONE trusted local endpoint
 * POST /analyze/pattern on the first-party Tiny Brains service. It mirrors the
 * trusted service-client convention: native fetch, base URL from
 * TINY_BRAINS_URL (never an analyst-supplied URL), an X-AFI-Client header, and
 * an abort/timeout signal. It is NOT a generic RPC/GraphQL/WebSocket/remote
 * provider framework — one endpoint, one trusted first-party service.
 *
 * The response shape mirrors the governed afi.enrichment.pattern.v1 contract
 * MINUS the 'category' marker (the pattern adapter adds and validates that at
 * the provider-adapter edge). This client never scores and never resolves a
 * credential (the pattern provider is keyless).
 */

export interface PatternAnalysisParams {
  windowSize: number;
  maxObservations: number;
  changePointPenalty: number;
  peakProminence: number;
}

export interface PatternAnalyzeRequest {
  seriesId: string;
  values: number[];
  timestamps?: number[];
  params: PatternAnalysisParams;
}

export interface PatternSeriesMeta {
  seriesId: string;
  length: number;
  indexBasis: "position" | "epochMs";
}
export interface MotifObservation {
  windowSize: number;
  index: number;
  neighborIndex: number;
  similarity: number;
  timestamp?: number;
}
export interface DiscordObservation {
  windowSize: number;
  index: number;
  anomalyScore: number;
  timestamp?: number;
}
export interface ChangePointObservation {
  index: number;
  magnitude: number;
  timestamp?: number;
}
export interface PivotObservation {
  index: number;
  kind: "support" | "resistance";
  level: number;
  prominence: number;
  timestamp?: number;
}
export interface PatternAnalyzeResponse {
  series: PatternSeriesMeta;
  motifs: MotifObservation[];
  discords: DiscordObservation[];
  changePoints: ChangePointObservation[];
  pivots: PivotObservation[];
}

export interface PatternServiceClientOptions {
  /** Injectable transport (default: global fetch). Injected as a fake in the proof. */
  fetchImpl?: typeof fetch;
  /** Operator-configured, non-secret per-invocation timeout (ms). */
  timeoutMs?: number;
  /** Per-node abort signal to thread into the request. */
  abort?: AbortSignal;
  /** Base URL override (tests only); production reads TINY_BRAINS_URL. */
  baseUrl?: string;
}

function effectiveSignal(abort?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (abort) signals.push(abort);
  if (typeof timeoutMs === "number" && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

/**
 * Call the trusted local pattern endpoint. Fails CLOSED (throws) when the
 * service is unconfigured, unreachable, or returns a non-2xx — the caller (the
 * pattern adapter) never invents a silent fallback.
 */
export async function callPatternService(
  request: PatternAnalyzeRequest,
  options: PatternServiceClientOptions = {}
): Promise<PatternAnalyzeResponse> {
  const baseUrl = (options.baseUrl ?? process.env.TINY_BRAINS_URL?.trim()) || null;
  if (!baseUrl) {
    throw new Error("pattern service unavailable: TINY_BRAINS_URL is not configured");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${baseUrl}/analyze/pattern`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AFI-Client": "afi-reactor-pattern-v1",
    },
    body: JSON.stringify(request),
    signal: effectiveSignal(options.abort, options.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`pattern service error: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as PatternAnalyzeResponse;
}
