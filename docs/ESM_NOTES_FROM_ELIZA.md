# ESM Baseline Notes from ElizaOS

**Date**: 2025-12-06  
**Purpose**: Document ElizaOS ESM patterns to guide AFI's ESM migration  
**Reference**: `/Users/secretservice/AFI_Modular_Repos/ElizaOS_Ext_Ref/eliza`

---

## 1. ElizaOS ESM Patterns Summary

### **Package-Level ESM Declaration**

ElizaOS uses **strict ESM** at both the monorepo root and individual package levels:

**Root `package.json`**:
```json
{
  "name": "eliza",
  "type": "module",
  "module": "index.ts",
  "engines": {
    "node": "23.3.0"
  }
}
```

**Package-level `package.json`** (e.g., `@elizaos/core`):
```json
{
  "name": "@elizaos/core",
  "type": "module",
  "main": "dist/index.js",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "node": {
        "types": "./dist/node/index.d.ts",
        "import": "./dist/node/index.node.js",
        "default": "./dist/node/index.node.js"
      },
      "default": "./dist/node/index.node.js"
    }
  }
}
```

**Key Observations**:
- ✅ `"type": "module"` is set at both root and package level
- ✅ `exports` field provides explicit entry points for Node/browser/types
- ✅ All compiled output is `.js` (not `.mjs`)
- ✅ TypeScript source uses `.ts` extensions, compiled output uses `.js`

---

## 2. TypeScript Configuration

### **Root `tsconfig.json`** (Development/IDE):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "baseUrl": ".",
    "paths": {
      "@elizaos/core": ["packages/core/src"],
      "@elizaos/core/*": ["packages/core/src/*"]
    }
  }
}
```

### **Build Template `tsconfig.build.template.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "rootDir": "./src",
    "outDir": "./dist",
    "declaration": true,
    "emitDeclarationOnly": true,
    "noEmit": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/__tests__/**", "node_modules", "dist"]
}
```

**Key Observations**:
- ✅ Root config uses `"module": "ES2022"` with `"noEmit": true` (IDE/type-checking only)
- ✅ Build config uses `"module": "ESNext"` with `"emitDeclarationOnly": true`
- ✅ `rootDir` and `outDir` are explicitly set for build configs
- ✅ `moduleResolution: "node"` (not "NodeNext") - relies on bundler for ESM resolution
- ✅ Path aliases (`@elizaos/core`) are used for cross-package imports in monorepo

---

## 3. Build System

ElizaOS uses **Bun + custom build scripts** (not plain `tsc`):

**Build approach** (`packages/core/build.ts`):
- Uses `bun` as the build runner
- Custom `createBuildRunner` utility from `build-utils`
- Generates separate builds for Node and browser targets
- Uses **esbuild** under the hood (via Bun's build API)
- Handles:
  - Multiple entry points (`index.node.ts`, `index.browser.ts`)
  - External dependencies (not bundled)
  - Source maps
  - Type declarations (via separate `tsc` pass with `emitDeclarationOnly`)

**Build command**:
```bash
bun run build.ts
```

**Key Observations**:
- ✅ ElizaOS does NOT use plain `tsc` for compilation
- ✅ Uses a bundler (esbuild via Bun) to handle ESM output
- ✅ TypeScript is used only for type-checking and `.d.ts` generation
- ✅ Bundler handles module resolution, so `.js` extensions are NOT required in source imports

---

## 4. Import Patterns in Source Code

**Sample imports from `packages/core/src`**:
```typescript
import { v4 as uuidv4 } from 'uuid';
import { AgentRuntime } from './runtime';
import { setDefaultSecretsFromEnv } from './secrets';
import { resolvePlugins } from './plugin';
import type { Content, UUID } from './primitives';
import type { IAgentRuntime } from './runtime';
```

**Key Observations**:
- ✅ Relative imports use **NO `.js` extensions** in source (e.g., `'./runtime'`, not `'./runtime.js'`)
- ✅ Bundler (esbuild) resolves these to correct `.js` paths in output
- ✅ `type` imports are used for type-only imports (tree-shaking optimization)
- ✅ External packages use bare specifiers (e.g., `'uuid'`)

---

## 5. What AFI Should Mirror

### **✅ SHOULD Mirror**:

1. **Package-level `"type": "module"`** in `package.json`
2. **Explicit `exports` field** for entry points (if publishing packages)
3. **Separate TS configs** for development (IDE) vs. build
4. **Use a bundler** (esbuild, tsup, or Bun) instead of plain `tsc` for compilation
5. **`moduleResolution: "node"`** with bundler handling ESM resolution
6. **No `.js` extensions in source imports** (let bundler handle it)
7. **`rootDir` and `outDir`** explicitly set in build configs
8. **Type-only imports** where appropriate (`import type { ... }`)

### **❌ Should NOT Copy**:

1. **Monorepo structure** - AFI uses multi-repo, not monorepo
2. **Bun-specific features** - AFI may use Node/npm/pnpm, not Bun
3. **Dual Node/browser builds** - AFI is server-side only (for now)
4. **Turbo/Lerna** - AFI doesn't need monorepo orchestration tools
5. **Path aliases for cross-package imports** - AFI uses npm packages, not workspace aliases

---

## 6. Recommended AFI ESM Strategy

Based on ElizaOS patterns, AFI should:

1. **Add `"type": "module"`** to `afi-core` and `afi-reactor` `package.json`
2. **Use a bundler** (tsup or esbuild) for compilation instead of plain `tsc`
3. **Keep source imports clean** (no `.js` extensions) and let bundler handle ESM output
4. **Separate TS configs**:
   - `tsconfig.json` for IDE/type-checking (`noEmit: true`)
   - `tsconfig.build.json` for build (`emitDeclarationOnly: true` for types)
5. **Handle cross-repo imports** via npm package dependencies (not symlinks or path aliases)

---

## 7. Key Differences: AFI vs. ElizaOS

| **Aspect** | **ElizaOS** | **AFI** |
|------------|-------------|---------|
| **Repo structure** | Monorepo (Turbo + workspaces) | Multi-repo (separate npm packages) |
| **Build tool** | Bun + custom build scripts | npm + tsc (currently) |
| **Cross-package imports** | Workspace aliases (`@elizaos/core`) | npm dependencies (`afi-core`) |
| **Module resolution** | Bundler-based (esbuild) | tsc-based (currently broken) |
| **Target** | Node + browser | Node only |

**Implication**: AFI cannot use workspace aliases. Cross-repo imports must go through published (or locally linked) npm packages.

---

## 8. Next Steps

See `ESM_GAP_ANALYSIS.md` for AFI-specific diagnosis and migration plan.

