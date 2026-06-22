import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: "webview",
  resolve: {
    alias: {
      "@opencode-chat/agent-opencode": path.resolve(__dirname, "../../agents/opencode/src/index.ts"),
      "@opencode-chat/core": path.resolve(__dirname, "../../core/src/index.ts"),
    },
  },
  build: {
    outDir: "../dist/webview",
    emptyOutDir: true,
    // Webview では単一の JS/CSS ファイルにバンドルしたい
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Extension Host 側から固定パスで参照するため、ハッシュを除去する
        entryFileNames: "assets/index.js",
        assetFileNames: "assets/index[extname]",
        inlineDynamicImports: true,
      },
    },
  },
});
