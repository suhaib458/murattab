import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  { rules: { "react-hooks/incompatible-library": "off" } },
  globalIgnores([".next/**", "coverage/**", "playwright-report/**"]),
]);
