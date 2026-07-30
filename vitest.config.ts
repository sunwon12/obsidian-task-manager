import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/main.ts", "src/view/**"],
    },
  },
  resolve: {
    alias: {
      // T-003: 테스트에서 obsidian import는 mock으로 라우팅
      obsidian: path.resolve(__dirname, "./tests/__mocks__/obsidian.ts"),
    },
  },
});
