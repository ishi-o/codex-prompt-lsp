require("esbuild").build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  outfile: "dist/server.js",
  minify: false,
}).catch(() => process.exit(1));
