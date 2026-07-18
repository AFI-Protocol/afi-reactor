/**
 * Boot-time registry loader + validator (W3 spec section 3).
 *
 * Reads the governed FACTORY-CONTRACT registries from the afi-config
 * dependency EXACTLY like src/uss/ussValidator.ts loads schemas: raw JSON
 * reads under node_modules/afi-config, anchored at process.cwd() (the
 * file:-dependency mechanism), overridable for tests via options.configRoot
 * (test fixture registries under test/ — nothing here depends on any live
 * checkout's branch state).
 *
 * validateRuntimeConfig() is the unit-testable boot gate:
 *   1. loads the VENDORED contract schema closure
 *      (src/pipeline/governed-schema/, byte-pinned to afi-config@e462c4e8);
 *   2. reads registries/{analysis-plugins,pipelines,analyst-strategies,
 *      provider-bindings}/;
 *   3. AJV-validates every entry, enforces the graph-semantic invariants,
 *      recomputes + verifies manifestHash and analystConfigHash, recomputes
 *      pluginSetHash over each pipeline's bound plugin set, verifies every
 *      pluginId@version is bound in the build-time plugin registry, verifies
 *      scorer refs, UWR profile refs (the pinned recognized profile — the
 *      same identity the existing RC loader enforces), and decay refs
 *      (afi-core DEFAULT_DECAY_TEMPLATES_BY_HORIZON template ids or a
 *      schema-valid inline surface);
 *   4. ANY invalid ACTIVE entry → throws RuntimeConfigValidationError — the
 *      process refuses to serve (D-FCP-8 honest failure; no lazy discovery
 *      at request time).
 *
 * This module (and the composition root that calls it) is the ONLY reader of
 * these registries — never the D2 evidence/provenance surfaces (RC-7 bans,
 * dirs per DSC-GOV D-DSC-8).
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import * as ajvFormatsModule from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { DEFAULT_DECAY_TEMPLATES_BY_HORIZON } from "afi-core/decay";
import { PINNED_UWR_PROFILE_ID } from "afi-core/validators/UwrProfileLoader.js";
import {
  computeAnalystConfigHash,
  computeManifestHash,
  computePluginSetHash,
  type CanonicalHashRef,
} from "./hashing.js";
import type {
  AnalysisPluginManifest,
  AnalystStrategyConfig,
  AnalystStrategyRegistration,
  PipelineManifest,
  ProviderStrategyBinding,
} from "./manifestTypes.js";
import { validatePipelineGraph } from "./executor.js";
import { pluginKey, type PluginRegistry } from "./pluginRegistry.js";
import type {
  CredentialRefRecord,
  ProviderInstanceRecord,
  ProviderRecord,
  ProviderRecordStoreInput,
} from "../providers/records.js";

const addFormats = (ajvFormatsModule as { default?: unknown }).default ?? ajvFormatsModule;

/** Vendored governed schema closure location (afi-infra vendoring pattern). */
export const GOVERNED_SCHEMA_DIRNAME = "src/pipeline/governed-schema";

export class RuntimeConfigValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(
      `runtime configuration is invalid — refusing to serve (${issues.length} issue(s)):\n` +
        issues.map((i) => `  - ${i}`).join("\n")
    );
    this.name = "RuntimeConfigValidationError";
    this.issues = issues;
  }
}

export interface LoadedRegistries {
  analysisPlugins: Map<string, AnalysisPluginManifest>;
  pipelines: Map<string, PipelineManifest>;
  registrations: AnalystStrategyRegistration[];
  configs: Map<string, AnalystStrategyConfig>;
  bindings: Map<string, ProviderStrategyBinding>;
}

/** One fully-resolved ACTIVE strategy (the composition the runtime executes). */
export interface ResolvedStrategy {
  registration: AnalystStrategyRegistration;
  config: AnalystStrategyConfig;
  pipeline: PipelineManifest;
  manifestHash: CanonicalHashRef;
  analystConfigHash: CanonicalHashRef;
  pluginSetHash: CanonicalHashRef;
  /** Bound plugin manifests keyed by 'pluginId@pluginVersion'. */
  plugins: Map<string, AnalysisPluginManifest>;
  decay:
    | { kind: "template"; templateId: string }
    | { kind: "inline"; config: Record<string, unknown> };
}

export interface ValidatedRuntimeConfig {
  registries: LoadedRegistries;
  strategies: Map<string, ResolvedStrategy>;
  bindings: Map<string, ProviderStrategyBinding>;
}

export interface ValidateRuntimeConfigOptions {
  /** The build-time plugin binding to verify against. */
  pluginRegistry: PluginRegistry;
  /**
   * afi-config root (defaults to the file: dependency at
   * node_modules/afi-config under process.cwd(), the ussValidator pattern).
   * Tests point this at fixture registries under test/.
   */
  configRoot?: string;
  /** Vendored schema dir override (tests only). */
  governedSchemaDir?: string;
  /**
   * The loaded governed provider/instance/credential-ref records (FLPR-GOV
   * D-FLPR-4 explicit-selection law). When present, EVERY analysis-lane node
   * in every registered pipeline MUST carry a providerInstanceRef that
   * resolves to an ACTIVE instance of the node's category whose adapter is in
   * the build-time adapter set — fail closed, no silent fallback.
   */
  providerRecords?: ProviderRecordStoreInput;
  /** The build-time registered provider adapter ids (static allowlist). */
  providerAdapterIds?: readonly string[];
}

function defaultConfigRoot(): string {
  return join(process.cwd(), "node_modules/afi-config");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function listRegistryFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

interface CompiledValidators {
  pipeline: ValidateFunction;
  plugin: ValidateFunction;
  config: ValidateFunction;
  registration: ValidateFunction;
  binding: ValidateFunction;
  fragmentAjv: Ajv;
}

function compileValidators(governedSchemaDir: string): CompiledValidators {
  const ajv = new Ajv({
    strict: true,
    allowUnionTypes: true,
    strictRequired: false,
    allErrors: true,
  });
  (addFormats as (a: Ajv) => void)(ajv);
  ajv.addVocabulary([
    "x-afiStatus",
    "x-afiPartOf",
    "x-afiDoctrineRefs",
    "x-afiOpenItems",
    "x-afiProposedNotAccepted",
    "x-afiConstraints",
  ]);

  const load = (basename: string) =>
    readJson(join(governedSchemaDir, basename)) as Record<string, unknown>;

  const schemas = [
    "canonical-hash.schema.json",
    "pipeline.schema.json",
    "analysis-plugin.schema.json",
    "analyst-strategy-config.schema.json",
    "analyst-strategy-registration.schema.json",
    "provider-strategy-binding.schema.json",
    "composition-ref.schema.json",
  ].map(load);
  for (const schema of schemas) ajv.addSchema(schema);

  const byId = (id: string): ValidateFunction => {
    const v = ajv.getSchema(id);
    if (!v) throw new Error(`vendored governed schema '${id}' failed to load`);
    return v;
  };

  // Lenient AJV for OPEN paramsSchema fragments authored inside manifests.
  const fragmentAjv = new Ajv({ strict: false, allowUnionTypes: true, allErrors: true });
  (addFormats as (a: Ajv) => void)(fragmentAjv);

  return {
    pipeline: byId("https://afi-protocol.org/schemas/pipeline/v1/pipeline.schema.json"),
    plugin: byId("https://afi-protocol.org/schemas/analysis-plugin/v1/analysis-plugin.schema.json"),
    config: byId(
      "https://afi-protocol.org/schemas/analyst-strategy-config/v1/analyst-strategy-config.schema.json"
    ),
    registration: byId(
      "https://afi-protocol.org/schemas/analyst-strategy-registration/v1/analyst-strategy-registration.schema.json"
    ),
    binding: byId(
      "https://afi-protocol.org/schemas/provider-strategy-binding/v1/provider-strategy-binding.schema.json"
    ),
    fragmentAjv,
  };
}

function ajvIssues(prefix: string, validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map(
    (e) => `${prefix}: ${e.instancePath || "/"} ${e.message ?? "schema violation"}`
  );
}

const REGISTRY_DIRS = {
  analysisPlugins: "registries/analysis-plugins",
  pipelines: "registries/pipelines",
  analystStrategies: "registries/analyst-strategies",
  providerBindings: "registries/provider-bindings",
} as const;

/** The governed enrichment-provider registries (FLPR-GOV D-FLPR-1/D-FLPR-4). */
const PROVIDER_REGISTRY_DIRS = {
  providers: "registries/providers",
  providerInstances: "registries/provider-instances",
  credentialRefs: "registries/credential-refs",
} as const;

/** The five open analysis lanes (FCP-GOV D-FCP-1) — all provider-backed. */
const ANALYSIS_LANE_CATEGORIES = new Set(["technical", "pattern", "sentiment", "news", "aiMl"]);

export interface LoadProviderRecordsOptions {
  configRoot?: string;
  governedSchemaDir?: string;
}

/**
 * Load + validate the governed provider/provider-instance/credential-ref
 * registries (FLPR-GOV D-FLPR-1). Fail-closed: missing directories, schema
 * violations, duplicate identities, and cross-reference incoherence (unknown
 * provider, unsupported category, adapter mismatch, credential incoherence)
 * all refuse boot. Returns the plain record arrays consumed by
 * createProviderRecordStore.
 */
export function loadProviderRecords(
  options: LoadProviderRecordsOptions = {}
): ProviderRecordStoreInput {
  const configRoot = options.configRoot ?? defaultConfigRoot();
  const governedSchemaDir =
    options.governedSchemaDir ?? join(process.cwd(), GOVERNED_SCHEMA_DIRNAME);
  const issues: string[] = [];

  for (const dir of Object.values(PROVIDER_REGISTRY_DIRS)) {
    if (!existsSync(join(configRoot, dir))) {
      issues.push(`registry directory missing: ${dir} (under ${configRoot})`);
    }
  }
  if (issues.length > 0) throw new RuntimeConfigValidationError(issues);

  const ajv = new Ajv({ strict: true, allowUnionTypes: true, strictRequired: false, allErrors: true });
  (addFormats as (a: Ajv) => void)(ajv);
  ajv.addVocabulary([
    "x-afiStatus",
    "x-afiPartOf",
    "x-afiDoctrineRefs",
    "x-afiOpenItems",
    "x-afiProposedNotAccepted",
    "x-afiConstraints",
  ]);
  const compile = (basename: string): ValidateFunction =>
    ajv.compile(readJson(join(governedSchemaDir, basename)) as Record<string, unknown>);
  const validateProvider = compile("provider.schema.json");
  const validateInstance = compile("provider-instance.schema.json");
  const validateCredentialRef = compile("credential-ref.schema.json");

  const providers: ProviderRecord[] = [];
  const providerById = new Map<string, ProviderRecord>();
  for (const file of listRegistryFiles(join(configRoot, PROVIDER_REGISTRY_DIRS.providers))) {
    const doc = readJson(file);
    if (!validateProvider(doc)) {
      issues.push(...ajvIssues(`provider ${file}`, validateProvider));
      continue;
    }
    const record = doc as ProviderRecord;
    if (providerById.has(record.providerId)) {
      issues.push(`provider ${file}: duplicate providerId '${record.providerId}'`);
      continue;
    }
    providerById.set(record.providerId, record);
    providers.push(record);
  }

  const credentialRefs: CredentialRefRecord[] = [];
  const credentialByRef = new Map<string, CredentialRefRecord>();
  for (const file of listRegistryFiles(join(configRoot, PROVIDER_REGISTRY_DIRS.credentialRefs))) {
    const doc = readJson(file);
    if (!validateCredentialRef(doc)) {
      issues.push(...ajvIssues(`credential-ref ${file}`, validateCredentialRef));
      continue;
    }
    const record = doc as CredentialRefRecord;
    if (credentialByRef.has(record.credentialRef)) {
      issues.push(`credential-ref ${file}: duplicate credentialRef '${record.credentialRef}'`);
      continue;
    }
    const provider = providerById.get(record.providerId);
    if (!provider) {
      issues.push(`credential-ref ${file}: unknown provider '${record.providerId}'`);
    } else if (!provider.requiresCredential || provider.credentialKind !== record.credentialKind) {
      issues.push(
        `credential-ref ${file}: incompatible with provider '${record.providerId}' (requiresCredential/credentialKind mismatch)`
      );
    }
    credentialByRef.set(record.credentialRef, record);
    credentialRefs.push(record);
  }

  const providerInstances: ProviderInstanceRecord[] = [];
  const instanceKeys = new Set<string>();
  for (const file of listRegistryFiles(join(configRoot, PROVIDER_REGISTRY_DIRS.providerInstances))) {
    const doc = readJson(file);
    if (!validateInstance(doc)) {
      issues.push(...ajvIssues(`provider-instance ${file}`, validateInstance));
      continue;
    }
    const record = doc as ProviderInstanceRecord;
    const key = `${record.providerInstanceId}@${record.recordVersion}`;
    if (instanceKeys.has(key)) {
      issues.push(`provider-instance ${file}: duplicate instance identity '${key}'`);
      continue;
    }
    instanceKeys.add(key);
    const provider = providerById.get(record.providerId);
    if (!provider) {
      issues.push(`provider-instance ${file}: unknown provider '${record.providerId}'`);
    } else {
      if (!provider.supportedCategories.includes(record.category)) {
        issues.push(
          `provider-instance ${file}: category '${record.category}' not supported by provider '${provider.providerId}'`
        );
      }
      if (provider.adapterId !== record.adapterId) {
        issues.push(
          `provider-instance ${file}: adapterId '${record.adapterId}' != provider adapter '${provider.adapterId}'`
        );
      }
      if (provider.requiresCredential) {
        if (!record.credentialRef) {
          issues.push(`provider-instance ${file}: credentialed provider requires a credentialRef`);
        } else {
          const cred = credentialByRef.get(record.credentialRef);
          if (!cred) {
            issues.push(`provider-instance ${file}: unknown credentialRef '${record.credentialRef}'`);
          } else {
            if (cred.status !== "active") {
              issues.push(`provider-instance ${file}: credentialRef '${record.credentialRef}' is not active`);
            }
            if (cred.tenant !== record.tenant) {
              issues.push(`provider-instance ${file}: cross-tenant credentialRef '${record.credentialRef}'`);
            }
            if (cred.providerId !== record.providerId) {
              issues.push(`provider-instance ${file}: credentialRef '${record.credentialRef}' scoped to a different provider`);
            }
          }
        }
      } else if (record.credentialRef) {
        issues.push(`provider-instance ${file}: keyless provider must not carry a credentialRef`);
      }
      if (record.model !== undefined) {
        if (!provider.supportedModels || !provider.supportedModels.includes(record.model)) {
          issues.push(`provider-instance ${file}: model '${record.model}' not in provider supportedModels`);
        }
      }
    }
    providerInstances.push(record);
  }

  if (issues.length > 0) throw new RuntimeConfigValidationError(issues);
  return { providers, credentialRefs, providerInstances };
}

/** The governed decay template ids (afi-core DEFAULT_DECAY_TEMPLATES_BY_HORIZON). */
export function governedDecayTemplateIds(): Set<string> {
  return new Set(
    Object.values(DEFAULT_DECAY_TEMPLATES_BY_HORIZON).map((t) => t.templateId)
  );
}

/** The runtime decay surface (identical to afi-core's DecayParams). */
export interface ResolvedDecayParams {
  halfLifeMinutes: number;
  greeksTemplateId: string;
}

/**
 * Resolve the registered strategy's decay selection (W3 spec section 6):
 * a `ref.templateId` is looked up BY TEMPLATE ID in afi-core's
 * DEFAULT_DECAY_TEMPLATES_BY_HORIZON values (unknown → refusal — boot
 * validation enforces the same set, so a live miss is a deployment defect);
 * a schema-validated `inline` surface is taken verbatim. The froggy
 * registration selects decay-swing-v1 → byte-equal to the superseded
 * horizon-inferring helper's swing-template result. NO horizon inference, NO
 * hardcoded template selection anywhere in the live path.
 */
export function resolveDecayParams(decay: ResolvedStrategy["decay"]): ResolvedDecayParams {
  if (decay.kind === "template") {
    const template = Object.values(DEFAULT_DECAY_TEMPLATES_BY_HORIZON).find(
      (t) => t.templateId === decay.templateId
    );
    if (!template) {
      throw new RuntimeConfigValidationError([
        `decay templateId '${decay.templateId}' is not a governed template`,
      ]);
    }
    return {
      halfLifeMinutes: template.halfLifeMinutes ?? template.targetHoldingMinutes / 2,
      greeksTemplateId: template.templateId,
    };
  }
  const inline = (decay.config as { inline?: Record<string, unknown> })?.inline;
  const halfLifeMinutes = inline?.halfLifeMinutes;
  const greeksTemplateId = inline?.greeksTemplateId;
  if (typeof halfLifeMinutes !== "number" || halfLifeMinutes <= 0 || typeof greeksTemplateId !== "string") {
    throw new RuntimeConfigValidationError([
      "inline decayConfig must carry a positive halfLifeMinutes and a greeksTemplateId",
    ]);
  }
  return { halfLifeMinutes, greeksTemplateId };
}

function strategyKey(analystId: string, strategyId: string, strategyVersion: string): string {
  return `${analystId}/${strategyId}@${strategyVersion}`;
}

/**
 * Boot validation gate. Throws RuntimeConfigValidationError on ANY invalid
 * ACTIVE entry (and on structurally malformed registry files, active or not
 * — a corrupt registry is never served from).
 */
export function validateRuntimeConfig(
  options: ValidateRuntimeConfigOptions
): ValidatedRuntimeConfig {
  const configRoot = options.configRoot ?? defaultConfigRoot();
  const governedSchemaDir =
    options.governedSchemaDir ?? join(process.cwd(), GOVERNED_SCHEMA_DIRNAME);
  const issues: string[] = [];

  for (const dir of Object.values(REGISTRY_DIRS)) {
    if (!existsSync(join(configRoot, dir))) {
      issues.push(`registry directory missing: ${dir} (under ${configRoot})`);
    }
  }
  if (issues.length > 0) throw new RuntimeConfigValidationError(issues);

  const validators = compileValidators(governedSchemaDir);

  // ---- analysis-plugins ----
  const analysisPlugins = new Map<string, AnalysisPluginManifest>();
  for (const file of listRegistryFiles(join(configRoot, REGISTRY_DIRS.analysisPlugins))) {
    const doc = readJson(file);
    if (!validators.plugin(doc)) {
      issues.push(...ajvIssues(`analysis-plugin ${file}`, validators.plugin));
      continue;
    }
    const manifest = doc as AnalysisPluginManifest;
    const key = pluginKey(manifest.pluginId, manifest.pluginVersion);
    if (analysisPlugins.has(key)) {
      issues.push(`analysis-plugin ${file}: duplicate plugin identity ${key}`);
      continue;
    }
    analysisPlugins.set(key, manifest);
  }

  // Index the governed provider instances for the explicit-selection checks.
  const providerInstanceIndex = options.providerRecords
    ? new Map(
        (options.providerRecords.providerInstances ?? []).map((i) => [
          `${i.providerInstanceId}@${i.recordVersion}`,
          i,
        ])
      )
    : undefined;
  const providerAdapterIdSet = options.providerAdapterIds
    ? new Set(options.providerAdapterIds)
    : undefined;

  // ---- pipelines ----
  const pipelines = new Map<string, PipelineManifest>();
  for (const file of listRegistryFiles(join(configRoot, REGISTRY_DIRS.pipelines))) {
    const doc = readJson(file);
    if (!validators.pipeline(doc)) {
      issues.push(...ajvIssues(`pipeline ${file}`, validators.pipeline));
      continue;
    }
    const manifest = doc as PipelineManifest;
    const key = `${manifest.pipelineId}@${manifest.pipelineVersion}`;
    if (pipelines.has(key)) {
      issues.push(`pipeline ${file}: duplicate pipeline identity ${key}`);
      continue;
    }
    for (const issue of validatePipelineGraph(manifest)) {
      issues.push(`pipeline ${key}: ${issue}`);
    }
    // Plugin binding checks (category agreement, config vs paramsSchema,
    // multiInstance, permitted failure policies, build-time binding).
    const boundCounts = new Map<string, number>();
    for (const node of manifest.nodes) {
      const bindKey = pluginKey(node.pluginId, node.pluginVersion);
      const plugin = analysisPlugins.get(bindKey);
      if (!plugin) {
        issues.push(`pipeline ${key}: node '${node.id}' binds unregistered plugin ${bindKey}`);
        continue;
      }
      boundCounts.set(bindKey, (boundCounts.get(bindKey) ?? 0) + 1);
      if (plugin.category !== node.category) {
        issues.push(
          `pipeline ${key}: node '${node.id}' category '${node.category}' != plugin category '${plugin.category}'`
        );
      }
      const permitted = plugin.permittedFailurePolicies ?? ["abort"];
      if (node.failurePolicy && !permitted.includes(node.failurePolicy)) {
        issues.push(
          `pipeline ${key}: node '${node.id}' failurePolicy '${node.failurePolicy}' not permitted by plugin ${bindKey}`
        );
      }
      try {
        const validateParams = validators.fragmentAjv.compile(plugin.paramsSchema ?? {});
        if (!validateParams(node.config ?? {})) {
          issues.push(
            `pipeline ${key}: node '${node.id}' config violates ${bindKey} paramsSchema (${(
              validateParams.errors ?? []
            )
              .map((e) => `${e.instancePath || "/"} ${e.message}`)
              .join("; ")})`
          );
        }
      } catch (error) {
        issues.push(
          `pipeline ${key}: node '${node.id}' paramsSchema of ${bindKey} failed to compile (${
            error instanceof Error ? error.message : String(error)
          })`
        );
      }
      if (!options.pluginRegistry.has(node.pluginId, node.pluginVersion)) {
        issues.push(
          `pipeline ${key}: node '${node.id}' plugin ${bindKey} has no build-time binding`
        );
      }
      // FLPR-GOV D-FLPR-4 explicit-selection law (fail closed at composition):
      // with governed provider records loaded, every analysis-lane node MUST
      // carry a providerInstanceRef resolving to an ACTIVE instance of the
      // node's category whose adapter is in the static build-time set.
      if (providerInstanceIndex) {
        const isLane = ANALYSIS_LANE_CATEGORIES.has(node.category);
        if (isLane && !node.providerInstanceRef) {
          issues.push(
            `pipeline ${key}: node '${node.id}' (category '${node.category}') has no providerInstanceRef — explicit provider selection is required for every enabled lane`
          );
        }
        if (node.providerInstanceRef) {
          const refKey = `${node.providerInstanceRef.providerInstanceId}@${node.providerInstanceRef.recordVersion}`;
          const instance = providerInstanceIndex.get(refKey);
          if (!instance) {
            issues.push(
              `pipeline ${key}: node '${node.id}' providerInstanceRef '${refKey}' resolves to no governed provider instance`
            );
          } else {
            if (instance.status !== "active") {
              issues.push(
                `pipeline ${key}: node '${node.id}' providerInstanceRef '${refKey}' is not active`
              );
            }
            if (instance.category !== node.category) {
              issues.push(
                `pipeline ${key}: node '${node.id}' category '${node.category}' != provider instance category '${instance.category}'`
              );
            }
            if (providerAdapterIdSet && !providerAdapterIdSet.has(instance.adapterId)) {
              issues.push(
                `pipeline ${key}: node '${node.id}' provider instance '${refKey}' names adapter '${instance.adapterId}' which is not in the static build-time adapter registry`
              );
            }
          }
        }
      }
    }
    for (const [bindKey, count] of boundCounts) {
      const plugin = analysisPlugins.get(bindKey);
      if (plugin && count > 1 && plugin.multiInstance !== true) {
        issues.push(
          `pipeline ${key}: plugin ${bindKey} bound on ${count} nodes but is not multiInstance`
        );
      }
    }
    pipelines.set(key, manifest);
  }

  // ---- analyst-strategies (registrations + their referenced configs) ----
  const registrations: AnalystStrategyRegistration[] = [];
  const configs = new Map<string, AnalystStrategyConfig>();
  const strategies = new Map<string, ResolvedStrategy>();
  const decayTemplateIds = governedDecayTemplateIds();

  for (const file of listRegistryFiles(join(configRoot, REGISTRY_DIRS.analystStrategies))) {
    const doc = readJson(file);
    // The registry directory holds registrations AND the config artifacts
    // they reference; classify by schema discriminator.
    const schema = (doc as { schema?: unknown }).schema;
    if (schema === "afi.analyst-strategy-config.v1") {
      if (!validators.config(doc)) {
        issues.push(...ajvIssues(`analyst-strategy-config ${file}`, validators.config));
        continue;
      }
      const config = doc as AnalystStrategyConfig;
      configs.set(
        strategyKey(config.analystId, config.strategyId, config.strategyVersion),
        config
      );
      continue;
    }
    if (!validators.registration(doc)) {
      issues.push(...ajvIssues(`analyst-strategy-registration ${file}`, validators.registration));
      continue;
    }
    registrations.push(doc as AnalystStrategyRegistration);
  }

  for (const registration of registrations) {
    const key = strategyKey(
      registration.analystId,
      registration.strategyId,
      registration.strategyVersion
    );
    if (registration.status !== "active") continue; // inactive: retained, never served

    // configRef resolution: same-registry config artifact, or a path under
    // the afi-config root (tolerating a leading 'afi-config/' prefix).
    let config = configs.get(key);
    if (!config) {
      const relative = registration.configRef.replace(/^afi-config\//, "");
      const candidate = join(configRoot, relative);
      if (existsSync(candidate)) {
        const doc = readJson(candidate);
        if (validators.config(doc)) {
          config = doc as AnalystStrategyConfig;
          configs.set(key, config);
        } else {
          issues.push(...ajvIssues(`analyst-strategy-config ${candidate}`, validators.config));
        }
      }
    }
    if (!config) {
      issues.push(`registration ${key}: configRef '${registration.configRef}' does not resolve`);
      continue;
    }

    if (
      config.analystId !== registration.analystId ||
      config.strategyId !== registration.strategyId ||
      config.strategyVersion !== registration.strategyVersion
    ) {
      issues.push(`registration ${key}: resolved config identity triple mismatch`);
      continue;
    }

    // analystConfigHash recompute + verify.
    const recomputedConfigHash = computeAnalystConfigHash(config);
    if (recomputedConfigHash.value !== registration.analystConfigHash.value) {
      issues.push(
        `registration ${key}: analystConfigHash mismatch (registered ${registration.analystConfigHash.value}, recomputed ${recomputedConfigHash.value})`
      );
      continue;
    }

    // pipelineRef resolution + manifestHash recompute + verify.
    const pipelineKeyStr = `${config.pipelineRef.pipelineId}@${config.pipelineRef.pipelineVersion}`;
    const pipeline = pipelines.get(pipelineKeyStr);
    if (!pipeline) {
      issues.push(`registration ${key}: pipelineRef '${pipelineKeyStr}' is not a registered pipeline`);
      continue;
    }
    const recomputedManifestHash = computeManifestHash(pipeline);
    if (recomputedManifestHash.value !== config.pipelineRef.manifestHash.value) {
      issues.push(
        `registration ${key}: manifestHash mismatch for ${pipelineKeyStr} (pinned ${config.pipelineRef.manifestHash.value}, recomputed ${recomputedManifestHash.value})`
      );
      continue;
    }

    // nodeOverrides boundedness.
    for (const [nodeId, override] of Object.entries(config.nodeOverrides ?? {})) {
      const node = pipeline.nodes.find((n) => n.id === nodeId);
      if (!node) {
        issues.push(`registration ${key}: nodeOverrides names unknown node '${nodeId}'`);
        continue;
      }
      if (override.config) {
        const plugin = analysisPlugins.get(pluginKey(node.pluginId, node.pluginVersion));
        if (plugin) {
          const validateParams = validators.fragmentAjv.compile(plugin.paramsSchema ?? {});
          if (!validateParams(override.config)) {
            issues.push(
              `registration ${key}: nodeOverrides['${nodeId}'].config violates the bound plugin's paramsSchema`
            );
          }
        }
      }
    }

    // Scorer agreement.
    const scorerNode = pipeline.nodes.find((n) => n.category === "scorer");
    if (
      scorerNode &&
      (scorerNode.pluginId !== config.scorerRef.pluginId ||
        scorerNode.pluginVersion !== config.scorerRef.pluginVersion)
    ) {
      issues.push(
        `registration ${key}: scorerRef ${config.scorerRef.pluginId}@${config.scorerRef.pluginVersion} != pipeline scorer ${scorerNode.pluginId}@${scorerNode.pluginVersion}`
      );
    }

    // UWR profile ref: the pinned recognized profile (the identity the
    // existing RC loader enforces at score time — fail-closed there too).
    if (config.uwrProfileRef.profileId !== PINNED_UWR_PROFILE_ID) {
      issues.push(
        `registration ${key}: uwrProfileRef '${config.uwrProfileRef.profileId}' is not the recognized profile '${PINNED_UWR_PROFILE_ID}'`
      );
    }

    // Decay ref: governed template id or schema-valid inline surface.
    let decay: ResolvedStrategy["decay"];
    const decayConfig = config.decayConfig as Record<string, unknown>;
    if (decayConfig && typeof decayConfig === "object" && "ref" in decayConfig) {
      const templateId = (decayConfig.ref as { templateId?: unknown })?.templateId;
      if (typeof templateId !== "string" || !decayTemplateIds.has(templateId)) {
        issues.push(
          `registration ${key}: decay templateId '${String(templateId)}' is not a governed template (${[...decayTemplateIds].sort().join(", ")})`
        );
        continue;
      }
      decay = { kind: "template", templateId };
    } else {
      decay = { kind: "inline", config: decayConfig };
    }

    // Plugin set (recomputed over the pipeline's bound manifests).
    const boundPlugins = new Map<string, AnalysisPluginManifest>();
    for (const node of pipeline.nodes) {
      const k = pluginKey(node.pluginId, node.pluginVersion);
      const plugin = analysisPlugins.get(k);
      if (plugin) boundPlugins.set(k, plugin);
    }
    const setHash = computePluginSetHash([...boundPlugins.values()]);

    strategies.set(key, {
      registration,
      config,
      pipeline,
      manifestHash: recomputedManifestHash,
      analystConfigHash: recomputedConfigHash,
      pluginSetHash: setHash,
      plugins: boundPlugins,
      decay,
    });
  }

  // ---- provider-bindings ----
  const bindings = new Map<string, ProviderStrategyBinding>();
  for (const file of listRegistryFiles(join(configRoot, REGISTRY_DIRS.providerBindings))) {
    const doc = readJson(file);
    if (!validators.binding(doc)) {
      issues.push(...ajvIssues(`provider-binding ${file}`, validators.binding));
      continue;
    }
    const binding = doc as ProviderStrategyBinding;
    if (bindings.has(binding.bindingId)) {
      issues.push(`provider-binding ${file}: duplicate bindingId '${binding.bindingId}'`);
      continue;
    }
    bindings.set(binding.bindingId, binding);
  }
  for (const binding of bindings.values()) {
    if (binding.status !== "active") continue;
    // defaultStrategy membership (deep-equality over the triple).
    if (binding.defaultStrategy) {
      const d = binding.defaultStrategy;
      const member = binding.allowedStrategies.some(
        (t) =>
          t.analystId === d.analystId &&
          t.strategyId === d.strategyId &&
          t.strategyVersion === d.strategyVersion
      );
      if (!member) {
        issues.push(
          `binding '${binding.bindingId}': defaultStrategy is not a member of allowedStrategies`
        );
      }
    }
    // Every allowed triple must resolve to an ACTIVE registration that
    // admits this binding.
    for (const t of binding.allowedStrategies) {
      const k = strategyKey(t.analystId, t.strategyId, t.strategyVersion);
      const resolved = strategies.get(k);
      if (!resolved) {
        issues.push(
          `binding '${binding.bindingId}': allowed strategy ${k} does not resolve to an active registration`
        );
        continue;
      }
      const policy = resolved.registration.providerBindingPolicy;
      if (
        policy.mode === "explicit" &&
        !(policy.allowedBindings ?? []).includes(binding.bindingId)
      ) {
        issues.push(
          `binding '${binding.bindingId}': registration ${k} does not admit this binding (explicit policy)`
        );
      }
    }
  }

  if (issues.length > 0) throw new RuntimeConfigValidationError(issues);

  return {
    registries: { analysisPlugins, pipelines, registrations, configs, bindings },
    strategies,
    bindings,
  };
}
