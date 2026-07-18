/**
 * afi-adapter-pattern-local@1.0.0 — the KEYLESS local pattern reference adapter
 * (Mission 4, on the PBF-GOV provider socket).
 *
 * The first live implementation for the previously-unimplemented 'pattern' lane.
 * It requires no credential (ctx.credential is undefined; the SecretResolver is
 * never invoked). It extracts ONLY the bounded canonical series carried on the
 * signal, calls the trusted local Tiny Brains pattern endpoint via the existing
 * service-client convention, and returns exactly ONE 'pattern' category result
 * (validated against afi.enrichment.pattern.v1 at the runtime edge).
 *
 * Algorithm parameters come from a fixed TRUSTED ADAPTER PROFILE — never an
 * analyst-supplied kernel-argument bag, never an analyst-supplied endpoint. The
 * adapter never scores, weights, ranks, or invokes UWR, and it performs no
 * market-based provider selection (the node selects the ProviderInstance).
 *
 * The Tiny Brains client is imported LAZILY (dynamic import at call time), so
 * merely importing this module — or the provider index — pulls in no transport.
 */
import { NodeConfigurationError } from "../../pipeline/nodeSdk.js";
import type {
  callPatternService,
  PatternAnalysisParams,
  PatternAnalyzeRequest,
} from "../../aiMl/patternServiceClient.js";
import type { CanonicalUss } from "../../types/canonicalUss.js";
import type { CategoryResult, ProviderAdapter, ProviderAdapterContext } from "../types.js";

export interface PatternLocalAdapterDeps {
  callService: typeof callPatternService;
}

/** Load the real Tiny Brains pattern client only when the production adapter runs. */
async function loadProductionDeps(): Promise<PatternLocalAdapterDeps> {
  const { callPatternService } = await import("../../aiMl/patternServiceClient.js");
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

/** Upper bound on the series the adapter will forward to the pattern service. */
const MAX_SERIES_LENGTH = 10000;
const MAX_SERIES_ID_LENGTH = 200;

interface ExtractedSeries {
  seriesId: string;
  values: number[];
  timestamps?: number[];
}

/**
 * Extract the bounded canonical series from the signal — the safe, explicit
 * source (the signal's own declared, adapter-validated numeric series). A signal
 * with no usable series is a configuration error (fail closed), never a silent
 * empty result.
 */
function extractSeries(signal: CanonicalUss): ExtractedSeries {
  const facts = (signal as { facts?: Record<string, unknown> }).facts;
  const raw = facts?.["series"];
  if (!raw || typeof raw !== "object") {
    throw new NodeConfigurationError(
      "pattern adapter requires a bounded numeric series on the canonical signal (facts.series)"
    );
  }
  const series = raw as { seriesId?: unknown; values?: unknown; timestamps?: unknown };

  const values = series.values;
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_SERIES_LENGTH) {
    throw new NodeConfigurationError(
      `pattern adapter requires facts.series.values to be a non-empty numeric array of at most ${MAX_SERIES_LENGTH} points`
    );
  }
  const numericValues: number[] = [];
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new NodeConfigurationError("pattern adapter requires all facts.series.values to be finite numbers");
    }
    numericValues.push(v);
  }

  let timestamps: number[] | undefined;
  if (series.timestamps !== undefined && series.timestamps !== null) {
    const ts = series.timestamps;
    if (!Array.isArray(ts) || ts.length !== numericValues.length) {
      throw new NodeConfigurationError(
        "pattern adapter requires facts.series.timestamps (when present) to align 1:1 with values"
      );
    }
    const numericTs: number[] = [];
    for (const t of ts) {
      if (typeof t !== "number" || !Number.isFinite(t)) {
        throw new NodeConfigurationError("pattern adapter requires all facts.series.timestamps to be finite numbers");
      }
      numericTs.push(t);
    }
    timestamps = numericTs;
  }

  // Non-secret, bounded series identity: prefer an explicit id, else derive one
  // deterministically from the signal (no market-based routing is performed).
  let seriesId =
    typeof series.seriesId === "string" && series.seriesId.length > 0
      ? series.seriesId
      : `${signal.provenance?.signalId ?? "signal"}:pattern`;
  if (seriesId.length > MAX_SERIES_ID_LENGTH) seriesId = seriesId.slice(0, MAX_SERIES_ID_LENGTH);

  return { seriesId, values: numericValues, timestamps };
}

export function createPatternLocalAdapter(deps?: PatternLocalAdapterDeps): ProviderAdapter {
  return {
    adapterId: "afi-adapter-pattern-local",
    adapterVersion: "1.0.0",
    category: "pattern",
    providerCompatibility: ["afi-provider-pattern-local"],
    requiresCredential: false,
    async run(ctx: ProviderAdapterContext): Promise<CategoryResult> {
      const d = deps ?? (await loadProductionDeps());
      const series = extractSeries(ctx.signal);

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

      // Fail CLOSED on service error — no silent provider fallback (the runtime's
      // category-node failure policy handles the thrown error).
      const response = await d.callService(request, { timeoutMs, abort: ctx.abort });

      ctx.logger.info("pattern analysis computed (provider adapter)", {
        seriesId: series.seriesId,
        length: series.values.length,
        motifs: response.motifs.length,
        discords: response.discords.length,
        changePoints: response.changePoints.length,
        pivots: response.pivots.length,
      });

      // Normalize to the ONE category-result contract: add the 'pattern' marker
      // and pass through the bounded, normalized observations. The runtime
      // validates this against afi.enrichment.pattern.v1 before it reaches scoring.
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
export const patternLocalAdapter: ProviderAdapter = createPatternLocalAdapter();
