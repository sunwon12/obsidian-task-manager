// LLD §14.4: dependency direction을 lint로 강제한다.
//   ui     → store, services, i18n, core/types  (✘ obsidian, repositories, parser)
//   services → repositories, store, eventBus, core  (✘ obsidian, react)
//   repositories → parser, core, obsidian        (✘ services, store, react)
//   parser → core                                (✘ obsidian, react, services, repositories)

import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

const noRestrictedPaths = {
  "import/no-restricted-paths": [
    "error",
    {
      zones: [
        { target: "./src/ui",       from: "./src/repositories", message: "ui must go through services" },
        { target: "./src/ui",       from: "./src/parser",       message: "ui must go through services" },
        { target: "./src/services", from: "./src/ui",           message: "services must not depend on ui" },
        { target: "./src/parser",   from: "./src/repositories", message: "parser must not depend on repositories" },
        { target: "./src/parser",   from: "./src/services",     message: "parser must not depend on services" },
        { target: "./src/parser",   from: "./src/ui",           message: "parser must not depend on ui" },
        { target: "./src/core",     from: "./src/repositories", message: "core must not depend on repositories" },
        { target: "./src/core",     from: "./src/services",     message: "core must not depend on services" },
        { target: "./src/core",     from: "./src/parser",       message: "core must not depend on parser" },
        { target: "./src/core",     from: "./src/ui",           message: "core must not depend on ui" },
      ],
    },
  ],
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "*.config.mjs", "*.config.js"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "import": importPlugin,
    },
    settings: {
      "import/resolver": {
        node: { extensions: [".ts", ".tsx", ".js", ".mjs"] },
      },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      ...noRestrictedPaths,
    },
  },
  {
    files: ["src/services/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "obsidian", message: "services must not import obsidian — go through repositories" }] },
      ],
    },
  },
  {
    files: ["src/parser/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [
          { name: "obsidian", message: "parser must be obsidian-free" },
          { name: "react", message: "parser must be react-free" },
        ] },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    ignores: ["src/core/diagnostics.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "obsidian", message: "core must be obsidian-free (diagnostics excepted)" }] },
      ],
    },
  },
];
