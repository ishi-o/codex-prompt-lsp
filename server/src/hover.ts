import { Hover, Position, Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SlashCommand } from "./commands";
import { Skill, Plugin } from "./skills";

function getWordRange(doc: TextDocument, position: Position): { word: string; range: Range } {
  const line = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });

  let start = position.character;
  let end = position.character;

  while (start > 0 && /[-\w/$@]/.test(line[start - 1])) start--;
  while (end < line.length && /[-\w/$@]/.test(line[end])) end++;

  return {
    word: line.slice(start, end),
    range: {
      start: { line: position.line, character: start },
      end: { line: position.line, character: end },
    },
  };
}

export function getHover(
  doc: TextDocument,
  position: Position,
  commands: SlashCommand[],
  skills: Skill[],
  plugins: Plugin[]
): Hover | null {
  const { word, range } = getWordRange(doc, position);

  if (word.startsWith("/")) {
    const cmd = commands.find((c) => c.name === word);
    if (!cmd) return null;
    return {
      contents: {
        kind: "markdown",
        value: `**${cmd.name}** — ${cmd.detail}\n\n${cmd.documentation}`,
      },
      range,
    };
  }

  if (word.startsWith("$")) {
    const skill = skills.find((s) => s.name === word.slice(1));
    if (!skill) return null;
    return {
      contents: {
        kind: "markdown",
        value: `**$${skill.name}** — Skill\n\n${skill.description}\n\nLocation: \`${skill.dir}\``,
      },
      range,
    };
  }

  if (word.startsWith("@")) {
    const plugin = plugins.find((p) => p.name === word.slice(1));
    if (!plugin) return null;
    return {
      contents: {
        kind: "markdown",
        value: `**@${plugin.name}** — Plugin\n\nPlugin ID: \`${plugin.id}\``,
      },
      range,
    };
  }

  return null;
}
