export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
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
    '^afi-core/analysts/(.*)\\.js$': '<rootDir>/node_modules/afi-core/analysts/$1.ts'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(afi-core)/)'
  ],
  testEnvironment: 'node',
  testMatch: [
    "**/test/dagConfigShape.test.ts",
    "**/test/froggyWebhookService.test.ts",
    "**/test/guardrails/uwrProfileStamp.test.ts",
    "**/test/guardrails/uwrRuntimeProfile.test.ts",
    "**/test/guardrails/no-legacy-ingest.test.ts",
    "**/test/state-management.test.ts",
    "**/test/integration/state-lifecycle.test.ts",
    "**/src/dag/__tests__/*.test.ts",
    "**/test/pipeheads/**/*.test.ts",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/dist/",
    "<rootDir>/test/enrichment/",
    "<rootDir>/test/news/",
    "<rootDir>/test/novelty/",
    "<rootDir>/test/pipelineRunner",
    "<rootDir>/test/pipelineRunnerDag.test.ts",
    "<rootDir>/test/receiptProvenanceService.test.ts",
    "<rootDir>/test/scoreDecayService.test.ts",
    "<rootDir>/test/tssdVaultService.test.ts",
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
