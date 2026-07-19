/**
 * Ephemeral Tiny Brains service stub for the COMPILED-build proofs.
 *
 * Under froggy-trend-pullback v1.3.0 every lane is CRITICAL (EV3-GOV
 * D-EV3-5(1)), so a scored run REQUIRES a live aiMl lane — and the compiled
 * integration scripts run in environments (CI mongo job, local dev) with no
 * real Tiny Brains deployment. This stub is a real node:http server speaking
 * the closed POST /predict/froggy contract with a governed, SELF-VERIFYING
 * response: the D-EV3-3 invocation block's outputHash is computed with the
 * reactor's own COMPILED tiny-brains.hash.v1 law module
 * (dist/src/providers/clients/tinyBrainsHashV1.js), so the trusted client's
 * fail-closed recomputation (aimlServiceClient, D-EV3-4(5)) passes because
 * the bytes really verify — never because anything was skipped.
 *
 * Every value is deterministic: fixed strings, sha256-of-fixed-string hex
 * digests, and a profileId echoed from the request (the client's profile-echo
 * law). Optional members (regime/riskFlag) are ABSENT — exercising the
 * absence-not-null contract — in the default response.
 *
 * `recorded: true` serves the ORACLE recorded prediction instead (the ONE
 * copy in test/oracle/support/recordedLaneData.ts, the same bytes the jest
 * oracle suites inject at the adapter seam and the enriched goldens froze):
 * used by test/oracle/oracleMongoEquivalence.mjs so the compiled build's
 * persisted records stay byte-equal to the committed goldens.
 */

import { createHash } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolve the afi-reactor repo root from THIS module's location (three levels
// above test/integration-mongo/support/), never from process.cwd() — the stub
// is also imported cross-repo by the afi-gateway boundary proof.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Deterministic hex-64 digests: sha256 over fixed label strings. */
const fixedHex64 = (label) => createHash("sha256").update(label, "utf-8").digest("hex");

const CODE_CONFIG_FINGERPRINT = fixedHex64("afi-reactor-it tiny-brains stub: code-config v1");
const CHRONOS_OUTPUT_HASH = fixedHex64("afi-reactor-it tiny-brains stub: chronos-bolt output v1");
const CHRONOS_CONFIG_FP = fixedHex64("afi-reactor-it tiny-brains stub: chronos-bolt config.json v1");
const CHRONOS_WEIGHTS_FP = fixedHex64(
  "afi-reactor-it tiny-brains stub: chronos-bolt model.safetensors v1"
);
const TREND_OUTPUT_HASH = fixedHex64("afi-reactor-it tiny-brains stub: trend-baseline output v1");

async function loadCompiledHashLaw() {
  const mod = await import(
    pathToFileURL(path.resolve(ROOT, "dist/src/providers/clients/tinyBrainsHashV1.js")).href
  );
  const { tinyBrainsHashPayload, tinyBrainsCanonicalJson, PREDICT_FROGGY_FLOAT_KEYS } = mod;
  if (
    typeof tinyBrainsHashPayload !== "function" ||
    typeof tinyBrainsCanonicalJson !== "function" ||
    !(PREDICT_FROGGY_FLOAT_KEYS instanceof Set) ||
    !PREDICT_FROGGY_FLOAT_KEYS.has("convictionScore")
  ) {
    throw new Error(
      "tinyBrainsStub: compiled tiny-brains.hash.v1 law module is missing its expected exports " +
        "(tinyBrainsHashPayload / tinyBrainsCanonicalJson / PREDICT_FROGGY_FLOAT_KEYS with the " +
        "declared convictionScore float key) — rebuild dist (npm run build)."
    );
  }
  return { tinyBrainsHashPayload, PREDICT_FROGGY_FLOAT_KEYS };
}

/**
 * Build the governed default response for one request: prediction payload
 * (profileId echoes the requested profile; optionals absent) + the closed
 * invocation block, self-verified under the COMPILED law.
 */
function defaultResponse(body, law) {
  const payload = {
    convictionScore: 0.652431,
    direction: "long",
    profileId: body.profile,
    profileVersion: "1.0.0",
  };
  const invocation = {
    record: "tiny-brains.aiml-invocation.v1",
    profileId: payload.profileId,
    profileVersion: payload.profileVersion,
    resolverId: "froggy-agreement",
    resolverVersion: "1.0.0",
    codeConfigFingerprint: CODE_CONFIG_FINGERPRINT,
    hashLaw: "tiny-brains.hash.v1",
    // Real commitments under the SAME law module the client verifies with:
    // inputHash over the request body as received; outputHash over the
    // prediction payload EXCLUSIVE of the invocation block (D-EV3-4(5)).
    inputHash: law.tinyBrainsHashPayload(body, { floatKeys: law.PREDICT_FROGGY_FLOAT_KEYS }),
    outputHash: law.tinyBrainsHashPayload(payload, { floatKeys: law.PREDICT_FROGGY_FLOAT_KEYS }),
    status: "succeeded",
    // Sorted ascending by expertId (the client strict-parses the order).
    experts: [
      {
        expertId: "chronos-bolt-forecaster",
        expertVersion: "1.0.0",
        posture: "probabilistic",
        status: "succeeded",
        outputHash: CHRONOS_OUTPUT_HASH,
        artifactFingerprints: {
          "config.json": CHRONOS_CONFIG_FP,
          "model.safetensors": CHRONOS_WEIGHTS_FP,
        },
      },
      {
        expertId: "trend-baseline",
        expertVersion: "1.0.0",
        posture: "deterministic",
        status: "succeeded",
        outputHash: TREND_OUTPUT_HASH,
      },
    ],
  };
  return { ...payload, invocation };
}

/**
 * Build the ORACLE recorded response (recordedLaneData.ts — the bytes the
 * committed enriched goldens froze), with the profileId echo and the REAL
 * outputHash recomputation preserved (self-verifying fixture).
 */
function recordedResponse(body, law, data) {
  const payload = { ...data.RECORDED_TINY_BRAINS_PREDICTION, profileId: body.profile };
  const invocation = {
    record: "tiny-brains.aiml-invocation.v1",
    profileId: payload.profileId,
    profileVersion: payload.profileVersion,
    resolverId: "froggy-agreement",
    resolverVersion: "1.0.0",
    codeConfigFingerprint: data.RECORDED_TINY_BRAINS_HEX64,
    hashLaw: "tiny-brains.hash.v1",
    inputHash: data.RECORDED_TINY_BRAINS_HEX64,
    outputHash: law.tinyBrainsHashPayload(payload, { floatKeys: law.PREDICT_FROGGY_FLOAT_KEYS }),
    status: "succeeded",
    experts: data.RECORDED_TINY_BRAINS_EXPERTS.map((e) => ({ ...e })),
  };
  return { ...payload, invocation };
}

/**
 * Start the ephemeral stub on 127.0.0.1 (OS-assigned port).
 *
 * @param {{ recorded?: boolean }} [options] `recorded: true` serves the
 *   oracle recorded prediction (byte-source: test/oracle/support/
 *   recordedLaneData.ts) instead of the default governed response.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startTinyBrainsStub(options = {}) {
  const law = await loadCompiledHashLaw();
  // Node's native type stripping loads the plain-data .ts module (same
  // convention as test/support/registerDeterministicPriceFeed.mjs).
  const data = options.recorded
    ? await import(
        pathToFileURL(path.resolve(ROOT, "test/oracle/support/recordedLaneData.ts")).href
      )
    : undefined;

  const server = http.createServer((req, res) => {
    const reply = (status, value) => {
      const bytes = JSON.stringify(value);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(bytes);
    };
    if (req.method !== "POST" || req.url !== "/predict/froggy") {
      reply(404, { error: "tinyBrainsStub: unknown route (POST /predict/froggy only)" });
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        reply(400, { error: "tinyBrainsStub: request body is not JSON" });
        return;
      }
      if (typeof body?.profile !== "string" || body.profile.length === 0) {
        reply(400, { error: "tinyBrainsStub: request names no orchestration profile" });
        return;
      }
      try {
        reply(200, options.recorded ? recordedResponse(body, law, data) : defaultResponse(body, law));
      } catch (err) {
        // e.g. a request outside the tiny-brains.hash.v1 proven domain —
        // fail loudly (the lane fails closed), never a fabricated hash.
        reply(500, { error: `tinyBrainsStub: ${err instanceof Error ? err.message : String(err)}` });
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        // Destroy any keep-alive sockets so the caller's natural-termination
        // proof (no leaked handles) stays honest.
        server.closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
