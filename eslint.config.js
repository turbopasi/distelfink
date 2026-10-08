import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist", "src-tauri", "node_modules"] },
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // Die klassischen Hook-Regeln. Die übrigen aus `recommended` gehören zum
      // React Compiler, den Distelfink nicht nutzt — sie verlangen Umbauten
      // ohne Gewinn ohne ihn.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    // Testskripte und Werkzeuge greifen in Interna von Bibliotheken.
    files: ["scripts/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
