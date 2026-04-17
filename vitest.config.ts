import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Vitest 4 no longer defaults NODE_ENV to "test"; React 19's production
// build drops `React.act`, which `@testing-library/react` requires. Force
// the development/test build so component suites pass under plain `make test`.
if (process.env.NODE_ENV !== "test") {
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
