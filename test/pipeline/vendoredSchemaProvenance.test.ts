/**
 * ALWAYS-ON provenance/integrity guard for the vendored governed schema
 * closure (src/pipeline/governed-schema/) — the afi-infra vendoring pattern:
 * proves the byte-pinned copies have not drifted since they were vendored
 * from the pinned afi-config commit (no afi-config checkout required).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(repoRoot, "src/pipeline/governed-schema/MANIFEST.json"), "utf-8")
) as {
  afiConfigCommit: string;
  sources: Record<string, { afiConfigPath: string; sha256: string }>;
};

function sha256(relPath: string): string {
  return createHash("sha256").update(readFileSync(join(repoRoot, relPath))).digest("hex");
}

describe("vendored governed schema provenance (MANIFEST integrity)", () => {
  it("pins the authorizing afi-config commit", () => {
    // EV3-GOV re-vendor (Mission C): the closure gains the V3 evidence +
    // provider-invocation-proof + aiml-invocation-proof members and DROPS the
    // superseded v2 evidence member (D-EV3-1/D-EV3-8), byte-identical at the
    // afi-config Evidence V3 branch head. NOTE: this pin is re-recorded to
    // the squash-merge commit before this repo merges.
    expect(manifest.afiConfigCommit).toBe("22e79cff1c4b312db792ef71b10d1610fcdbc65c");
  });

  it("every vendored file matches its recorded sha256 (drift guard)", () => {
    for (const [vendored, entry] of Object.entries(manifest.sources)) {
      expect(sha256(vendored)).toBe(entry.sha256);
    }
  });

  it("covers the full contract closure src/pipeline consumes", () => {
    const covered = Object.keys(manifest.sources);
    [
      "pipeline.schema.json",
      "analysis-plugin.schema.json",
      "analyst-strategy-config.schema.json",
      "analyst-strategy-registration.schema.json",
      "provider-strategy-binding.schema.json",
      "composition-ref.schema.json",
      // EV3-GOV (D-EV3-1/D-EV3-2/D-EV3-3): the sole current evidence
      // contract + the per-lane and nested invocation proof contracts.
      "scored-signal-evidence.v3.schema.json",
      "provider-invocation-proof.schema.json",
      "aiml-invocation-proof.schema.json",
      "canonical-hash.schema.json",
      "canonical-json-hashing.v1.md",
      "canonical-json-hashing.kat.json",
      // PBF-GOV provider/BYOK + category-result closure.
      "provider.schema.json",
      "credential-ref.schema.json",
      "provider-instance.schema.json",
      "enrichment-technical.schema.json",
      "enrichment-news.schema.json",
      "enrichment-pattern.schema.json",
      // FLPR-GOV: the five-lane runtime validates every lane at the edge.
      "enrichment-sentiment.schema.json",
      "enrichment-aiml.schema.json",
    ].forEach((f) => expect(covered).toContain(`src/pipeline/governed-schema/${f}`));
  });

  it("the superseded v2 evidence member is DELETED, never aliased (D-EV3-8)", () => {
    // Residue-safe token construction: the deleted member's name must not
    // exist as a literal anywhere in the active tree (the EV3 residue sweep
    // in test/providers/providerAdapterLayer.test.ts greps for it).
    const deletedMember = ["scored-signal-evidence", "v2", "schema", "json"].join(".");
    const covered = Object.keys(manifest.sources);
    expect(covered).not.toContain(`src/pipeline/governed-schema/${deletedMember}`);
    expect(() =>
      readFileSync(join(repoRoot, `src/pipeline/governed-schema/${deletedMember}`))
    ).toThrow();
  });

  it("every vendored schema keeps its governed $id", () => {
    const ids: Record<string, string> = {
      "pipeline.schema.json": "https://afi-protocol.org/schemas/pipeline/v1/pipeline.schema.json",
      "analysis-plugin.schema.json":
        "https://afi-protocol.org/schemas/analysis-plugin/v1/analysis-plugin.schema.json",
      "analyst-strategy-config.schema.json":
        "https://afi-protocol.org/schemas/analyst-strategy-config/v1/analyst-strategy-config.schema.json",
      "analyst-strategy-registration.schema.json":
        "https://afi-protocol.org/schemas/analyst-strategy-registration/v1/analyst-strategy-registration.schema.json",
      "provider-strategy-binding.schema.json":
        "https://afi-protocol.org/schemas/provider-strategy-binding/v1/provider-strategy-binding.schema.json",
      "composition-ref.schema.json":
        "https://afi-protocol.org/schemas/composition-ref/v1/composition-ref.schema.json",
      "scored-signal-evidence.v3.schema.json":
        "https://afi-protocol.org/schemas/scored-signal-evidence/v3/scored-signal-evidence.schema.json",
      "provider-invocation-proof.schema.json":
        "https://afi-protocol.org/schemas/provider-invocation-proof/v1/provider-invocation-proof.schema.json",
      "aiml-invocation-proof.schema.json":
        "https://afi-protocol.org/schemas/aiml-invocation-proof/v1/aiml-invocation-proof.schema.json",
      "canonical-hash.schema.json":
        "https://afi-protocol.org/schemas/provenance/v1/canonical-hash.schema.json",
      "provider.schema.json": "https://afi-protocol.org/schemas/provider/v1/provider.schema.json",
      "credential-ref.schema.json":
        "https://afi-protocol.org/schemas/credential-ref/v1/credential-ref.schema.json",
      "provider-instance.schema.json":
        "https://afi-protocol.org/schemas/provider-instance/v1/provider-instance.schema.json",
      "enrichment-technical.schema.json":
        "https://afi-protocol.org/schemas/enrichment/technical/v1/enrichment-technical.schema.json",
      "enrichment-news.schema.json":
        "https://afi-protocol.org/schemas/enrichment/news/v1/enrichment-news.schema.json",
      "enrichment-pattern.schema.json":
        "https://afi-protocol.org/schemas/enrichment/pattern/v1/enrichment-pattern.schema.json",
      "enrichment-sentiment.schema.json":
        "https://afi-protocol.org/schemas/enrichment/sentiment/v1/enrichment-sentiment.schema.json",
      "enrichment-aiml.schema.json":
        "https://afi-protocol.org/schemas/enrichment/aiml/v1/enrichment-aiml.schema.json",
    };
    for (const [file, id] of Object.entries(ids)) {
      const doc = JSON.parse(
        readFileSync(join(repoRoot, "src/pipeline/governed-schema", file), "utf-8")
      );
      expect(doc.$id).toBe(id);
    }
  });
});
