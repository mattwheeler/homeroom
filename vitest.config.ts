import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "threads",
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.d.ts"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    }
  }
});
