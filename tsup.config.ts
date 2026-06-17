import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",            // -> dist/index.js  (cockpit bin)
    cockpitd: "src/control/cockpitd.ts", // -> dist/cockpitd.js (launchd daemon)
  },
  format: "esm",
  platform: "node",
  target: "node24",
  bundle: true,
  splitting: false,        // keep two independent self-contained bundles
  sourcemap: true,
  clean: true,
  dts: false,              // bin/daemon don't ship types; faster build
  // Keep node built-ins + real npm deps external; bundle our workspace code inline.
  // tsup/esbuild externalize node_modules by default EXCEPT workspace packages,
  // which we WANT inlined — so do not add @cockpit/* to `external`.
  external: [],
  // src/index.ts already has #!/usr/bin/env node; tsup preserves it. No banner needed.
});
