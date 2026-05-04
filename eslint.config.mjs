// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  {
    files: ["scripts/**/*.mjs", "*.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node,
      sourceType: "module",
    },
    extends: [js.configs.recommended],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: globals.browser,
    },
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        varsIgnorePattern: "^(InstrumentDefinition|PatchDefinition|ControlType)$",
      }],
    },
  },
);
