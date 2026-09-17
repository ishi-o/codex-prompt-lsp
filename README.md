# codex-prompt-lsp

LSP-powered completions for the [Codex CLI](https://developers.openai.com/codex/cli) chat input.

`codex-prompt-lsp` is an editor-neutral language server. Editor-specific
integration is provided by adapters for Neovim and VS Code.

When you press `Ctrl+G` in the Codex TUI, Codex opens your `$EDITOR` on a
temporary `.md` file. An adapter can detect that buffer (and your Codex
markdown files) and attach the language server, which provides:

- **Slash commands** (`/compact`, `/diff`, `/review`, ...) — all built-in
  Codex commands, plus custom prompts discovered from
  `$CODEX_HOME/prompts/*.md` (each `foo.md` is invoked as `/foo`)
- **Skill mentions** (`$skill-name`) — discovered from
  `<project>/.codex/skills/*/SKILL.md` (repo skills, higher priority) and
  `$CODEX_HOME/skills/*/SKILL.md` (user skills)
- **Unified mentions** (`@`) — `@` in the Codex composer opens the unified
  mention popup: fzf-powered fuzzy file search, installed plugins (via
  `codex plugin list --json`), and skills (inserted as `$name`, their sigil)
- **Server-side fuzzy filtering** — slash commands, skills, plugins, and files
  are filtered and ranked by the LSP server, so the editor does not need its
  own fuzzy-completion capability
- **Self-contained distribution** — npm executable and Mason package
- **Atomic completion deletion** — pressing Backspace at the end of an exact
  `$skill` or `@plugin` completion removes the entire token; incomplete prefixes
  continue to delete one character at a time

Hover on any of these shows its description.

The attached LSP client is named `codex-prompt` in both adapters.

## Requirements

- Node.js >= 18
- Codex CLI on `$PATH` (optional — only needed for `@plugin` completions)

## Adapters

<details>
<summary>Neovim adapter</summary>

The Neovim adapter is packaged as a plugin and includes automatic Codex buffer
detection, `markdown.codex` filetype setup, mention highlighting, and atomic
Backspace deletion.

### Requirements

- Neovim >= 0.11 (`vim.lsp.config` / `vim.lsp.enable`)

### Setup

With [lazy.nvim](https://lazy.folke.io):

```lua
{
  "ishi-o/codex-prompt-lsp",
  opts = {},
}
```

With `vim.pack`:

```lua
vim.pack.add("ishi-o/codex-prompt-lsp")
require("nvim-codex-lsp").setup()
```

The adapter works out of the box with no explicit setup —
`plugin/nvim-codex-lsp.lua` auto-configures with defaults.

The adapter uses the single esbuild bundle committed in this repository, which
includes runtime libraries such as the TypeScript `fzf` matcher. Users do not
run `npm install` or install any external command-line search tool.

### Configuration

```lua
require("nvim-codex-lsp").setup({
  -- Path to node binary (default: "node")
  node_cmd = "node",
  -- Delete exact $skill and @plugin completions with one Backspace
  atomic_backspace = true,
})
```

### Buffer detection

The LSP server and buffer-local features attach based only on the
`markdown.codex` filetype; they do not inspect the buffer path or URI. This
also supports integrations that set that filetype directly.

For convenience, the adapter automatically assigns `markdown.codex` to files
that match any of:

1. `.tmpXXXXXX.md` in the system temp dir — the Ctrl+G external editor buffer
2. `$CODEX_HOME/**/*.md` (default `~/.codex/`) — skills, prompts, AGENTS.md
3. any `.codex/**/*.md` in a project — repo-local skills

</details>

<details>
<summary>VS Code adapter</summary>

The `vscode/` directory contains the VS Code adapter. Build and package its
self-contained VSIX with:

```
make package-vscode
```

### Requirements

- VS Code >= 1.88

The extension includes the language server and detects matching files under
`$CODEX_HOME` and project `.codex` directories. It requires the `markdown`
language ID and `.md` extension by default, so ordinary Markdown files are not
attached. It provides the same completions, hover information, mention
highlighting, and atomic Backspace behavior as the Neovim adapter. Detection
and editor-only features can be configured independently, and advanced targets
can be added with `codexPromptLsp.documentSelectors`.

</details>

## Mason

The repository includes a Mason registry manifest for the server:

```lua
require("mason").setup({
  registries = {
    "github:ishi-o/codex-prompt-lsp",
    "github:mason-org/mason-registry",
  },
})
```

After the npm package is published, install it with `:MasonInstall codex-prompt-lsp`.

Mason installs the editor-neutral server only; it does not install an adapter.
With Mason alone, you must configure an LSP client yourself to launch
`codex-prompt-lsp --stdio`. That provides the server features: slash commands,
skills, unified file/plugin/skill mentions, fuzzy filtering, hover, and
completion insertion semantics.

The Neovim adapter currently uses its bundled server and does not automatically
prefer a Mason-installed executable.

## Development

```
make build   # install deps and build server/dist/server.js
```

The LSP server is a TypeScript project under `server/`, bundled to a single
file with esbuild and committed to the repo so users don't need to build it.

## License

MIT

<!-- Note: doc/nvim-codex-lsp.txt is auto-generated from this README by
     .github/workflows/docs.yml (panvimdoc). Edit this file, not the vimdoc. -->
