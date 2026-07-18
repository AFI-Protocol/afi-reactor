/**
 * Runtime composition root (W3 spec sections 3-4; the production switch of
 * SLOT-FCP-REACTOR).
 *
 * Owns the ONE boot-validated view of the governed afi-config registries and
 * the ONE GraphExecutor the live endpoints score through:
 *
 *  - `initRuntimeComposition()` runs validateRuntimeConfig() over the
 *    registries under node_modules/afi-config (the ussValidator resolution
 *    convention) with the build-time plugin registry, and constructs the
 *    executor bound to the validated plugin manifests. ANY invalid ACTIVE
 *    entry throws RuntimeConfigValidationError — the server REFUSES TO START
 *    (src/server.ts calls this before listen(); D-FCP-8 honest failure, no
 *    lazy discovery at request time).
 *  - `getRuntimeComposition()` returns the initialized composition (lazily
 *    initializing under test imports, where the server never listens).
 *
 * This module (with src/pipeline/registryLoader.ts it calls) is the ONLY
 * reader of these registries — never src/pipeheads, never src/cli (RC-7
 * string bans untouched; the uwr-profiles registry keeps its own single
 * authorized reader, src/config/uwrRuntimeProfile.ts).
 *
 * Test seams (same discipline as __resetUwrRuntimeConfigForTests): tests may
 * point the composition at a fixture/overlay registry root and/or inject a
 * test plugin registry. Production code never calls the seams.
 */
import { GraphExecutor } from "../pipeline/executor.js";
import type { NodeLogger } from "../pipeline/nodeSdk.js";
import {
  builtinPluginRegistry,
  type PluginRegistry,
} from "../pipeline/pluginRegistry.js";
import {
  validateRuntimeConfig,
  type ValidatedRuntimeConfig,
} from "../pipeline/registryLoader.js";
import { scrubbingLogger } from "../providers/redaction.js";
import { buildProviderRuntime } from "../providers/index.js";
import type { ProviderRuntime } from "../providers/providerRuntime.js";

export interface RuntimeComposition {
  /** The boot-validated registries + resolved active strategies. */
  runtime: ValidatedRuntimeConfig;
  /** The build-time plugin binding the validation ran against. */
  pluginRegistry: PluginRegistry;
  /** The manifest-driven executor the live endpoints score through. */
  executor: GraphExecutor;
  /**
   * The bounded provider-adapter runtime (PBF-GOV Wave 1). Constructed at boot
   * so the trusted adapter registry is validated fail-closed (duplicate
   * registration throws); the froggy production pipeline uses no provider-backed
   * nodes, so it resolves nothing by default.
   */
  providerRuntime: ProviderRuntime;
}

/** Structured operational node logger (console-backed; never hash material). */
const RAW_CONSOLE_NODE_LOGGER: NodeLogger = {
  debug(message, fields) {
    if (process.env.AFI_PIPELINE_DEBUG === "1") console.debug(`[pipeline] ${message}`, fields ?? "");
  },
  info(message, fields) {
    console.log(`[pipeline] ${message}`, fields ?? "");
  },
  warn(message, fields) {
    console.warn(`[pipeline] ${message}`, fields ?? "");
  },
  error(message, fields) {
    console.error(`[pipeline] ${message}`, fields ?? "");
  },
};

/**
 * The production node logger: the console logger wrapped by the secret scrubber
 * (PBF-GOV §8.2). Every node's log message + fields are redacted before they
 * reach the console, so a provider credential can never escape through a node
 * log even if a field carries it.
 */
const CONSOLE_NODE_LOGGER: NodeLogger = scrubbingLogger(RAW_CONSOLE_NODE_LOGGER);

interface CompositionOverrides {
  configRoot?: string;
  pluginRegistry?: PluginRegistry;
}

let overrides: CompositionOverrides | undefined;
let current: RuntimeComposition | undefined;

/**
 * Boot gate: validate the ACTIVE registry composition and build the executor.
 * Throws RuntimeConfigValidationError on ANY invalid active entry — callers
 * (server boot) must NOT catch-and-serve.
 */
export function initRuntimeComposition(): RuntimeComposition {
  const pluginRegistry = overrides?.pluginRegistry ?? builtinPluginRegistry();
  const runtime = validateRuntimeConfig({
    pluginRegistry,
    configRoot: overrides?.configRoot,
  });
  const executor = new GraphExecutor({
    registry: pluginRegistry,
    pluginManifests: runtime.registries.analysisPlugins,
    logger: CONSOLE_NODE_LOGGER,
    onNodeEvent: (event) => {
      // Structured per-node metrics { nodeId, status, durationMs, attempt } —
      // operational only, NEVER part of any hashed artifact.
      console.log(
        `[pipeline] node=${event.nodeId} status=${event.status} durationMs=${event.durationMs} attempt=${event.attempt}`
      );
    },
  });
  // Construct the bounded provider runtime at boot: the trusted adapter
  // registry is validated fail-closed here (a duplicate registration throws).
  const providerRuntime = buildProviderRuntime();
  current = { runtime, pluginRegistry, executor, providerRuntime };
  return current;
}

/** The initialized composition (lazy under test imports; eager at server boot). */
export function getRuntimeComposition(): RuntimeComposition {
  return current ?? initRuntimeComposition();
}

/**
 * TEST-ONLY seam: point the composition at an overlay registry root and/or a
 * test plugin registry, discarding any initialized state. Mirrors the
 * __resetUwrRuntimeConfigForTests convention (also consumed by the compiled
 * real-Mongo IT scripts, which cannot use jest module mapping).
 */
export function __setRuntimeCompositionOverridesForTests(o: CompositionOverrides): void {
  overrides = o;
  current = undefined;
}

/** TEST-ONLY seam: restore the production composition resolution. */
export function __resetRuntimeCompositionForTests(): void {
  overrides = undefined;
  current = undefined;
}
