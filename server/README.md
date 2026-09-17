# codex-prompt-lsp

Language server for Codex prompt completions.

```sh
npx codex-prompt-lsp --stdio
```

The server is editor-neutral. It communicates through standard LSP requests;
editor adapters decide which documents to attach and how editor-specific
features behave.

## Provided by the server

- **Completion**
  - `/` commands, `$` skills, and `@` plugins, skills, and workspace files.
  - Fuzzy filtering, replacement text edits with a trailing space, and
    completion-group sort metadata.
- **Editor information**
  - Completion details and hover for commands, skills, and plugins.
  - Definitions for skills (`SKILL.md`) and, when the client supports the
    custom request, captured pasted content.
- **Protocol support**
  - Incremental document synchronization.
  - Experimental exact `$skill`/`@plugin` completion tokens for adapters.

Slash completion is limited to the beginning of the first line. A bare `@`
does not scan the workspace; file search starts after the user types a prefix.
Completions are grouped by class, but the final visual order is still subject
to the LSP client's sorting behavior.

## Data sources

- Built-in commands and top-level custom prompts in
  `$CODEX_HOME/prompts/*.md`.
- Project skills in `<workspace>/.codex/skills/**/SKILL.md`, followed by user
  skills in `$CODEX_HOME/skills/**/SKILL.md`.
- Installed plugins from `codex plugin list --json`. If the CLI is unavailable
  or times out, plugin completion is empty.
- Workspace files rooted at the first LSP `workspaceFolder`.

`CODEX_HOME` defaults to `~/.codex`. The server receives the workspace root
from the LSP client; it does not discover editor buffers by itself.

## Not provided by the server

The server does not provide editor UI or adapter behavior, including:

- document/filetype detection and client startup;
- syntax highlighting and decorations;
- keybindings, atomic cursor movement, or atomic Backspace handling;
- intercepting multiline paste, storing its original content, or expanding it
  before save.

Those features belong to the Neovim and VS Code adapters. For pasted-content
hover and definition, an adapter that captures the paste must implement the
`codex/resolvePastedContent` client request. Without that request, the server
can only display the placeholder text.

## Requirements

- Node.js >= 18
- `codex` on `PATH` for installed-plugin discovery

The `pastedContent` initialization option is enabled by default and only
controls the server's placeholder hover/definition support; it does not make
the server capture or rewrite paste operations.

## License

MIT
