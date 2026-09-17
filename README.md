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
  mention popup: fuzzy file search, installed plugins (via
  `codex plugin list --json`), and skills (inserted as `$name`, their sigil)
- **Fuzzy filtering** — slash commands, skills, plugins, and files are filtered
  and ranked by relevance
- **Distribution** — npm package and Mason registry
- **Atomic mention movement and deletion** — the left and right arrow keys move
  across `$skill` and `@plugin` mentions as one token, and Backspace at the end
  of an exact completion removes the entire token; incomplete prefixes remain
  character-wise for Backspace

Hover on any of these shows its description.

The attached LSP client is named `codex-prompt` in both adapters.

## Requirements

- Node.js >= 18
- Codex CLI on `$PATH` (optional — only needed for `@plugin` completions)

## Adapters

Adapters add editor-specific features on top of the shared language-server
features, including document detection, mention highlighting, and atomic
mention movement and deletion.

<details>
<summary>Neovim adapter</summary>

The Neovim adapter is packaged as a plugin and includes automatic Codex buffer
detection, `markdown.codex` filetype setup, mention highlighting, and atomic
mention movement and Backspace deletion. Multiline pastes are represented as
`[Pasted Content #1 2 lines 11 chars]` while editing, expanded before the
buffer is saved, and available through hover and definition.

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

`plugin/nvim-codex-lsp.lua` auto-configures the adapter with defaults.

### Configuration

```lua
require("nvim-codex-lsp").setup({
  -- Path to node binary (default: "node")
  node_cmd = "node",
  -- Delete exact $skill and @plugin completions with one Backspace
  atomic_backspace = true,
  -- Move across $skill and @plugin mentions with arrow keys
  atomic_move = true,
  -- Keep the cursor out of atomic tokens during other movements
  atomic_cursor = true,
  -- Compact multiline pastes and expose their original content
  pasted_content = true,
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

The `vscode/` directory contains the VS Code adapter. Build and package it
with:

```
make package-vscode
```

### Requirements

- VS Code >= 1.88

The extension detects matching files under `$CODEX_HOME` and project `.codex`
directories. Matching files use the `markdown` language ID and `.md` extension
by default, so ordinary Markdown files are not attached. It provides the same
completions, hover information, mention highlighting, and atomic mention
movement and Backspace behavior as the Neovim adapter. Detection and
editor-only features can be configured independently, and advanced targets can
be added with `codexPromptLsp.documentSelectors`.

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

Mason provides the editor-neutral server. Configure an LSP client to launch
`codex-prompt-lsp --stdio`.

## Development

```
make build   # install deps and build server/dist/server.js
```

The LSP server source is under `server/`; `make build` produces
`server/dist/server.js`.

## License

MIT

<!-- Note: doc/nvim-codex-lsp.txt is auto-generated from this README by
     .github/workflows/docs.yml (panvimdoc). Edit this file, not the vimdoc. -->
