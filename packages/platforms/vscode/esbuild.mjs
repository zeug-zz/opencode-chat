import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const resolveFromHere = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));

/** @type {esbuild.BuildOptions} */
const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node22",
  sourcemap: true,
  // @opencode-ai/sdk は ESM のみ提供のため、バンドルに含める
  mainFields: ["module", "main"],
  // ワークスペースパッケージはビルド済み dist ではなくソースから直接バンドルする
  // （vitest.config.ext.ts のエイリアスと同じ解決方法に揃える）
  alias: {
    "@opencode-chat/core": resolveFromHere("../../core/src/index.ts"),
    "@opencode-chat/agent-opencode": resolveFromHere("../../agents/opencode/src/index.ts"),
  },
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
}
