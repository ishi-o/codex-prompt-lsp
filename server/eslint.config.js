const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  { ignores: ["dist/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Root CommonJS config files (esbuild.config.js, this file)
    files: ["*.js"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
