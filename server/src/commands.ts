export interface SlashCommand {
  name: string; // e.g. "/compact"
  detail: string; // one-line shown in completion menu
  documentation: string; // markdown shown in hover/resolve
}

function builtinCommand(
  name: string,
  detail: string,
  documentation = detail,
): SlashCommand {
  return { name, detail, documentation };
}

// Built-in Codex CLI commands that are always available.
// User-installed skills and custom prompts are discovered separately in skills.ts.
export const BUILTIN_COMMANDS: SlashCommand[] = [
  builtinCommand("/model", "choose what model and reasoning effort to use"),
  builtinCommand(
    "/ide",
    "include current selection, open files, and other context from your IDE",
  ),
  builtinCommand("/permissions", "choose what Codex is allowed to do"),
  builtinCommand("/keymap", "remap TUI shortcuts"),
  builtinCommand("/vim", "toggle Vim mode for the composer"),
  builtinCommand("/setup-default-sandbox", "set up elevated agent sandbox"),
  builtinCommand(
    "/sandbox-add-read-dir",
    "let sandbox read a directory",
    "let sandbox read a directory.\n\nUsage: `/sandbox-add-read-dir <absolute_path>`",
  ),
  builtinCommand("/experimental", "toggle experimental features"),
  builtinCommand(
    "/approve",
    "approve one retry of a recent auto-review denial",
  ),
  builtinCommand("/memories", "configure memory use and generation"),
  builtinCommand(
    "/skills",
    "use skills to improve how Codex performs specific tasks",
  ),
  builtinCommand(
    "/import",
    "import setup, this project, and recent chats from Claude Code",
  ),
  builtinCommand("/hooks", "view and manage lifecycle hooks"),
  builtinCommand("/review", "review my current changes and find issues"),
  builtinCommand("/rename", "rename the current thread"),
  builtinCommand("/new", "start a new chat during a conversation"),
  builtinCommand("/archive", "archive this session and exit"),
  builtinCommand("/delete", "permanently delete this session and exit"),
  builtinCommand("/resume", "resume a saved chat"),
  builtinCommand("/fork", "fork the current chat"),
  builtinCommand(
    "/worktree",
    "start or continue a conversation in a new worktree",
  ),
  builtinCommand("/app", "continue this session in the Desktop app"),
  builtinCommand(
    "/init",
    "create an AGENTS.md file with instructions for Codex",
  ),
  builtinCommand(
    "/compact",
    "summarize conversation to prevent hitting the context limit",
  ),
  builtinCommand("/recap", "summarize the current conversation now"),
  builtinCommand("/goal", "set or view the goal for a long-running task"),
  builtinCommand(
    "/agents",
    "view and switch between all active agent sessions",
  ),
  builtinCommand("/side", "start a side conversation in an ephemeral fork"),
  builtinCommand("/copy", "copy the last response or part of it"),
  builtinCommand("/export", "export the conversation as markdown"),
  builtinCommand(
    "/raw",
    "toggle raw scrollback mode for copy-friendly terminal selection",
  ),
  builtinCommand("/diff", "show git diff (including untracked files)"),
  builtinCommand("/mention", "mention a file"),
  builtinCommand(
    "/status",
    "show current session configuration and token usage",
  ),
  builtinCommand("/cd", "change the current working directory"),
  builtinCommand("/pwd", "show the current working directory"),
  builtinCommand("/usage", "view account usage or use a usage limit reset"),
  builtinCommand(
    "/debug-config",
    "show config layers and requirement sources for debugging",
  ),
  builtinCommand(
    "/title",
    "configure which items appear in the terminal title",
  ),
  builtinCommand(
    "/statusline",
    "configure which items appear in the status line",
  ),
  builtinCommand("/theme", "choose a syntax highlighting theme"),
  builtinCommand("/pets", "choose or hide the terminal pet"),
  builtinCommand(
    "/mcp",
    "list configured MCP tools; use /mcp verbose for details",
  ),
  builtinCommand("/apps", "manage apps"),
  builtinCommand("/plugins", "browse plugins"),
  builtinCommand("/logout", "log out of Codex"),
  builtinCommand("/exit", "exit Codex"),
  builtinCommand("/quit", "exit Codex"),
  builtinCommand("/feedback", "send logs to maintainers"),
  builtinCommand("/rollout", "print the rollout file path"),
  builtinCommand("/ps", "list background terminals"),
  builtinCommand("/stop", "stop all background terminals"),
  builtinCommand("/clear", "clear the terminal and start a new chat"),
  builtinCommand("/personality", "choose a communication style for Codex"),
  builtinCommand("/test-approval", "test approval request"),
  builtinCommand("/subagents", "switch between this session's subagents"),
];
