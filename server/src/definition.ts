import {
  Connection,
  Location,
  Position,
  Range,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { Skill } from "./skills";

const PASTED_CONTENT_PATTERN = /\[Pasted Content #\d+ \d+ lines \d+ chars\]/g;

export interface PastedContentLocation {
  uri: string;
  range: Range;
  contents?: string;
}

function lineText(doc: TextDocument, line: number): string {
  return doc.getText({
    start: { line, character: 0 },
    end: { line: line + 1, character: 0 },
  });
}

export function pastedContentRangeAt(
  doc: TextDocument,
  position: Position,
): Range | null {
  const line = lineText(doc, position.line);
  for (const match of line.matchAll(PASTED_CONTENT_PATTERN)) {
    const start = match.index;
    if (start === undefined) continue;
    const end = start + match[0].length;
    if (start <= position.character && position.character < end) {
      return Range.create(position.line, start, position.line, end);
    }
  }
  return null;
}

export async function resolvePastedContent(
  connection: Connection,
  doc: TextDocument,
  position: Position,
): Promise<PastedContentLocation | null> {
  if (!pastedContentRangeAt(doc, position)) return null;
  try {
    return await connection.sendRequest<PastedContentLocation | null>(
      "codex/resolvePastedContent",
      { textDocument: { uri: doc.uri }, position },
    );
  } catch {
    return null;
  }
}

function skillAt(
  doc: TextDocument,
  position: Position,
  skills: Skill[],
): Skill | undefined {
  const line = lineText(doc, position.line);
  for (const skill of skills) {
    const token = "$" + skill.name;
    let start = line.indexOf(token);
    while (start !== -1) {
      const end = start + token.length;
      if (start <= position.character && position.character < end) {
        return skill;
      }
      start = line.indexOf(token, end);
    }
  }
  return undefined;
}

export async function getDefinition(
  connection: Connection,
  doc: TextDocument,
  position: Position,
  skills: Skill[],
  pastedContent: boolean,
): Promise<Location | null> {
  if (pastedContent) {
    const pasted = await resolvePastedContent(connection, doc, position);
    if (pasted) return Location.create(pasted.uri, pasted.range);
  }

  const skill = skillAt(doc, position, skills);
  if (!skill) return null;
  return Location.create(
    pathToFileURL(path.join(skill.dir, "SKILL.md")).toString(),
    Range.create(0, 0, 0, 0),
  );
}
