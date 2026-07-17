/**
 * Canonical USS v1.1 payload (runtime shape validated by AJV)
 *
 * This is the raw ingest truth - the single canonical signal object
 * that enters and flows through the graph executor.
 */
export interface CanonicalUss {
  schema: "afi.usignal.v1.1";
  provenance: {
    source: string;
    providerId: string;
    signalId: string;
    ingestedAt?: string;
    ingestHash?: string;
    providerType?: string;
    providerRef?: string;
    [key: string]: any;
  };
  core?: any;
  lens?: string;
  [key: string]: any;
}
