/**
 * Test support (DEM-PRODUCER-PLAN): the registered froggy mapping, resolved
 * the way production resolves it — by the fixture analyst config's
 * `mappingRef` from the fixture registry tree — instead of the afi-config
 * canonical EXAMPLE (which stays the immutable 1.0.0 vector). One truth with
 * the pinned analystConfigHash / registry drift guards.
 *
 * Also the COMPOSITION REFERENCE the seam tests compare the scorer node
 * against: registered mapping fragment + residual → composer → rubric — the
 * exact production assembly, run out-of-band. (The retired adapter no longer
 * yields a full scorer input, so it cannot serve as the reference; the
 * reference's independence now rests on the interpreter/composer KATs in
 * afi-core.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ResolvedMappingCarrier } from "../../../src/pipeline/nodeSdk.js";
import type { UniversalWeightingRuleConfig } from "../../../node_modules/afi-core/validators/UniversalWeightingRule.js";
import type { FroggyEnrichedView } from "../../../node_modules/afi-core/analysts/froggy.enrichment_adapter.js";
import { scoreFroggyTrendPullback } from "../../../node_modules/afi-core/analysts/froggy.trend_pullback_v1.js";
import {
  buildFroggyResidualInput,
  composeFroggyTrendPullbackInput,
} from "../../../node_modules/afi-core/analysts/froggy.residual_builder.js";
import { interpretEnrichmentMapping } from "../../../node_modules/afi-core/validators/EnrichmentMappingInterpreter.js";

export const FIXTURE_CONFIG_ROOT = path.resolve(process.cwd(), "test/pipeline/fixtures/afi-config");
const FROGGY_CONFIG_REL = "registries/analyst-strategies/froggy--trend_pullback_v1--1.0.0.config.json";

/** The mapping the fixture froggy registration names (mappingRef), from the fixture registry. */
export function froggyMappingCarrier(configRoot: string = FIXTURE_CONFIG_ROOT): ResolvedMappingCarrier {
  const config = JSON.parse(readFileSync(path.join(configRoot, FROGGY_CONFIG_REL), "utf-8")) as {
    mappingRef: { mappingId: string; version: string };
  };
  const { mappingId, version } = config.mappingRef;
  const doc = JSON.parse(
    readFileSync(
      path.join(configRoot, "registries/enrichment-mappings", `${mappingId}--${version}.json`),
      "utf-8"
    )
  ) as Record<string, unknown>;
  return { mappingId, version, doc };
}

/** The production assembly run out-of-band (mapping fragment + residual → rubric). */
export function compositionReference(
  enriched: FroggyEnrichedView,
  uwrConfig: UniversalWeightingRuleConfig,
  carrier: ResolvedMappingCarrier = froggyMappingCarrier()
) {
  const { fragment, firedDefaults } = interpretEnrichmentMapping(carrier.doc, enriched);
  const input = composeFroggyTrendPullbackInput(fragment, buildFroggyResidualInput(enriched));
  return { input, firedDefaults, analysis: scoreFroggyTrendPullback(input, uwrConfig, enriched) };
}
