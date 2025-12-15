export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true
    }
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Map afi-core imports to local stub (for CI where afi-core is unavailable)
    '^afi-core/analysts/froggy\\.enrichment_adapter\\.js$': '<rootDir>/test/afi-core-types.stub.ts',
    // Fallback for other afi-core imports (if node_modules/afi-core exists)
    '^afi-core/(.*)\\.js$': '<rootDir>/node_modules/afi-core/$1.ts'
  },
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  collectCoverageFrom: [
    'core/**/*.ts',
    'ops/**/*.ts',
    '!**/*.d.ts'
  ]
};
