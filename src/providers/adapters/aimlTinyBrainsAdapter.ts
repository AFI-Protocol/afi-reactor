/**
 * afi-adapter-aiml-tiny-brains@1.1.0 — the KEYLESS first-party aiMl adapter
 * (FLPR-GOV D-FLPR-2 item 3): invokes the self-hosted Tiny Brains service and
 * emits exactly ONE governed 'aiMl' category result.
 *
 * The aiMl lane is a PRE-MERGE analysis lane: its joined input is the sibling
 * lane outputs ({ parents: { nodeId: output } } namespaces). The adapter
 * classifies parents by their category marker (never by node id), derives the
 * REAL close-price candle series from the technical lane's contribution, and
 * posts ONE canonical request naming the EXPLICIT Tiny Brains orchestration
 * profile — ctx.model, the governed ProviderInstance `model` field, verbatim.
 * Which internal experts run behind that profile is invisible here: the
 * Reactor knows no expert names, no model names, no resolver details.
 *
 * Tiny Brains remains a replaceable, non-authority, first-party service
 * (PBF-GOV D-PBF-3): the result is never read by the scorer. FAIL-CLOSED on
 * missing profile, missing/malformed candles, and service absence/error —
 * the lane's declared failure policy records the degradation; nothing is
 * fabricated and nothing falls back silently.
 */
import type { AfiCandle } from "../../types/AfiCandle.js";
import { NodeConfigurationError } from "../../pipeline/nodeSdk.js";
import type {
  callAimlService,
  AimlCandle,
  AimlServiceInput,
} from "../clients/aimlServiceClient.js";
import type {
  AdapterRunEnvelope,
  CategoryResult,
  ProviderAdapter,
  ProviderAdapterContext,
} from "../types.js";

export interface AimlTinyBrainsAdapterDeps {
  callService: typeof callAimlService;
}

/** Load the real Tiny Brains aiMl client only when the production adapter runs. */
async function loadProductionDeps(): Promise<AimlTinyBrainsAdapterDeps> {
  const { callAimlService } = await import("../clients/aimlServiceClient.js");
  return { callService: callAimlService };
}

const REGIME_LABEL_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/** Series bounds mirroring the Tiny Brains canonical request contract. */
const MIN_CANDLES = 32;
const MAX_CANDLES = 512;

/** Classify the joined parent namespaces by category marker (sorted node ids). */
function technicalParent(input: unknown): Record<string, unknown> | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const parents = (input as { parents?: Record<string, unknown> }).parents;
  if (!parents || typeof parents !== "object") return undefined;
  for (const nodeId of Object.keys(parents).sort()) {
    const contribution = parents[nodeId];
    if (contribution === null || typeof contribution !== "object") continue;
    if ((contribution as { category?: unknown }).category === "technical") {
      return contribution as Record<string, unknown>;
    }
  }
  return undefined;
}

/**
 * Derive the bounded close-price candle series from the technical lane's
 * contribution. A missing/short/malformed series is an upstream-data absence
 * (e.g. a degraded technical lane): an ordinary error, absorbed by the node's
 * declared failure policy as a recorded degradation — never fabricated.
 */
function extractCandles(input: unknown): AimlCandle[] {
  const technical = technicalParent(input);
  const raw = technical?.candles;
  if (!Array.isArray(raw) || raw.length < MIN_CANDLES) {
    throw new Error(
      "aiMl tiny-brains adapter requires the technical lane's candles (>= 32) in its joined input"
    );
  }
  const bounded = raw.slice(-MAX_CANDLES);
  const candles: AimlCandle[] = [];
  for (const c of bounded) {
    const candle = c as AfiCandle;
    if (
      typeof candle?.close !== "number" ||
      !Number.isFinite(candle.close) ||
      typeof candle?.timestamp !== "number" ||
      !Number.isFinite(candle.timestamp)
    ) {
      throw new Error(
        "aiMl tiny-brains adapter requires candles with finite numeric close and timestamp values"
      );
    }
    const out: AimlCandle = { timestamp: candle.timestamp, close: candle.close };
    if (typeof candle.open === "number" && Number.isFinite(candle.open)) out.open = candle.open;
    if (typeof candle.high === "number" && Number.isFinite(candle.high)) out.high = candle.high;
    if (typeof candle.low === "number" && Number.isFinite(candle.low)) out.low = candle.low;
    if (typeof candle.volume === "number" && Number.isFinite(candle.volume)) {
      out.volume = candle.volume;
    }
    candles.push(out);
  }
  return candles;
}

export function createAimlTinyBrainsAdapter(deps?: AimlTinyBrainsAdapterDeps): ProviderAdapter {
  return {
    adapterId: "afi-adapter-aiml-tiny-brains",
    adapterVersion: "1.1.0",
    transportKind: "http",
    category: "aiMl",
    providerCompatibility: ["afi-provider-aiml-tiny-brains"],
    requiresCredential: false,
    async run(ctx: ProviderAdapterContext): Promise<AdapterRunEnvelope> {
      const d = deps ?? (await loadProductionDeps());

      // The explicit orchestration profile MUST come from the governed
      // ProviderInstance record — there is no default and no adapter-side
      // profile knowledge (fail closed as a configuration error).
      if (typeof ctx.model !== "string" || ctx.model.length === 0) {
        throw new NodeConfigurationError(
          "aiMl tiny-brains adapter requires the provider instance to name an orchestration profile via its governed 'model' field"
        );
      }

      const candles = extractCandles(ctx.input);
      const signalId = ctx.signal.provenance?.signalId ?? "";
      const symbol = typeof ctx.signal.facts?.symbol === "string" ? ctx.signal.facts.symbol : "";
      const timeframe =
        typeof ctx.signal.facts?.timeframe === "string" ? ctx.signal.facts.timeframe : "";

      const serviceInput: AimlServiceInput = {
        signalId,
        symbol,
        timeframe,
        traceId: signalId,
        profile: ctx.model,
        candles,
      };

      const timeoutRaw = ctx.config["timeoutMs"];
      const timeoutMs = typeof timeoutRaw === "number" ? timeoutRaw : undefined;

      // Fail CLOSED on service absence/error — no fabricated neutral, no fallback.
      const prediction = await d.callService(serviceInput, { timeoutMs, abort: ctx.abort });

      // The client verifies the D-EV3-3 invocation block (strict parse,
      // profile echo, tiny-brains.hash.v1 outputHash recomputation) before it
      // reaches this adapter. Its ABSENCE here means an injected transport
      // bypassed the trusted client — fail closed, never an unproven lane.
      if (!prediction.invocation) {
        throw new Error(
          "aiMl service prediction carried no verified invocation block (EV3-GOV D-EV3-3)"
        );
      }

      ctx.logger.info("aiMl forecast computed (tiny-brains provider adapter)", {
        signalId,
        profile: ctx.model,
        direction: prediction.direction,
        conviction: prediction.convictionScore,
      });

      const result: CategoryResult = {
        category: "aiMl",
        forecast: {
          direction: prediction.direction,
          conviction: prediction.convictionScore,
        },
      };
      if (
        typeof prediction.regime === "string" &&
        REGIME_LABEL_PATTERN.test(prediction.regime)
      ) {
        (result as Record<string, unknown>).regime = { label: prediction.regime };
      }
      if (typeof prediction.riskFlag === "boolean") {
        (result as Record<string, unknown>).riskFlag = prediction.riskFlag;
      }
      // Side-channel: the VERIFIED invocation block rides the envelope to the
      // provider runtime's proof capture — never the CategoryResult (the
      // governed afi.enrichment.aiml.v1 payload is unchanged).
      return { result, serviceInvocation: prediction.invocation };
    },
  };
}

/** Production singleton (lazy client; no transport loaded until first run()). */
export const aimlTinyBrainsAdapter: ProviderAdapter = createAimlTinyBrainsAdapter();
