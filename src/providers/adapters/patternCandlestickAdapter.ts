/**
 * afi-adapter-pattern-candlestick@1.0.0 — the KEYLESS first-party local pattern
 * adapter (FLPR-GOV D-FLPR-2 item 4): the reference instance of the pattern lane.
 *
 * Runs the trusted in-process candlestick/structure kernels (detectPatterns)
 * over the candles produced by the technical lane (delivered as the node input
 * via the manifest's 'candles' port edge) and emits exactly ONE governed
 * 'pattern' category result. The scorer-visible candlestick observation
 * (patternName + patternConfidence) is carried in the D-FLPR-3 candlestick
 * block — byte-preserving the pre-activation scoring inputs, since the SAME
 * kernel computes them.
 *
 * Keyless: ctx.credential is undefined and the SecretResolver is never
 * invoked. No I/O of any kind — this adapter is a pure local computation.
 */
import { NodeConfigurationError } from "../../pipeline/nodeSdk.js";
import { detectPatterns } from "../../enrichment/patternRecognition.js";
import type { AfiCandle } from "../../types/AfiCandle.js";
import type { CandlestickObservation } from "../../pipeline/nodes/laneView.js";
import type { CategoryResult, ProviderAdapter, ProviderAdapterContext } from "../types.js";

export interface PatternCandlestickAdapterDeps {
  detect: typeof detectPatterns;
}

const MAX_CANDLES = 10000;
const MAX_SERIES_ID_LENGTH = 200;

function extractCandles(input: unknown): AfiCandle[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_CANDLES) {
    throw new NodeConfigurationError(
      "pattern candlestick adapter requires the technical lane's candles port as its input (non-empty candle array)"
    );
  }
  for (const c of input) {
    if (
      c === null ||
      typeof c !== "object" ||
      typeof (c as AfiCandle).open !== "number" ||
      typeof (c as AfiCandle).high !== "number" ||
      typeof (c as AfiCandle).low !== "number" ||
      typeof (c as AfiCandle).close !== "number"
    ) {
      throw new NodeConfigurationError(
        "pattern candlestick adapter requires OHLC candles with finite numeric fields"
      );
    }
  }
  return input as AfiCandle[];
}

export function createPatternCandlestickAdapter(
  deps: PatternCandlestickAdapterDeps = { detect: detectPatterns }
): ProviderAdapter {
  return {
    adapterId: "afi-adapter-pattern-candlestick",
    adapterVersion: "1.0.0",
    category: "pattern",
    providerCompatibility: ["afi-provider-pattern-candlestick"],
    requiresCredential: false,
    async run(ctx: ProviderAdapterContext): Promise<CategoryResult> {
      const candles = extractCandles(ctx.input);

      let seriesId = `${ctx.signal.provenance?.signalId ?? "signal"}:candles:close`;
      if (seriesId.length > MAX_SERIES_ID_LENGTH) seriesId = seriesId.slice(0, MAX_SERIES_ID_LENGTH);

      const detection = deps.detect(candles);

      let candlestick: CandlestickObservation | undefined;
      if (
        detection &&
        detection.patternName !== undefined &&
        detection.patternConfidence !== undefined
      ) {
        candlestick = {
          patternName: detection.patternName as CandlestickObservation["patternName"],
          patternConfidence: detection.patternConfidence,
          flags: {
            bullishEngulfing: detection.bullishEngulfing,
            bearishEngulfing: detection.bearishEngulfing,
            pinBar: detection.pinBar,
            insideBar: detection.insideBar,
          },
          ...(detection.structureBias !== undefined
            ? { structureBias: detection.structureBias }
            : {}),
          ...(detection.trendPullbackConfirmed !== undefined
            ? { trendPullbackConfirmed: detection.trendPullbackConfirmed }
            : {}),
        };
      }

      ctx.logger.info("candlestick pattern analysis computed (provider adapter)", {
        seriesId,
        candles: candles.length,
        patternName: candlestick?.patternName ?? null,
      });

      return {
        category: "pattern",
        series: { seriesId, length: candles.length, indexBasis: "position" },
        motifs: [],
        discords: [],
        changePoints: [],
        pivots: [],
        ...(candlestick ? { candlestick } : {}),
      };
    },
  };
}

/** Production singleton (pure local kernels; no transport, no credential). */
export const patternCandlestickAdapter: ProviderAdapter = createPatternCandlestickAdapter();
