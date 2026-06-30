/**
 * Injectable, deterministic clock for the pipehead demo.
 *
 * The default clock returns a single FROZEN ISO constant so that demo/test
 * runs are fully reproducible. Timestamps produced by the clock are for humans
 * only and are EXCLUDED from every content hash (see canonicalHash.ts).
 */

export type Clock = () => string;

/** Fixed ISO timestamp returned by the default frozen clock. */
export const FROZEN_CLOCK_ISO = "2025-01-01T00:00:00.000Z";

/**
 * Create a frozen clock that always returns the same ISO string.
 * Defaults to {@link FROZEN_CLOCK_ISO}; pass an ISO string to override.
 */
export function createFrozenClock(iso: string = FROZEN_CLOCK_ISO): Clock {
  return () => iso;
}
