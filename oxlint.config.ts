import { defineConfig } from "oxlint";

/**
 * Rules turned off (each group says why they do not fit this code).
 *
 * @param rules The names of the rules.
 * @returns The rules, each turned off.
 */
const off = (...rules: string[]): Record<string, "off"> =>
  Object.fromEntries(rules.map((rule) => [rule, "off"]));

export default defineConfig({
  plugins: [
    "eslint",
    "typescript",
    "unicorn",
    "oxc",
    "import",
    "jsdoc",
    "node",
    "promise",
    "vitest",
  ],
  // Every rule, except those turned off below.
  categories: {
    correctness: "error",
    suspicious: "error",
    pedantic: "error",
    perf: "error",
    style: "error",
    restriction: "error",
  },
  options: { typeAware: true, reportUnusedDisableDirectives: "error" },
  ignorePatterns: ["lib/", "test/fixtures/"],
  rules: {
    eqeqeq: ["error", "smart"],
    "one-var": ["error", "never"],
    "func-style": ["error", "declaration", { allowArrowFunctions: true }],
    "prefer-arrow-callback": ["error", { allowNamedFunctions: true }],
    "prefer-destructuring": ["error", { object: true, array: false }],
    "capitalized-comments": [
      "error",
      "always",
      // (Lines continuing a comment continue its sentence.)
      { ignorePattern: "oxfmt-ignore", ignoreConsecutiveComments: true },
    ],
    yoda: ["error", "never"],
    curly: ["error", "multi-line"],
    "no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "unicorn/catch-error-name": ["error", { name: "e" }],
    // Errors are caught as `e`, as catch-error-name asks.
    "id-length": ["error", { exceptions: ["e"] }],
    "unicorn/numeric-separators-style": [
      "error",
      { hexadecimal: { onlyIfContainsSeparator: true } },
    ],
    "typescript/explicit-member-accessibility": [
      "error",
      { accessibility: "no-public" },
    ],
    "typescript/explicit-function-return-type": [
      "error",
      { allowExpressions: true },
    ],
    "typescript/no-confusing-void-expression": [
      "error",
      { ignoreArrowShorthand: true },
    ],
    // Optional flags are off whether they are `false` or left out.
    "typescript/strict-boolean-expressions": [
      "error",
      { allowNullableBoolean: true },
    ],
    "typescript/switch-exhaustiveness-check": [
      "error",
      { considerDefaultExhaustiveForUnions: true },
    ],
    "vitest/prefer-lowercase-title": ["error", { ignore: ["describe"] }],

    // Source maps are numbers and bits.
    ...off("no-magic-numbers", "no-bitwise"),
    // ASTs use `null` for absent nodes, the model leaves properties out.
    ...off("unicorn/no-null", "no-undefined", "unicorn/no-useless-undefined"),
    // Conversions switch over kinds of nodes and types, a case each.
    ...off("complexity"),
    // Modern syntax and the runtime's features are fine.
    ...off(
      "oxc/no-async-await",
      "oxc/no-optional-chaining",
      "oxc/no-rest-spread-properties",
      "no-plusplus",
      "no-continue",
      "no-ternary",
      "no-nested-ternary",
      "unicorn/no-nested-ternary",
      "unicorn/no-array-reduce",
      "no-await-in-loop",
      "promise/avoid-new",
      "promise/prefer-await-to-then",
      "node/no-top-level-await",
      "node/no-sync",
      "import/no-nodejs-modules",
      "unicorn/import-style",
    ),
    // Async functions without `await` return their values and errors as promises.
    ...off("require-await", "typescript/require-await"),
    // Sizes, and orders that do not follow the code's structure.
    ...off(
      "max-params",
      "max-statements",
      "max-lines",
      "max-lines-per-function",
      "max-classes-per-file",
      "unicorn/max-nested-calls",
      "sort-keys",
      "no-use-before-define",
      "no-inline-comments",
      "init-declarations",
    ),
    // Imports are sorted by oxfmt (in another order), and written as the modules are.
    ...off(
      "sort-imports",
      "import/consistent-type-specifier-style",
      "import/no-named-export",
      "import/no-default-export",
      "import/prefer-default-export",
      "import/group-exports",
      "import/exports-last",
      "import/no-relative-parent-imports",
    ),
    // The formatter writes hex digits in lowercase.
    ...off("unicorn/number-literal-case"),
    // TypeScript has the types (and infers them for readonly values and assertions).
    ...off(
      "jsdoc/require-param-type",
      "jsdoc/require-returns-type",
      "jsdoc/require-yields-type",
      "jsdoc/require-throws-type",
      "typescript/prefer-readonly-parameter-types",
      "typescript/no-unsafe-type-assertion",
      "typescript/no-non-null-assertion",
      "typescript/promise-function-async",
    ),
    // Method signatures, mapped types, `{}` and type aliases are chosen for how they check and infer.
    ...off(
      "typescript/method-signature-style",
      "typescript/consistent-indexed-object-style",
      "typescript/consistent-type-definitions",
      "typescript/ban-types",
      "no-redeclare",
    ),
    // Functions converting values declare the types they convert.
    ...off("unicorn/prefer-native-coercion-functions"),
    // Tests: tables of cases, assertions in helpers, and `toBe(true)` (stricter than `toBeTruthy()`).
    ...off(
      "vitest/prefer-expect-assertions",
      "vitest/require-test-timeout",
      "vitest/no-conditional-in-test",
      "vitest/no-importing-vitest-globals",
      "vitest/require-hook",
      "vitest/max-expects",
      "vitest/prefer-describe-function-title",
      "vitest/prefer-to-be-truthy",
      "vitest/prefer-to-be-falsy",
    ),
  },
  overrides: [
    {
      // The browser script is a module, marked as one with `export {}`.
      files: ["assets/**"],
      rules: off("unicorn/require-module-specifiers"),
    },
    {
      // Plain JavaScript has no types to check.
      files: ["**/*.mjs"],
      rules: off(
        "typescript/no-unsafe-argument",
        "typescript/no-unsafe-assignment",
        "typescript/no-unsafe-call",
        "typescript/no-unsafe-member-access",
        "typescript/no-unsafe-return",
      ),
    },
    {
      // Tests rely on inferred types (codecs' types are long).
      files: ["test/**"],
      rules: off(
        "typescript/explicit-function-return-type",
        "typescript/explicit-module-boundary-types",
      ),
    },
  ],
});
