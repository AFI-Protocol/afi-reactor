/**
 * Trusted adapter registry (PBF-GOV D-PBF-5 / §7.2).
 *
 * An explicit, build-time, fail-closed map of compiled adapters keyed by
 * adapterId@adapterVersion. Mirrors the plugin-registry discipline: no dynamic
 * import, no filesystem package discovery, no arbitrary module path, no dynamic
 * code installation. A duplicate registration throws; an unknown adapter fails
 * closed at lookup.
 */
import type { ProviderAdapter } from "./types.js";
import { AdapterNotRegisteredError } from "./errors.js";

export interface AdapterRegistry {
  get(adapterId: string, adapterVersion: string): ProviderAdapter | undefined;
  require(adapterId: string, adapterVersion: string): ProviderAdapter;
  has(adapterId: string, adapterVersion: string): boolean;
  keys(): string[];
}

function adapterKey(adapterId: string, adapterVersion: string): string {
  return `${adapterId}@${adapterVersion}`;
}

export function createAdapterRegistry(adapters: ReadonlyArray<ProviderAdapter>): AdapterRegistry {
  const byKey = new Map<string, ProviderAdapter>();
  for (const adapter of adapters) {
    const k = adapterKey(adapter.adapterId, adapter.adapterVersion);
    if (byKey.has(k)) {
      // Fail closed at construction — a duplicate registration is a boot error.
      throw new AdapterNotRegisteredError(`duplicate adapter registration: ${k}`);
    }
    byKey.set(k, adapter);
  }
  return {
    get: (id, version) => byKey.get(adapterKey(id, version)),
    has: (id, version) => byKey.has(adapterKey(id, version)),
    require: (id, version) => {
      const found = byKey.get(adapterKey(id, version));
      if (!found) {
        throw new AdapterNotRegisteredError(`no registered adapter for ${adapterKey(id, version)}`);
      }
      return found;
    },
    keys: () => [...byKey.keys()].sort(),
  };
}
