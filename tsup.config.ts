import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli/install.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  dts: true,
  noExternal: [/(.*)/], // bundle all dependencies
  outDir: "dist",
  esbuildOptions(options) {
    options.outExtension = { ".js": ".js" }; // ensure .js extension
  },
});
