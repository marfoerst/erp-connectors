/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "prettier",
  ],
  globals: {
    shopify: "readonly",
  },
  overrides: [
    {
      // The template's jest-testing-library preset pulls in eslint-plugin-jest,
      // which throws on any *.test.ts because it cannot detect a Jest install —
      // this project tests with Vitest. Declare the Vitest globals instead.
      files: ["**/*.test.ts", "**/*.test.tsx"],
      env: { node: true },
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        vi: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
    {
      // TypeScript parameter properties are the idiomatic way to declare and
      // assign in one place; the base rule flags them as useless.
      files: ["**/*.ts", "**/*.tsx"],
      rules: {
        "no-useless-constructor": "off",
      },
    },
  ],
};
