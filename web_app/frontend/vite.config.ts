import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 開發時把 /api 與 /ws 轉給後端，正式版由後端直接吃靜態檔，
// 兩種情況下前端的程式碼都用相對路徑，不必分岔。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8100", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8100", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
