export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    // ORACLE-EQUIVALENCE: the oracle harness imports the real server, which
    // loads two ESM-only compiled deps (afi-core's @afi-protocol/afi-math decay
    // kernels + afi-infra's evidence store). Down-level ONLY those published
    // .js files to CJS (pure syntax transform of the real shipped code — see
    // test/oracle/support/esmDepCjsTransform.cjs). Keys are checked in order,
    // and these patterns match .js only, so ts-jest still owns every .ts file.
    '@afi-protocol[\\\\/]afi-math[\\\\/].+\\.js$':
      '<rootDir>/test/oracle/support/esmDepCjsTransform.cjs',
    'afi-infra[\\\\/]dist[\\\\/].+\\.js$':
      '<rootDir>/test/oracle/support/esmDepCjsTransform.cjs',
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'esnext',
          moduleResolution: 'bundler',
        },
      },
    ],
  },
  moduleNameMapper: {
    // Map relative imports with .js extension to .ts source files
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // PR-UWR-RUNTIME-READ: jest cannot resolve afi-core's package-exports
    // value subpaths (the reason scoringPipehead's scorer import is dynamic).
    // Map the validators + analysts subpaths to the file:-linked TypeScript
    // source so the runtime profile module, the froggy plugin, and their
    // guardrail tests load under jest; transformIgnorePatterns already opts
    // afi-core into ts-jest transform.
    '^afi-core/validators/(.*)\\.js$': '<rootDir>/node_modules/afi-core/validators/$1.ts',
    '^afi-core/analysts/(.*)\\.js$': '<rootDir>/node_modules/afi-core/analysts/$1.ts',
    // ORACLE-EQUIVALENCE: the oracle harness imports the REAL server (which
    // imports afi-core/decay); jest cannot resolve that package-exports value
    // subpath either — map it to the file:-linked TypeScript source the same
    // way as the validators/analysts subpaths above.
    '^afi-core/decay$': '<rootDir>/node_modules/afi-core/src/decay/index.ts',
    // afi-infra's package exports declare only the "import" condition, which
    // jest's CJS resolution cannot match — map the root subpath to the real
    // compiled entry (down-leveled to CJS by the oracle transform above).
    '^afi-infra$': '<rootDir>/node_modules/afi-infra/dist/evidence/index.js'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(afi-core|afi-infra|@afi-protocol)/)'
  ],
  testEnvironment: 'node',
  testMatch: [
    "**/test/dagConfigShape.test.ts",
    "**/test/froggyWebhookService.test.ts",
    "**/test/guardrails/uwrProfileStamp.test.ts",
    "**/test/guardrails/uwrRuntimeProfile.test.ts",
    "**/test/guardrails/uwrStampSemantics.test.ts",
    "**/test/guardrails/no-legacy-ingest.test.ts",
    "**/test/guardrails/no-legacy-reactor-vault.test.ts",
    // SLOT-FCP-REACTOR stage B: no hardcoded composition identity in the
    // ACTIVE runtime (cleanup-pending allowlist emptied by SLOT-FCP-CLEANUP).
    "**/test/guardrails/no-hardcoded-composition.test.ts",
    "**/test/state-management.test.ts",
    "**/test/integration/state-lifecycle.test.ts",
    "**/src/dag/__tests__/*.test.ts",
    // SLOT-FCP-REACTOR stage A: executor core, hashing KATs, vendored-closure
    // drift guard, registry boot validation, graph proofs, node units.
    "**/test/pipeline/**/*.test.ts",
    "**/test/pipeheads/**/*.test.ts",
    "**/test/evidence/**/*.test.ts",
    // ORACLE-EQUIVALENCE: the behavioral-oracle harness is part of the DEFAULT
    // run (non-skippable); only the real-Mongo half lives in the gated
    // test:oracle:mongo script (repo IT convention).
    "**/test/oracle/*.test.ts",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/dist/",
    "<rootDir>/test/enrichment/",
    "<rootDir>/test/news/",
    "<rootDir>/test/pipelineRunner",
    "<rootDir>/test/pipelineRunnerDag.test.ts",
    "<rootDir>/test/receiptProvenanceService.test.ts",
    "<rootDir>/test/vaultReplayService.test.ts",
    "<rootDir>/test/uss/",
    "<rootDir>/test/cpj/",
  ],
  collectCoverageFrom: [
    'core/**/*.ts',
    'ops/**/*.ts',
    '!**/*.d.ts'
  ],
  // Set NODE_ENV to 'test' to prevent server from starting during tests
  setupFiles: ['<rootDir>/test/setup.js']
};
