import { Hover, Position, Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SlashCommand } from "./commands";
import { Skill, Plugin } from "./skills";

const TOKEN_CHARACTER = /[-\w/$@]/;

interface WordRange {
  word: string;
  range: Range;
}

function getWordRange(doc: TextDocument, position: Position): WordRange {
  const line = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });

  let start = position.character;
  let end = position.character;

  while (start > 0 && TOKEN_CHARACTER.test(line[start - 1])) start--;
  while (end < line.length && TOKEN_CHARACTER.test(line[end])) end++;

  return {
    word: line.slice(start, end),
    range: {
      start: { line: position.line, character: start },
      end: { line: position.line, character: end },
    },
  };
}

function findNamed<T>(
  items: T[],
  name: string,
  getName: (item: T) => string,
): T | undefined {
  return items.find((item) => getName(item) === name);
}

function markdownHover(value: string, range: Range): Hover {
  return {
    contents: { kind: "markdown", value },
    range,
  };
}

export function getHover(
  doc: TextDocument,
  position: Position,
  commands: SlashCommand[],
  skills: Skill[],
  plugins: Plugin[],
): Hover | null {
  const { word, range } = getWordRange(doc, position);

  if (word.startsWith("/")) {
    const cmd = findNamed(commands, word, (command) => command.name);
    if (!cmd) return null;
    return markdownHover(
      `**${cmd.name}** — ${cmd.detail}\n\n${cmd.documentation}`,
      range,
    );
  }

  if (word.startsWith("$")) {
    const skill = findNamed(skills, word.slice(1), (item) => item.name);
    if (!skill) return null;
    return markdownHover(
      `**$${skill.name}** — Skill\n\n${skill.description}\n\nLocation: \`${skill.dir}\``,
      range,
    );
  }

  if (word.startsWith("@")) {
    const plugin = findNamed(plugins, word.slice(1), (item) => item.name);
    if (!plugin) return null;
    return markdownHover(
      `**@${plugin.name}** — Plugin\n\nPlugin ID: \`${plugin.id}\``,
      range,
    );
  }

  return null;
}
