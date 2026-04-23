import { defineConfig, globalIgnores } from "eslint/config";
import boundaries from "eslint-plugin-boundaries";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        { type: "domain", pattern: "src/lib/domain/**" },
        { type: "ports", pattern: "src/lib/ports/**" },
        { type: "application", pattern: "src/lib/application/**" },
        { type: "infrastructure", pattern: "src/lib/infrastructure/**" },
        { type: "composition", pattern: "src/lib/composition/**" },
        { type: "app", pattern: "src/app/**" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "domain", allow: ["domain"] },
            { from: "ports", allow: ["domain", "ports"] },
            { from: "application", allow: ["domain", "ports", "application"] },
            {
              from: "infrastructure",
              allow: ["domain", "ports", "infrastructure"],
            },
            {
              from: "composition",
              allow: [
                "domain",
                "ports",
                "application",
                "infrastructure",
                "composition",
              ],
            },
            {
              from: "app",
              allow: ["domain", "application", "composition", "app"],
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "boundaries/element-types": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
