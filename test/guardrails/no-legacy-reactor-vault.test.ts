/**
 * Guardrail: the legacy Reactor-owned scored-signal persistence path is GONE.
 *
 * Live-beta hardening removed the superseded reactor-owned MongoDB store
 * (`reactor_scored_signals_v1`) — its writer (tssdVaultService /
 * insertSignalDocument), its pipeline stage/handler, its AFI_MONGO_* config, and
 * the LEGACY_REACTOR_VAULT_WRITE_DISABLED dead-code gate. The ONLY reactor
 * persistence path is now the packaged afi-infra canonical evidence store
 * (afi.scored-signal-evidence.v1). This guardrail proves the collection and its
 * writer no longer exist anywhere under src/ — no dual-write, no dead fallback,
 * no revival by a stray import.
 */

import { describe, it, expect } from "@jest/globals";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Repo idiom (see test/evidence/provenance/*.test.ts + guardrails): jest runs from root.
const REPO_ROOT = process.cwd();
const SRC = path.resolve(REPO_ROOT, "src");

/** Recursively collect every *.ts under a directory. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

// Tokens that only exist to serve the deleted reactor_scored_signals_v1 store.
const BANNED_TOKENS = [
  "reactor_scored_signals_v1",
  "tssdVaultService",
  "TssdVaultService",
  "getTssdVaultService",
  "getReactorScoredCollection",
  "getTssdCollection",
  "insertSignalDocument",
  "AFI_MONGO_COLLECTION_SCORED",
  "AFI_MONGO_DB_NAME",
  "LEGACY_REACTOR_VAULT_WRITE_DISABLED",
];

// Files/dirs deleted with the legacy store — must not resurface.
const DELETED_PATHS = [
  "src/services/tssdVaultService.ts",
  "src/services/scoreDecayService.ts",
  "src/novelty/baselineFetch.ts",
  "src/novelty/canonicalNovelty.ts",
];

describe("guardrail: legacy reactor_scored_signals_v1 store is fully removed", () => {
  it("no src/ file references the legacy store, writer, or its config", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const content = readFileSync(file, "utf8");
      for (const token of BANNED_TOKENS) {
        if (content.includes(token)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} :: ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the deleted legacy persistence modules do not exist", () => {
    const survivors = DELETED_PATHS.filter((rel) =>
      existsSync(path.resolve(REPO_ROOT, rel))
    );
    expect(survivors).toEqual([]);
  });

});
