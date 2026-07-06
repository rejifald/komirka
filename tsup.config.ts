import { defineConfig } from "tsup";

// Dual ESM + CJS output with per-format type declarations, so consumers on any
// runtime resolve the right thing (principles.md: browser-first universal core,
// dual-package hazard handled structurally via the `$knob` brand, not `instanceof`).
//
// Future subpath entries (principles.md P5) — add each to `entry` when its source
// lands: src/node.ts, src/workers.ts, src/async.ts, src/testing.ts, plus a `bake`
// CLI (src/cli.ts) wired as a `bin`.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: "es2022",
  outDir: "dist",
});
