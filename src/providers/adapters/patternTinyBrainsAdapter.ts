/**
 * afi-adapter-pattern-tiny-brains@1.0.0 — the KEYLESS self-hosted pattern
 * service adapter (FLPR-GOV D-FLPR-2 item 5; the Mission 4 deterministic
 * STUMPY/ruptures/find_peaks kernel stack behind the governed contract).
 *
 * Derives the bounded close-price series from the candles produced by the
 * technical lane (delivered as the node input via the manifest's 'candles'
 * port edge), calls the trusted self-hosted Tiny Brains pattern endpoint via
 * the existing service-client convention (fail-closed), and returns exactly
 * ONE governed 'pattern' category result.
 *
 * Algorithm parameters come from a fixed TRUSTED ADAPTER PROFILE — never an
 * analyst-supplied kernel-argument bag, never an analyst-supplied endpoint
 * (the service address is the deployment's TINY_BRAINS_URL). The adapter
 * never scores, weights, ranks, or invokes UWR, and it performs no
 * market-based provider selection (the node selects the ProviderInstance).
 */
import type {
  callPatternService,
  PatternAnalysisParams,
  PatternAnalyzeRequest,
} from "../clients/patternServiceClient.js";
import type { AfiCandle } from "../../types/AfiCandle.js";
import type { CategoryResult, ProviderAdapter, ProviderAdapterContext } from "../types.js";

export interface PatternTinyBrainsAdapterDeps {
  callService: typeof callPatternService;
}

/** Load the real Tiny Brains pattern client only when the production adapter runs. */
async function loadProductionDeps(): Promise<PatternTinyBrainsAdapterDeps> {
  const { callPatternService } = await import("../clients/patternServiceClient.js");
  return { callService: callPatternService };
}

/**
 * Fixed, trusted algorithm profile. NOT analyst-configurable — the closed
 * provider-instance invocation object carries no kernel parameters (anti-abuse),
 * and there is no arbitrary-argument surface.
 */
const TRUSTED_PROFILE: PatternAnalysisParams = {
  windowSize: 16,
  maxObservations: 8,
  changePointPenalty: 12.0,
  peakProminence: 0.05,
};

const MAX_CANDLES = 10000;
const MAX_SERIES_ID_LENGTH = 200;

interface ExtractedSeries {
  seriesId: string;
  values: number[];
  timestamps?: number[];
}

/**
 * Derive the bounded close-price series from the technical lane's candles
 * port. A missing/malformed candle input is an upstream-data absence (e.g. a
 * degraded technical lane): an ordinary error, absorbed by the node's
 * declared failure policy as a recorded degradation — never fatal, never a
 * silent empty result.
 */
function extractSeries(input: unknown, signalId: string): ExtractedSeries {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_CANDLES) {
    throw new Error(
      "pattern tiny-brains adapter requires the technical lane's candles port as its input (non-empty candle array)"
    );
  }
  const values: number[] = [];
  const timestamps: number[] = [];
  let allTimestamps = true;
  for (const c of input) {
    const close = (c as AfiCandle)?.close;
    if (typeof close !== "number" || !Number.isFinite(close)) {
      throw new Error("pattern tiny-brains adapter requires candles with finite numeric close values");
    }
    values.push(close);
    const ts = (c as AfiCandle)?.timestamp;
    if (typeof ts === "number" && Number.isFinite(ts)) timestamps.push(ts);
    else allTimestamps = false;
  }
  let seriesId = `${signalId}:candles:close`;
  if (seriesId.length > MAX_SERIES_ID_LENGTH) seriesId = seriesId.slice(0, MAX_SERIES_ID_LENGTH);
  return {
    seriesId,
    values,
    timestamps: allTimestamps && strictlyIncreasing(timestamps) ? timestamps : undefined,
  };
}

function strictlyIncreasing(ts: number[]): boolean {
  for (let i = 1; i < ts.length; i++) if (ts[i] <= ts[i - 1]) return false;
  return ts.length > 0;
}

export function createPatternTinyBrainsAdapter(deps?: PatternTinyBrainsAdapterDeps): ProviderAdapter {
  return {
    adapterId: "afi-adapter-pattern-tiny-brains",
    adapterVersion: "1.0.0",
    transportKind: "http",
    category: "pattern",
    providerCompatibility: ["afi-provider-pattern-tiny-brains"],
    requiresCredential: false,
    async run(ctx: ProviderAdapterContext): Promise<CategoryResult> {
      const d = deps ?? (await loadProductionDeps());
      const signalId = ctx.signal.provenance?.signalId ?? "signal";
      const series = extractSeries(ctx.input, signalId);

      const request: PatternAnalyzeRequest = {
        seriesId: series.seriesId,
        values: series.values,
        timestamps: series.timestamps,
        params: TRUSTED_PROFILE,
      };

      // Operator-configured, non-secret invocation timeout (from the provider
      // instance's invocation settings); undefined falls back to no client timeout.
      const timeoutRaw = ctx.config["timeoutMs"];
      const timeoutMs = typeof timeoutRaw === "number" ? timeoutRaw : undefined;

      // Fail CLOSED on service error — no silent provider fallback (the node's
      // declared failure policy handles the thrown error).
      const response = await d.callService(request, { timeoutMs, abort: ctx.abort });

      ctx.logger.info("pattern analysis computed (tiny-brains provider adapter)", {
        seriesId: series.seriesId,
        length: series.values.length,
        motifs: response.motifs.length,
        discords: response.discords.length,
        changePoints: response.changePoints.length,
        pivots: response.pivots.length,
      });

      return {
        category: "pattern",
        series: response.series,
        motifs: response.motifs,
        discords: response.discords,
        changePoints: response.changePoints,
        pivots: response.pivots,
      };
    },
  };
}

/** Production singleton (lazy client; no transport loaded until first run()). */
export const patternTinyBrainsAdapter: ProviderAdapter = createPatternTinyBrainsAdapter();
