# ESM Gap Analysis — AFI vs. ElizaOS

**Date**: 2025-12-06  
**Purpose**: Diagnose AFI's ESM problems and propose migration strategy  
**Scope**: `afi-core` and `afi-reactor` only

---

## 1. Current State: AFI ESM Configuration

### **afi-core** (`/Users/secretservice/AFI_Modular_Repos/afi-core`)

**package.json**:
```json
{
  "name": "afi-core",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./validators": {
      "import": "./dist/validators/index.js",
      "types": "./dist/validators/index.d.ts"
    },
    "./schemas": {
      "import": "./dist/schemas/index.js",
      "types": "./dist/schemas/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc --noEmit"  ⚠️ PROBLEM: --noEmit means no JS output!
  }
}
```

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",  ⚠️ PROBLEM: Bundler mode, but no bundler!
    "outDir": "./dist",
    "rootDir": "./",  ⚠️ PROBLEM: rootDir is repo root, not src/
    "declaration": true
  },
  "include": [
    "schemas/**/*",
    "validators/**/*",
    "analysts/**/*",
    "runtime/**/*",
    "cli_hooks/**/*",
    "src/**/*",
    "tests/**/*",
    "docs/**/*"  ⚠️ PROBLEM: Includes docs, tests in compilation
  ]
}
```

**Issues**:
1. ✅ `"type": "module"` is set correctly
2. ✅ `exports` field is well-structured
3. ❌ `build` script uses `tsc --noEmit` (no JS output!)
4. ❌ `moduleResolution: "Bundler"` but no bundler is used
5. ❌ `rootDir: "./"` includes non-source files
6. ❌ No actual compiled output in `dist/` (because of `--noEmit`)

---

### **afi-reactor** (`/Users/secretservice/AFI_Modular_Repos/afi-reactor`)

**package.json**:
```json
{
  "name": "afi-reactor",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",  ⚠️ PROBLEM: Points to .ts, not .js
    "./*": "./src/*"
  },
  "scripts": {
    "build": "tsc",
    "start:demo": "node dist/src/server.js"
  },
  "dependencies": {
    "afi-core": "file:../afi-core"  ⚠️ PROBLEM: Local file dependency
  }
}
```

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",  ⚠️ MISMATCH: node vs. Bundler in afi-core
    "outDir": "./dist",
    "rootDir": "./",  ⚠️ PROBLEM: rootDir is repo root
    "declaration": false
  },
  "include": [
    "src/**/*",
    "ops/**/*",
    "core/**/*",  ⚠️ PROBLEM: Includes non-source dirs
    "codex/**/*"
  ]
}
```

**Issues**:
1. ✅ `"type": "module"` is set correctly
2. ❌ `exports` points to `.ts` files (should be `.js`)
3. ❌ `afi-core` dependency is `file:../afi-core` (local symlink/copy)
4. ❌ `moduleResolution: "node"` doesn't match afi-core's "Bundler"
5. ❌ `rootDir: "./"` causes cross-repo import issues
6. ✅ `build` script runs `tsc` (produces output)

---

## 2. The Core Problem: Cross-Repo Imports

**Problematic import pattern** in `afi-reactor/plugins/froggy.trend_pullback_v1.plugin.ts`:

```typescript
import { scoreFroggyTrendPullbackFromEnriched } from "../../afi-core/analysts/froggy.trend_pullback_v1.js";
```

**What happens**:
1. TypeScript compiles this to `dist/plugins/froggy.trend_pullback_v1.plugin.js`
2. The compiled JS contains: `import ... from "../../afi-core/analysts/froggy.trend_pullback_v1.js"`
3. At runtime, Node tries to resolve `../../afi-core/` from `dist/plugins/`
4. This path goes OUTSIDE the afi-reactor package
5. Node ESM throws: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/secretservice/AFI_Modular_Repos/afi-core/analysts/froggy.trend_pullback_v1'`

**Why this breaks**:
- afi-reactor's `rootDir: "./"` includes the parent directory in compilation scope
- TypeScript preserves relative paths in compiled output
- Node ESM requires all imports to resolve within the package or to installed dependencies
- `afi-core` is a `file:` dependency, not properly installed in `node_modules`

---

## 3. All Problematic Imports in afi-reactor

**Files with cross-repo imports**:

1. `plugins/froggy.trend_pullback_v1.plugin.ts`:
   ```typescript
   import type { FroggyEnrichedView } from "../../afi-core/analysts/froggy.enrichment_adapter.js";
   import { scoreFroggyTrendPullbackFromEnriched } from "../../afi-core/analysts/froggy.trend_pullback_v1.js";
   import type { FroggyTrendPullbackScore } from "../../afi-core/analysts/froggy.trend_pullback_v1.js";
   ```

2. `plugins/validator-decision-evaluator.plugin.ts`:
   ```typescript
   import type { ValidatorDecisionBase } from "../../afi-core/validators/ValidatorDecision.js";
   import type { FroggyTrendPullbackScore } from "../../afi-core/analysts/froggy.trend_pullback_v1.js";
   ```

3. `plugins/froggy-enrichment-adapter.plugin.ts`:
   ```typescript
   import type { FroggyEnrichedView } from "../../afi-core/analysts/froggy.enrichment_adapter.js";
   ```

**Total**: ~6-8 cross-repo import statements across 3 plugin files.

---

## 4. Differences Between AFI and ElizaOS

| **Aspect** | **ElizaOS** | **AFI (Current)** | **Gap** |
|------------|-------------|-------------------|---------|
| **Repo structure** | Monorepo (workspaces) | Multi-repo (separate packages) | AFI can't use workspace aliases |
| **Build tool** | Bun + esbuild | tsc only | AFI has no bundler |
| **Cross-package imports** | `@elizaos/core` (workspace alias) | `../../afi-core/` (relative path) | Breaks at runtime |
| **moduleResolution** | `node` (bundler handles ESM) | `Bundler` (afi-core) / `node` (afi-reactor) | Inconsistent |
| **rootDir** | `./src` | `./` (repo root) | Includes non-source files |
| **Build output** | Bundled JS via esbuild | Raw tsc output | No bundling, raw relative paths |
| **afi-core build** | N/A | `tsc --noEmit` (no output!) | No usable JS artifacts |

**Key Insight**: ElizaOS uses a bundler (esbuild) to resolve cross-package imports at build time. AFI uses raw `tsc`, which preserves relative paths that break at runtime.

---

## 5. ESM Migration Plan

### **Option A: Use a Bundler (tsup/esbuild) — RECOMMENDED** ✅

**Strategy**: Mirror ElizaOS's approach by using a bundler to compile afi-reactor.

**Steps**:
1. **afi-core**: Fix build script to emit JS (remove `--noEmit`)
2. **afi-core**: Adjust `tsconfig.json` to use `rootDir: "./src"` or similar
3. **afi-reactor**: Install `tsup` (lightweight esbuild wrapper for TS)
4. **afi-reactor**: Replace `tsc` with `tsup` in build script
5. **afi-reactor**: Configure `tsup` to:
   - Bundle afi-core dependencies inline OR
   - Mark afi-core as external and rely on proper npm package resolution
6. **afi-reactor**: Update imports to use `afi-core` package name (not relative paths)

**Pros**:
- ✅ Closest to ElizaOS's ESM approach
- ✅ Handles cross-repo imports cleanly
- ✅ Produces optimized, bundled output
- ✅ No manual import path fixes needed

**Cons**:
- ⚠️ Adds build tool dependency (tsup)
- ⚠️ Slightly more complex build setup

---

### **Option B: Fix Imports + Proper npm Linking**

**Strategy**: Keep `tsc`, but fix imports to use package names and ensure afi-core is properly installed.

**Steps**:
1. **afi-core**: Fix build script to emit JS (remove `--noEmit`)
2. **afi-core**: Publish to local npm registry OR use `npm link`
3. **afi-reactor**: Replace all `../../afi-core/` imports with `afi-core/` package imports
4. **afi-reactor**: Run `npm link afi-core` to link local package
5. **afi-core**: Add proper barrel exports (index files) for all modules

**Pros**:
- ✅ No new build tools
- ✅ Simpler build setup

**Cons**:
- ❌ Requires manual import path fixes (~6-8 files)
- ❌ `npm link` can be fragile
- ❌ Doesn't match ElizaOS's bundler-based approach
- ❌ Still relies on tsc's raw output (no optimization)

---

### **Option C: Monorepo Migration (OUT OF SCOPE)**

**Strategy**: Convert AFI to a monorepo like ElizaOS.

**Pros**:
- ✅ Perfect alignment with ElizaOS
- ✅ Workspace aliases work natively

**Cons**:
- ❌ Massive architectural change
- ❌ Violates "multi-repo" governance constraint
- ❌ Out of scope for this ESM migration

---

## 6. RECOMMENDED APPROACH: Option A (Bundler)

**Justification**:
1. **Closest to ElizaOS**: ElizaOS uses esbuild via Bun; we'll use esbuild via tsup
2. **Least invasive**: No import path changes needed (bundler resolves them)
3. **Best for Prize Demo**: Produces clean, optimized output
4. **Future-proof**: Bundler setup is standard for modern TS/ESM projects

**Next**: See implementation plan in next section.

---

## 7. Implementation Plan (Option A: Bundler Approach)

### **Phase 1: Fix afi-core Build**

**Goal**: Make afi-core emit usable JS artifacts.

**Changes**:
1. Update `afi-core/package.json`:
   ```json
   "scripts": {
     "build": "tsc",  // Remove --noEmit
     "build:clean": "rm -rf dist && npm run build"
   }
   ```

2. Update `afi-core/tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ESNext",
       "moduleResolution": "node",  // Change from "Bundler" to "node"
       "outDir": "./dist",
       "rootDir": "./",  // Keep as-is for now (includes all source dirs)
       "declaration": true,
       "declarationMap": true,
       "sourceMap": true
     },
     "include": [
       "schemas/**/*",
       "validators/**/*",
       "analysts/**/*",
       "runtime/**/*"
       // Remove: cli_hooks, src, tests, docs
     ],
     "exclude": [
       "node_modules",
       "dist",
       "coverage",
       "**/*.test.ts",
       "**/*.spec.ts",
       "**/__tests__/**"
     ]
   }
   ```

3. Run `cd afi-core && npm run build` to verify JS output

**Expected outcome**: `afi-core/dist/` contains compiled JS + .d.ts files

---

### **Phase 2: Install tsup in afi-reactor**

**Goal**: Add bundler tooling to afi-reactor.

**Changes**:
1. Install tsup:
   ```bash
   cd afi-reactor
   npm install --save-dev tsup
   ```

2. Create `afi-reactor/tsup.config.ts`:
   ```typescript
   import { defineConfig } from 'tsup';

   export default defineConfig({
     entry: ['src/server.ts'],  // Main entry point
     format: ['esm'],
     target: 'es2022',
     outDir: 'dist',
     sourcemap: true,
     clean: true,
     dts: false,  // Skip .d.ts generation (not needed for server)
     external: [
       // Mark afi-core as external (don't bundle it)
       'afi-core',
     ],
     noExternal: [
       // Bundle local plugins
     ],
   });
   ```

3. Update `afi-reactor/package.json`:
   ```json
   "scripts": {
     "build": "tsup",
     "build:tsc": "tsc --noEmit",  // Keep for type-checking
     "start:demo": "node dist/server.js",  // Updated path
     "dev": "tsup --watch"
   }
   ```

**Expected outcome**: `npm run build` produces bundled `dist/server.js`

---

### **Phase 3: Fix afi-reactor Imports**

**Goal**: Change cross-repo imports to use package names.

**Changes**:

1. `plugins/froggy.trend_pullback_v1.plugin.ts`:
   ```typescript
   // BEFORE:
   import type { FroggyEnrichedView } from "../../afi-core/analysts/froggy.enrichment_adapter.js";
   import { scoreFroggyTrendPullbackFromEnriched } from "../../afi-core/analysts/froggy.trend_pullback_v1.js";

   // AFTER:
   import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
   import { scoreFroggyTrendPullbackFromEnriched } from "afi-core/analysts/froggy.trend_pullback_v1.js";
   ```

2. `plugins/validator-decision-evaluator.plugin.ts`:
   ```typescript
   // BEFORE:
   import type { ValidatorDecisionBase } from "../../afi-core/validators/ValidatorDecision.js";

   // AFTER:
   import type { ValidatorDecisionBase } from "afi-core/validators/ValidatorDecision.js";
   ```

3. `plugins/froggy-enrichment-adapter.plugin.ts`:
   ```typescript
   // BEFORE:
   import type { FroggyEnrichedView } from "../../afi-core/analysts/froggy.enrichment_adapter.js";

   // AFTER:
   import type { FroggyEnrichedView } from "afi-core/analysts/froggy.enrichment_adapter.js";
   ```

**Expected outcome**: All imports use `afi-core/` package prefix

---

### **Phase 4: Ensure afi-core is Properly Linked**

**Goal**: Make sure afi-reactor can resolve `afi-core` package.

**Changes**:
1. Verify `afi-reactor/package.json` has:
   ```json
   "dependencies": {
     "afi-core": "file:../afi-core"
   }
   ```

2. Run `npm install` in afi-reactor to ensure link is created

3. Verify `afi-reactor/node_modules/afi-core` exists and points to `../afi-core`

**Expected outcome**: `afi-core` is resolvable as a package

---

### **Phase 5: Build and Test**

**Goal**: Verify the ESM migration works end-to-end.

**Steps**:
1. Build afi-core:
   ```bash
   cd afi-core
   npm run build
   ```

2. Build afi-reactor:
   ```bash
   cd afi-reactor
   npm run build
   ```

3. Start the server:
   ```bash
   npm run start:demo
   ```

4. Test the Prize Demo endpoint:
   ```bash
   curl -X POST http://localhost:8080/demo/prize-froggy
   ```

**Expected outcome**: Server starts without ESM errors, endpoint returns valid response

---

## 8. Rollback Plan

If Option A fails, we can quickly rollback to Option B:

1. Uninstall tsup: `npm uninstall tsup`
2. Revert `package.json` build script to `"build": "tsc"`
3. Manually fix imports to use `afi-core/` package names (no bundler)
4. Use `npm link afi-core` for local development

---

## 9. Success Criteria

The ESM migration is complete when:

- ✅ `afi-core` builds successfully (`npm run build` produces JS in `dist/`)
- ✅ `afi-reactor` builds successfully (`npm run build` produces bundled JS)
- ✅ `afi-reactor` server starts without ESM module resolution errors
- ✅ `/demo/prize-froggy` endpoint works and returns valid response
- ✅ No cross-repo relative path imports remain in compiled output
- ✅ Build setup is documented and reproducible

---

## 10. Next Steps

Proceed to STEP 4: Implementation (following Phase 1-5 above).

---

## 11. Implementation Progress Log

### Phase 1: Fix afi-core Build ✅ COMPLETE

**Changes made**:
1. Updated `afi-core/package.json`:
   - Changed `"build": "tsc --noEmit"` to `"build": "tsc"`
   - Added `"typecheck": "tsc --noEmit"` for type-checking only
2. Updated `afi-core/tsconfig.json`:
   - Changed `moduleResolution` from `"Bundler"` to `"node"`
   - Removed non-source dirs from `include` (cli_hooks, signal_schema_test, src, tests, docs)
   - Added them to `exclude` instead
3. Ran `npm run build` - SUCCESS ✅
4. Verified JS output in `dist/analysts/` and `dist/validators/` - SUCCESS ✅

### Phase 2: Install tsup in afi-reactor ⏭️ SKIPPED

**Decision**: Skipped bundler approach in favor of simpler fix-imports approach (Option B).

### Phase 3: Fix afi-reactor Imports ✅ COMPLETE

**Changes made**:
1. Fixed imports in `plugins/froggy.trend_pullback_v1.plugin.ts`
2. Fixed imports in `plugins/validator-decision-evaluator.plugin.ts`
3. Fixed imports in `plugins/froggy-enrichment-adapter.plugin.ts`
4. Fixed imports in `plugins/execution-agent-sim.plugin.ts`
5. Fixed imports in `plugins/alpha-scout-ingest.plugin.ts`
6. Fixed imports in `test/froggyPipeline.test.ts`

All changed from `../../afi-core/...` to `afi-core/...`

### Phase 4: Ensure afi-core is Properly Linked ✅ COMPLETE

**Changes made**:
1. Ran `npm install` in afi-reactor
2. Verified symlink: `node_modules/afi-core -> ../../afi-core` ✅

### Phase 5: Build and Test 🔄 IN PROGRESS

**Build status**:
- ✅ afi-core builds successfully
- ✅ afi-reactor builds successfully
- ❌ Server fails to start with ESM module resolution errors

**Current blocker**: afi-core source files are missing `.js` extensions in their imports.

**Error**:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/secretservice/AFI_Modular_Repos/afi-core/dist/validators/UniversalWeightingRule' imported from /Users/secretservice/AFI_Modular_Repos/afi-core/dist/analysts/froggy.trend_pullback_v1.js
```

**Root cause**:
- `afi-core/analysts/froggy.trend_pullback_v1.ts` line 6:
  ```typescript
  import { ... } from "../validators/UniversalWeightingRule";
  ```
- Should be:
  ```typescript
  import { ... } from "../validators/UniversalWeightingRule.js";
  ```

**Next action**: Add `.js` extensions to all relative imports in afi-core source files.

### Phase 6: Fix afi-core Internal Imports (NEW) ✅ COMPLETE

**Strategy**: Add `.js` extensions to all relative imports in afi-core TypeScript source files.

**Files fixed**:
1. `analysts/froggy.trend_pullback_v1.ts` - Added `.js` to imports from validators and enrichment_adapter
2. `analysts/froggy.enrichment_adapter.ts` - Added `.js` to import from trend_pullback_v1
3. `validators/SignalScorer.ts` - Added `.js` to import from schemas
4. `validators/ValidatorDecision.ts` - Added `.js` to import from NoveltyTypes
5. `validators/index.ts` - Added `.js` to all barrel exports
6. `schemas/index.ts` - Added `.js` to all barrel exports

**Note**: This is a standard requirement for TypeScript ESM. When `moduleResolution: "node"` is used with `"type": "module"`, TypeScript requires explicit `.js` extensions in import paths (even though the source files are `.ts`).

**Build status**:
- ✅ afi-core rebuilt successfully
- ✅ afi-reactor server starts without errors
- ✅ `/demo/prize-froggy` endpoint works correctly

### Phase 7: Final Validation ✅ COMPLETE

**Server start**:
```bash
cd afi-reactor
node dist/src/server.js
```

**Output**:
```
🚀 AFI-REACTOR HTTP DEMO SERVER
   Listening on http://localhost:8080
   Endpoints:
     GET  /health
     POST /api/webhooks/tradingview
     POST /demo/prize-froggy (Prize Demo with stage summaries)

   ⚠️  DEV/DEMO ONLY - No real trading or emissions
```

**Endpoint test**:
```bash
curl -X POST http://localhost:8080/demo/prize-froggy
```

**Response** (formatted):
```json
{
    "signalId": "alpha-72e72a10-f303-420f-8bf7-1d0cdc728714",
    "validatorDecision": {
        "decision": "flag",
        "uwrConfidence": 0.5916666666666667,
        "reasonCodes": ["score-medium", "needs-review", "froggy-demo"]
    },
    "execution": {
        "status": "skipped",
        "type": "hold",
        "timestamp": "2025-12-06T22:15:58.575Z",
        "notes": "Execution skipped due to validator flag/abstain (needs review)"
    },
    "meta": {
        "symbol": "BTC/USDT",
        "timeframe": "1h",
        "strategy": "froggy_trend_pullback_v1",
        "direction": "long",
        "source": "tradingview-webhook"
    },
    "uwrScore": 0.5916666666666667,
    "stageSummaries": [
        {
            "stage": "scout",
            "persona": "Alpha",
            "status": "complete",
            "summary": "Ingested BTC/USDT long signal on 1h timeframe"
        },
        {
            "stage": "structurer",
            "persona": "Pixel Rick",
            "status": "complete",
            "summary": "Normalized signal to USS (Universal Signal Schema) format"
        },
        {
            "stage": "enrichment",
            "persona": "Pixel Rick",
            "status": "complete",
            "summary": "Applied enrichment legos: technical, pattern",
            "enrichmentCategories": ["technical", "pattern"]
        },
        {
            "stage": "analyst",
            "persona": "Froggy",
            "status": "complete",
            "summary": "Analyzed trend-pullback setup, UWR score: 0.59",
            "uwrScore": 0.5916666666666667
        },
        {
            "stage": "validator",
            "persona": "Val Dook",
            "status": "complete",
            "summary": "Decision: flag, Confidence: 0.59",
            "decision": "flag"
        },
        {
            "stage": "execution",
            "persona": "Execution Sim",
            "status": "complete",
            "summary": "Simulated hold: skipped"
        }
    ],
    "isDemo": true
}
```

---

## 12. ESM Migration Complete ✅

**All success criteria met**:
- ✅ `afi-core` builds successfully (`npm run build` produces JS in `dist/`)
- ✅ `afi-reactor` builds successfully (`npm run build` produces compiled JS)
- ✅ `afi-reactor` server starts without ESM module resolution errors
- ✅ `/demo/prize-froggy` endpoint works and returns valid response
- ✅ No cross-repo relative path imports remain in compiled output
- ✅ Build setup is documented and reproducible

**Final approach**: Option B (Fix Imports + Proper npm Linking) with additional `.js` extension fixes in afi-core.

**Key changes**:
1. Fixed afi-core build script to emit JS (removed `--noEmit`)
2. Changed afi-core `moduleResolution` from `"Bundler"` to `"node"`
3. Updated all cross-repo imports in afi-reactor to use `afi-core/` package prefix
4. Added `.js` extensions to all relative imports in afi-core source files
5. Updated afi-core `package.json` exports to include `./analysts/*`, `./validators/*`, `./schemas/*`, `./runtime/*`

**No bundler required**: The simpler approach (Option B) worked perfectly after adding `.js` extensions to afi-core imports.

