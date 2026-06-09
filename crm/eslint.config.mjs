import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "*.js",
      "scripts/**/*.js",
      "scratch/**/*.js",
      ".claude/**",
      "**/scripts/**",
      "**/scratch/**",
      "**/*.js"
    ]
  },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-var": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
    }
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "*.js",
    "scripts/**/*.js",
    "scratch/**/*.js",
    ".claude/**",
    "**/scripts/**",
    "**/scratch/**",
    "**/*.js"
  ]),
]);

export default eslintConfig;
