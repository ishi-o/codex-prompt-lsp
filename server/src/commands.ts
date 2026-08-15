export interface SlashCommand {
  name: string; // e.g. "/compact"
  detail: string; // one-line shown in completion menu
  documentation: string; // markdown shown in hover/resolve
}

// Built-in Codex CLI commands that are always available.
// User-installed skills and custom prompts are discovered separately in skills.ts.
export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: "/agent",
    detail: "Switch active agent thread",
    documentation:
      "Inspect or continue work in a spawned subagent thread. Alias: `/subagents`.",
  },
  {
    name: "/apps",
    detail: "Browse apps (connectors)",
    documentation:
      "Browse available apps/connectors (e.g. Slack, Linear) and insert them into the prompt.",
  },
  {
    name: "/archive",
    detail: "Archive the current session and exit",
    documentation: "Archives the current session and exits Codex. Archived sessions can be resumed later.",
  },
  {
    name: "/approve",
    detail: "Approve one retry of a recent auto review denial",
    documentation:
      "Approves a single retry of a recent command that was denied by auto review.",
  },
  {
    name: "/clear",
    detail: "Clear the terminal and start a fresh chat",
    documentation: "Clears the terminal and starts a fresh chat with an empty context.",
  },
  {
    name: "/compact",
    detail: "Summarize visible chat to free tokens",
    documentation:
      "Summarizes the visible conversation to free context window space.",
  },
  {
    name: "/copy",
    detail: "Copy latest completed Codex output",
    documentation:
      "Copies the latest completed Codex output to the clipboard. Also bound to Ctrl+O.",
  },
  {
    name: "/delete",
    detail: "Delete the current session and exit",
    documentation: "Permanently deletes the current session and exits Codex.",
  },
  {
    name: "/diff",
    detail: "Show Git diff including untracked files",
    documentation: "Shows the Git diff of your working tree, including untracked files.",
  },
  {
    name: "/exit",
    detail: "Exit the CLI",
    documentation: "Exits Codex. Alias: `/quit`.",
  },
  {
    name: "/experimental",
    detail: "Toggle experimental features",
    documentation: "Turns experimental Codex features on or off. Restart Codex after changing them.",
  },
  {
    name: "/feedback",
    detail: "Send feedback",
    documentation: "Sends feedback to the Codex team.",
  },
  {
    name: "/goal",
    detail: "Set goals",
    documentation: "Sets goals for the current session to keep Codex on track.",
  },
  {
    name: "/ide",
    detail: "Include IDE context",
    documentation:
      "Includes open files, the current selection, and other context from a connected IDE.",
  },
  {
    name: "/import",
    detail: "Import Claude Code or Cursor setup",
    documentation: "Imports settings and configuration from Claude Code or Cursor.",
  },
  {
    name: "/init",
    detail: "Initialize project with AGENTS.md",
    documentation:
      "Analyzes the project and creates an AGENTS.md file with project context and conventions.",
  },
  {
    name: "/keymap",
    detail: "Remap TUI keyboard shortcuts",
    documentation: "Customizes TUI keyboard shortcuts.",
  },
  {
    name: "/mcp",
    detail: "Manage MCP servers",
    documentation: "Lists and manages configured MCP servers.",
  },
  {
    name: "/memories",
    detail: "Configure memory use and generation",
    documentation: "Configures how Codex uses and generates memories.",
  },
  {
    name: "/model",
    detail: "Select the model for this session",
    documentation:
      "Selects the model used in the current session. Examples:\n```\n/model gpt-5.1-codex\n```",
  },
  {
    name: "/permissions",
    detail: "Set what Codex can do without asking first",
    documentation:
      "Relaxes or tightens approval requirements mid-session (what Codex can do without asking first).",
  },
  {
    name: "/plan",
    detail: "Create plans",
    documentation: "Enters plan mode: Codex drafts a plan before making changes.",
  },
  {
    name: "/plugins",
    detail: "Browse installed and discoverable plugins",
    documentation: "Browses installed and discoverable Codex plugins.",
  },
  {
    name: "/quit",
    detail: "Exit the CLI",
    documentation: "Exits Codex. Alias: `/exit`.",
  },
  {
    name: "/rename",
    detail: "Rename the current chat",
    documentation: "Renames the current chat/session.",
  },
  {
    name: "/review",
    detail: "Run code review",
    documentation: "Reviews the changes in your working tree using the current model.",
  },
  {
    name: "/skills",
    detail: "Browse and use skills",
    documentation:
      "Browses available skills and applies them to improve task-specific behavior. Skills can also be mentioned directly with `$SkillName`.",
  },
  {
    name: "/status",
    detail: "Show status",
    documentation: "Shows current status: model, authentication, workspace, and usage.",
  },
  {
    name: "/subagents",
    detail: "Switch active agent thread",
    documentation: "Alias of `/agent`.",
  },
  {
    name: "/vim",
    detail: "Toggle Vim mode for the composer",
    documentation: "Enables or disables Vim modal editing in the composer.",
  },
];
