import { defineConfig } from "vitest/config";

// The app's logic alone: its screens are checked by the Maestro flows under
// `maestro/`, which CI's macOS job runs on the simulators (`AGENTS.md`).
export default defineConfig({
  test: {
    name: "mobile",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../../packages/wire/src/testing/file-time-cap.ts"],
  },
});
