import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  InitializeResult,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "node:url";
import { CompletionType, getCompletions } from "./completion";
import { getHover, getPastedContentHover } from "./hover";
import { getDefinition } from "./definition";
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
const TRIGGER_CHARACTERS = ["/", "$", "@"];

let rootPath = process.cwd();

// Merged command, skill, and plugin lists — built once on initialize.
let allCommands: SlashCommand[] = [];
let allSkills: Skill[] = [];
let allPlugins: Plugin[] = [];
let pastedContent = true;

function mergeCommands(customPrompts: SlashCommand[]): SlashCommand[] {
  const overriddenNames = new Set(customPrompts.map((prompt) => prompt.name));
  return [
    ...BUILTIN_COMMANDS.filter((command) => !overriddenNames.has(command.name)),
    ...customPrompts,
  ];
}

function completionTokens(skills: Skill[], plugins: Plugin[]): string[] {
  return [
    ...skills.map((skill) => "$" + skill.name),
    ...plugins.map((plugin) => "@" + plugin.name),
  ];
}

connection.onInitialize(async (params): Promise<InitializeResult> => {
  pastedContent = params.initializationOptions?.pastedContent !== false;
  const rootUri = params.workspaceFolders?.[0]?.uri;
  if (rootUri?.startsWith("file:")) {
    rootPath = fileURLToPath(rootUri);
  }

  // Custom prompts override built-ins with the same name.
  allCommands = mergeCommands(discoverCustomPrompts());

  allSkills = discoverSkills(rootPath);
  // Discover plugins before completing initialization so the first completion
  // request and the atomic completion token list include installed plugins.
  allPlugins = await discoverPlugins();

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: TRIGGER_CHARACTERS,
        resolveProvider: true,
      },
      hoverProvider: true,
      definitionProvider: true,
      experimental: {
        codexCompletionTokens: completionTokens(allSkills, allPlugins),
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
  switch (item.data?.type) {
    case CompletionType.Slash: {
      const command = allCommands.find(
        (candidate) => candidate.name === item.data.name,
      );
      if (command) {
        item.documentation = {
          kind: "markdown",
          value: command.documentation,
        };
      }
      break;
    }
    case CompletionType.Skill: {
      const skill = allSkills.find(
        (candidate) => candidate.name === item.data.name,
      );
      if (skill) {
        item.documentation = {
          kind: "markdown",
          value: `**$${skill.name}** — Skill\n\n${skill.description}\n\nLocation: \`${skill.dir}\``,
        };
      }
      break;
    }
    case CompletionType.Plugin: {
      const plugin = allPlugins.find(
        (candidate) => candidate.name === item.data.name,
      );
      if (plugin) {
        item.documentation = {
          kind: "markdown",
          value: `**@${plugin.name}** — Plugin\n\nPlugin ID: \`${plugin.id}\``,
        };
      }
      break;
    }
  }
  return item;
});

connection.onHover(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  if (pastedContent) {
    const pastedHover = await getPastedContentHover(
      connection,
      doc,
      params.position,
    );
    if (pastedHover) return pastedHover;
  }
  return getHover(doc, params.position, allCommands, allSkills, allPlugins);
});

connection.onDefinition(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  return getDefinition(
    connection,
    doc,
    params.position,
    allSkills,
    pastedContent,
  );
});

documents.listen(connection);
connection.listen();
