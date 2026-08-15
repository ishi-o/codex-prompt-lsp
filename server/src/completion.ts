import {
  CompletionItem,
  CompletionItemKind,
  Position,
  InsertTextFormat,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as path from "path";
import { SlashCommand } from "./commands";
import { Skill, Plugin } from "./skills";

type TriggerContext =
  | { type: "slash"; prefix: string }
  | { type: "skill"; prefix: string }
  | { type: "plugin"; prefix: string; start: number }
  | { type: "none" };

export function getTriggerContext(lineText: string): TriggerContext {
  // Match a slash command at start of line or after whitespace
  const slashMatch = lineText.match(/(?:^|\s)(\/[\w-]*)$/);
  if (slashMatch) return { type: "slash", prefix: slashMatch[1] };

  // Match $skill mention
  const skillMatch = lineText.match(/(?:^|\s)\$([\w-]*)$/);
  if (skillMatch) return { type: "skill", prefix: skillMatch[1] };

  // Match @ mention — the unified mention popup covers files, plugins, and skills
  const pluginMatch = lineText.match(/@(\S*)$/);
  if (pluginMatch) {
    return { type: "plugin", prefix: pluginMatch[1], start: pluginMatch.index ?? 0 };
  }

  return { type: "none" };
}

export function getSlashCompletions(prefix: string, commands: SlashCommand[]): CompletionItem[] {
  return commands
    .filter((cmd) => cmd.name.startsWith(prefix))
    .map((cmd) => ({
      label: cmd.name,
      kind: CompletionItemKind.Function,
      detail: cmd.detail,
      // Documentation deferred to completionItem/resolve
      data: { type: "slash", name: cmd.name },
      insertText: cmd.name.slice(prefix.length),
      insertTextFormat: InsertTextFormat.PlainText,
    }));
}

export function getSkillCompletions(prefix: string, skills: Skill[]): CompletionItem[] {
  return skills
    .filter((s) => s.name.startsWith(prefix))
    .map((s) => ({
      label: "$" + s.name,
      kind: CompletionItemKind.Class,
      detail: s.description || "Skill",
      data: { type: "skill", name: s.name },
      insertText: s.name.slice(prefix.length),
      insertTextFormat: InsertTextFormat.PlainText,
    }));
}

/**
 * Skill candidates offered from an `@` trigger (Codex's unified mention popup
 * includes skills alongside files and plugins). Skills are mentioned with the
 * `$` sigil, so the textEdit replaces the typed `@token` with `$name`.
 */
export function getSkillCompletionsAt(
  doc: TextDocument,
  position: Position,
  tokenStart: number,
  prefix: string,
  skills: Skill[]
): CompletionItem[] {
  return skills
    .filter((s) => s.name.startsWith(prefix))
    .map((s) => ({
      label: "$" + s.name,
      kind: CompletionItemKind.Class,
      detail: s.description || "Skill",
      data: { type: "skill", name: s.name },
      textEdit: {
        range: {
          start: { line: position.line, character: tokenStart },
          end: position,
        },
        newText: "$" + s.name,
      },
    }));
}

export function getPluginCompletions(prefix: string, plugins: Plugin[]): CompletionItem[] {
  return plugins
    .filter((p) => p.name.startsWith(prefix))
    .map((p) => ({
      label: "@" + p.name,
      kind: CompletionItemKind.Module,
      detail: p.id,
      data: { type: "plugin", name: p.name },
      insertText: p.name.slice(prefix.length),
      insertTextFormat: InsertTextFormat.PlainText,
    }));
}

export function getFileCompletions(prefix: string, rootPath: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  const searchDir = prefix.includes("/")
    ? path.join(rootPath, prefix.substring(0, prefix.lastIndexOf("/")))
    : rootPath;

  try {
    const entries = walkDir(searchDir, 0, 3);
    for (const entry of entries) {
      const relativePath = path.relative(rootPath, entry.fullPath);
      if (!relativePath.startsWith(prefix)) continue;
      items.push({
        label: "@" + relativePath,
        kind: entry.isDir ? CompletionItemKind.Folder : CompletionItemKind.File,
        detail: entry.isDir ? "directory" : "file",
        data: { type: "file", path: relativePath },
        insertText: relativePath.slice(prefix.length),
        insertTextFormat: InsertTextFormat.PlainText,
      });
      if (items.length >= 50) break;
    }
  } catch {
    // Ignore filesystem errors
  }

  return items;
}

interface DirEntry {
  fullPath: string;
  isDir: boolean;
}

function walkDir(dir: string, depth: number, maxDepth: number): DirEntry[] {
  if (depth > maxDepth) return [];
  const results: DirEntry[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    // Skip hidden files and common noise directories
    if (entry.name.startsWith(".")) continue;
    if (["node_modules", "dist", "__pycache__"].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    results.push({ fullPath, isDir: entry.isDirectory() });
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, depth + 1, maxDepth));
    }
  }
  return results;
}

export async function getCompletions(
  doc: TextDocument,
  position: Position,
  rootPath: string,
  commands: SlashCommand[],
  skills: Skill[],
  plugins: Plugin[]
): Promise<CompletionItem[]> {
  const lineText = doc.getText({
    start: { line: position.line, character: 0 },
    end: position,
  });

  const ctx = getTriggerContext(lineText);

  if (ctx.type === "slash") {
    return getSlashCompletions(ctx.prefix, commands);
  }
  if (ctx.type === "skill") {
    return getSkillCompletions(ctx.prefix, skills);
  }
  if (ctx.type === "plugin") {
    // @ in the Codex composer opens the unified mention popup: fuzzy file
    // search merged with plugin and skill candidates.
    const pluginItems = getPluginCompletions(ctx.prefix, plugins);
    const skillItems = getSkillCompletionsAt(doc, position, ctx.start, ctx.prefix, skills);
    const fileItems = getFileCompletions(ctx.prefix, rootPath);
    return [...pluginItems, ...skillItems, ...fileItems];
  }

  return [];
}
