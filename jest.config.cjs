/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchman: false,
  rootDir: '.',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    // Mirrors the tsconfig `@/.mercato/*` path. Must come first — the generic
    // `@/` rule below would otherwise resolve it to src/.mercato/, which does
    // not exist, and any test importing a module that reads generated files
    // fails to run.
    '^@/\\.mercato/(.*)$': '<rootDir>/.mercato/$1',
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
  // ESM-only packages that CJS callers pull in, so Jest has to transform them:
  //  - kysely: MikroORM 7.1 split the SQL layer into @mikro-orm/sql, which uses it
  //  - htmlparser2 & co: reached via sanitize-html from @open-mercato/shared
  transformIgnorePatterns: [
    // sanitize-html is CJS but nests the whole ESM htmlparser2 cluster, and the
    // pattern is tested at every /node_modules/ segment — so the outer
    // sanitize-html/ segment has to pass as well, not just the inner ones.
    '/node_modules/(?!(@open-mercato|@mikro-orm)/|kysely/|sanitize-html/|htmlparser2/|domhandler/|domutils/|domelementtype/|dom-serializer/|entities/)',
  ],
}
