import { fileURLToPath, URL } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [react()],
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**", "**/*.postgres.test.ts"],
    setupFiles: "./src/test/setup.ts",
    globals: true,
  },
});
