/**
 * AFI-Reactor DAG plugin stub for TSSD vault node.
 * Canonical vaulted-signal schema and real persistence live in afi-infra.
 * Must not implement real database or on-chain token logic in production.
 */

export default {
  run: async (signal: any) => {
    console.log("🏦 [tssd-vault-service] DEV STUB – no real DB; canonical TSSD vault lives in afi-infra.");
    return {
      ...signal,
      vaultStatus: signal?.vaultStatus || "stored",
    };
  },
};
