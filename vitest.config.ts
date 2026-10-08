import { defineConfig } from "vitest/config";

// Eigene Datei statt vite.config.ts: die ist auf den Tauri-Dev-Server
// zugeschnitten, Tests brauchen davon nichts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
