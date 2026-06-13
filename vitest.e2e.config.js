import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.js"],
    fileParallelism: false,
    testTimeout: 90000,
    hookTimeout: 180000,
    // Selenium drives one shared browser; tests within the file run in
    // declaration order and build on each other's state.
    sequence: { concurrent: false },
  },
});
