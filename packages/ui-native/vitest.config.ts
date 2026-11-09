import { defineConfig } from "vitest/config";

// The package's view models alone: its components are drawn by SwiftUI, and
// the app's Maestro flows check them on the simulators (`apps/mobile/AGENTS.md`).
export default defineConfig({
  test: {
    name: "ui-native",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../wire/src/testing/file-time-cap.ts"],
  },
});
