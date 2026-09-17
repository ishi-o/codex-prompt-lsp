const { copyFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const esbuild = require("esbuild");

(async () => {
  await mkdir(path.join(__dirname, "dist"), { recursive: true });
  await esbuild.build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join("dist", "extension.js"),
    external: ["vscode"],
    minify: false,
  });
  await copyFile(
    path.join(__dirname, "..", "server", "dist", "server.js"),
    path.join(__dirname, "dist", "server.js"),
  );
})().catch(() => process.exit(1));
