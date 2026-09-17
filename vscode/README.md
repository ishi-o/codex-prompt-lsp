# Codex Prompt LSP

VS Code adapter for [Codex CLI](https://developers.openai.com/codex/cli)
prompt files. The language server is bundled with the extension.

## Features

- **Completions**
  - `/` provides built-in commands and custom prompts at the beginning of the
    first line.
  - `$` provides skills.
  - `@` provides installed plugins, skills, and workspace files. Skills
    selected from `@` are inserted as `$skill-name`.
- **Search and details**
  - Fuzzy, case-insensitive plugin search covers names, titles, aliases, and
    descriptions.
  - Plugin names keep their display form; results stay grouped and insert one
    trailing space.
  - Hover shows command, skill, and plugin descriptions.
- **Highlighting**
  - Syntax highlighting distinguishes slash commands, skills, and plugins.
- **Atomic editing**
  - Backspace removes exact completion tokens as one unit.
  - Left/right movement treats `$skill` and `@plugin` mentions as one unit.
  - Slash commands remain character-wise.
- **Paste handling**
  - This VS Code adapter leaves pasted text unchanged.
  - Multiline paste placeholders, original-content lookup, expansion before
    save, and undo recovery are provided by the Neovim adapter.
- **Integration**
  - Automatically detects files under `$CODEX_HOME` and project `.codex`
    directories, with support for extra document selectors.
  - Bundles the language server.

## Default configuration

```json
{
  "codexPromptLsp.enable": true,
  "codexPromptLsp.documentSelectors": [],
  "codexPromptLsp.languageIds": ["markdown"],
  "codexPromptLsp.fileExtensions": [".md"],
  "codexPromptLsp.codexHome": "",
  "codexPromptLsp.detectCodexHome": true,
  "codexPromptLsp.detectProjectCodexDirectories": true,
  "codexPromptLsp.atomicBackspace": true,
  "codexPromptLsp.atomicMove": true,
  "codexPromptLsp.highlightMentions": true,
  "codexPromptLsp.pastedContent": true
}
```

An empty `codexHome` uses `CODEX_HOME` or `~/.codex`. Additional document
selectors are added to the default Codex-directory detection. Ordinary
Markdown files elsewhere are not enabled by default. `pastedContent` controls
the server's pasted-content hover/definition support; VS Code still leaves
pasted text unchanged.

## Requirements

- VS Code >= 1.88
- Node.js >= 18
- Codex CLI on `PATH` for installed-plugin completion; other completion types
  work without it

## License

MIT
