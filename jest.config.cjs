/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': [
      '<rootDir>/scripts/jest-mikroorm-transformer.cjs',
      {
        tsconfig: {
          jsx: 'react-jsx',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          module: 'commonjs',
          target: 'ES2022',
          isolatedModules: true,
        },
        diagnostics: {
          ignoreCodes: ['TS151001'],
        },
      },
    ],
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.(ts|tsx)',
    '<rootDir>/packages/*/src/**/__tests__/**/*.test.(ts|tsx)',
  ],
  passWithNoTests: true,
  transformIgnorePatterns: ['/node_modules/(?!(@open-mercato|@mikro-orm)/)'],
}
