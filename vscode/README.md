# Codex Prompt LSP

VS Code client for Codex prompt completions, hover information, mention
highlighting, and atomic completion deletion.

The extension enables itself for matching files under `$CODEX_HOME` and any
project `.codex` directory. By default, matching files must use the `markdown`
language ID and `.md` extension. Highlighting, atomic Backspace, detection,
and additional document selectors are configurable under `codexPromptLsp`.

```json
{
  "codexPromptLsp.languageIds": ["markdown"],
  "codexPromptLsp.fileExtensions": [".md", ".prompt"],
  "codexPromptLsp.codexHome": "",
  "codexPromptLsp.detectCodexHome": true,
  "codexPromptLsp.detectProjectCodexDirectories": true,
  "codexPromptLsp.atomicBackspace": true,
  "codexPromptLsp.highlightMentions": true,
  "codexPromptLsp.documentSelectors": []
}
```

A document is enabled when its language ID and extension match inside a
detected Codex directory, or when it matches an additional selector. Settings
apply without reloading VS Code.

The extension includes the language server and does not require a separate
installation.
