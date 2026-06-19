/**
 * Novelty Scoring Tests (DEFERRED — scored-only milestone)
 *
 * Novelty scoring belonged to the (now-removed) validator demo plugin world,
 * not the reactor's scoring runtime. With the legacy demo chain purged, the
 * reactor's responsibility ends at the scored signal (ReactorScoredSignalV1:
 * analystScore + scoredAt + rawUss). Novelty/cohort comparison and validator
 * certification now live in the external certification layer (afi-mint /
 * certification service), not in a reactor plugin.
 *
 * These tests are intentionally deferred until novelty is reintroduced against
 * the scored-only ReactorScoredSignalDocument. They no longer depend on any
 * deleted demo plugin. Set NOVELTY_TESTS_ENABLED=true once a scored-only
 * novelty service exists.
 */

import { describe, it, expect } from "@jest/globals";

const NOVELTY_TESTS_ENABLED = process.env.NOVELTY_TESTS_ENABLED === "true";

(NOVELTY_TESTS_ENABLED ? describe.skip : describe)(
  "Novelty Scoring (deferred to scored-only milestone)",
  () => {
    it("is deferred: reactor is scored-only; novelty moved to the certification layer", () => {
      // Placeholder marker. Reintroduce against ReactorScoredSignalDocument when
      // a scored-only novelty service lands. No legacy demo-chain dependency.
      expect(true).toBe(true);
    });
  }
);
