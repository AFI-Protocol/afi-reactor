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
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(afi-core)/)'
  ],
  testEnvironment: 'node',
  testMatch: [
    "**/test/dagConfigShape.test.ts",
    "**/test/froggyWebhookService.test.ts",
    "**/test/state-management.test.ts",
    "**/test/integration/state-lifecycle.test.ts",
    "**/src/dag/__tests__/*.test.ts",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/dist/",
    "<rootDir>/test/enrichment/",
    "<rootDir>/test/guardrails/",
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
