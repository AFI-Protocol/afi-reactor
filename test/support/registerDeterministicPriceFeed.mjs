/**
 * Node `--import` preload (and inline helper) for the COMPILED-build proofs:
 * registers the deterministic synthetic price feed
 * (test/support/deterministicPriceFeedAdapter.ts — the byte-stable former demo
 * adapter) into the COMPILED price-feed registry
 * (dist/src/adapters/exchanges/priceFeedRegistry.js) through the guarded
 * test-only seam, before dist/src/server.js serves its first request.
 *
 * The seam itself refuses under NODE_ENV=production, so this preload can never
 * smuggle synthetic data into a production runtime. The adapter .ts is loaded
 * via Node's native type stripping (Node >= 22.18).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

const { registerPriceFeedAdapterForTests } = await import(
  pathToFileURL(path.resolve(ROOT, "dist/src/adapters/exchanges/priceFeedRegistry.js")).href
);
const { demoPriceFeedAdapter } = await import(
  pathToFileURL(path.resolve(ROOT, "test/support/deterministicPriceFeedAdapter.ts")).href
);

registerPriceFeedAdapterForTests(demoPriceFeedAdapter);
