/**
 * Reactor-only signal envelope (lightweight metadata wrapper).
 *
 * This is NOT the canonical AFI signal; universal schemas live in afi-core.
 * Use this only for local orchestration helpers where an id/timestamp/meta
 * envelope is needed without pulling in full signal payload schemas.
 */
export interface ReactorSignalEnvelope {
  signalId: string;
  score?: number;
  timestamp: Date;
  meta: Record<string, any>;
  tags?: string[];
}
