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
