export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true
    }
  },
  moduleNameMapper: {
    // Map afi-core package exports to their TypeScript source files (for Jest to transform)
    '^afi-core/analysts/(.*)\.js$': '<rootDir>/node_modules/afi-core/analysts/$1.ts',
    '^afi-core/validators/(.*)\.js$': '<rootDir>/node_modules/afi-core/validators/$1.ts',
    '^afi-core/schemas/(.*)\.js$': '<rootDir>/node_modules/afi-core/schemas/$1.ts',
    '^afi-core/runtime/(.*)\.js$': '<rootDir>/node_modules/afi-core/runtime/$1.ts',
    // Map relative imports with .js extension to .ts source files
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  collectCoverageFrom: [
    'core/**/*.ts',
    'ops/**/*.ts',
    '!**/*.d.ts'
  ],
  // Set NODE_ENV to 'test' to prevent server from starting during tests
  setupFiles: ['<rootDir>/test/setup.js']
};
