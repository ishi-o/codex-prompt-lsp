import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "node:url";
import { getCompletions } from "./completion";
import { getHover } from "./hover";
import { BUILTIN_COMMANDS, SlashCommand } from "./commands";
import {
  discoverSkills,
  discoverCustomPrompts,
  discoverPlugins,
  Skill,
  Plugin,
} from "./skills";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let rootPath = process.cwd();

// Merged command, skill, and plugin lists — built once on initialize.
let allCommands: SlashCommand[] = [];
let allSkills: Skill[] = [];
let allPlugins: Plugin[] = [];

connection.onInitialize((params): InitializeResult => {
  const rootUri = params.workspaceFolders?.[0]?.uri;
  if (rootUri?.startsWith("file:")) {
    rootPath = fileURLToPath(rootUri);
  }

  // Custom prompts override built-ins with the same name.
  const customPrompts = discoverCustomPrompts();
  const overrideNames = new Set(customPrompts.map((p) => p.name));
  allCommands = [
    ...BUILTIN_COMMANDS.filter((c) => !overrideNames.has(c.name)),
    ...customPrompts,
  ];

  allSkills = discoverSkills(rootPath);
  // Async so a hung Codex CLI can't block initialize; plugin completions
  // stay empty until it resolves.
  void discoverPlugins().then((plugins) => {
    allPlugins = plugins;
  });

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ["/", "$", "@"],
        resolveProvider: true,
      },
      hoverProvider: true,
      experimental: {
        codexCompletionTokens: [
          ...allSkills.map((skill) => "$" + skill.name),
          ...allPlugins.map((plugin) => "@" + plugin.name),
        ],
      },
    },
  };
});

connection.onCompletion(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  return getCompletions(
    doc,
    params.position,
    rootPath,
    allCommands,
    allSkills,
    allPlugins,
  );
});

connection.onCompletionResolve((item) => {
  if (item.data?.type === "slash") {
    const cmd = allCommands.find((c) => c.name === item.data.name);
    if (cmd) {
      item.documentation = { kind: "markdown", value: cmd.documentation };
    }
  } else if (item.data?.type === "skill") {
    const skill = allSkills.find((s) => s.name === item.data.name);
    if (skill) {
      item.documentation = {
        kind: "markdown",
        value: `**$${skill.name}** — Skill\n\n${skill.description}\n\nLocation: \`${skill.dir}\``,
      };
    }
  } else if (item.data?.type === "plugin") {
    const plugin = allPlugins.find((p) => p.name === item.data.name);
    if (plugin) {
      item.documentation = {
        kind: "markdown",
        value: `**@${plugin.name}** — Plugin\n\nPlugin ID: \`${plugin.id}\``,
      };
    }
  }
  return item;
});

connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  return getHover(doc, params.position, allCommands, allSkills, allPlugins);
});

documents.listen(connection);
connection.listen();
