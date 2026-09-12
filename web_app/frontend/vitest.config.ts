import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 前端測試。分開一個檔案而不是塞進 vite.config.ts，是因為那份設定裡有 dev
// server 的 proxy，測試環境不需要也不該去碰它。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // 不開 globals：測試都明確 import describe／it／expect，
    // 開了只是多一份沒人用的隱式全域。
    include: ["src/**/*.test.tsx", "src/**/*.test.ts"],
  },
});
