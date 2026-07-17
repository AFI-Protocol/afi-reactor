/**
 * ORACLE-EQUIVALENCE test-only jest transform.
 *
 * The oracle harness imports the REAL server (src/server.ts), which pulls in
 * two ESM-only compiled dependencies that jest's CJS runtime cannot execute
 * as-is:
 *
 *   - @afi-protocol/afi-math (afi-core's decay kernels; ESM dist under a real
 *     node_modules path, which ts-jest's language service mis-emits as ESM)
 *   - afi-infra (the canonical evidence store; ESM dist)
 *
 * This transform down-levels ONLY those published .js files to CommonJS with
 * TypeScript's transpileModule — a pure, behavior-preserving syntax
 * transformation of the REAL shipped code (no stubs, no re-implementation),
 * so the oracle goldens freeze genuine runtime behavior.
 */
"use strict";

const crypto = require("node:crypto");
const ts = require("typescript");

module.exports = {
  process(sourceText, sourcePath) {
    const result = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        allowJs: true,
        sourceMap: false,
      },
      // A node_modules path makes no difference to transpileModule, but keep
      // the real fileName for readable stack traces.
      fileName: sourcePath,
    });
    // transpileModule leaves `import.meta.url` untouched, which cannot parse in
    // a CJS script. Substitute the exact CJS equivalent of the current module's
    // file URL (fileURLToPath(pathToFileURL(__filename)) === __filename), so
    // afi-infra's schema-directory resolution keeps working unchanged.
    const code = result.outputText.replace(
      /\bimport\.meta\.url\b/g,
      "require('node:url').pathToFileURL(__filename).href"
    );
    return { code };
  },
  getCacheKey(sourceText, sourcePath) {
    return crypto
      .createHash("sha256")
      .update("oracle-esm-dep-cjs-v2\0")
      .update(sourcePath)
      .update("\0")
      .update(sourceText)
      .digest("hex");
  },
};
